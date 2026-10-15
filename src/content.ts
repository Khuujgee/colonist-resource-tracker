import { Overlay } from './overlay';
import { SELECTORS, describeEntry, entryPlayerColors, findLocalPlayer, isKnownNoop, parseEntry } from './parser';
import { Tracker } from './tracker';

export interface Session {
  stop(): void;
  readonly tracker: Tracker;
  /** True when some log lines were never seen (joined mid-game, reload, or a skipped position). */
  readonly missedLines: boolean;
}

/** How many already-applied lines must change content before we call it a new game. */
const NEW_GAME_CHANGED_LINES = 2;

/**
 * Watches the game log and feeds new lines to the tracker.
 *
 * The log is a virtual list: only on-screen lines exist in the DOM and
 * scrolling re-renders old ones. Each line's data-index is its position in the
 * whole log, so lines are applied strictly in position order, once each.
 * A new game is recognised by already-applied positions showing different
 * lines, not by the log element being replaced (React may remount it mid-game).
 */
export function start(doc: Document = document): Session {
  const tracker = new Tracker();
  const overlay = new Overlay(() => {
    resetState();
    scan();
  });
  let lastIndex = -1;
  /** Fingerprint of every applied line, by position. */
  let seen = new Map<number, string>();
  let missedLines = false;
  let detail = '';
  let unparsed = 0;
  let lastUnparsed = '';
  let colors: Record<string, string> = {};
  let dirty = true;

  function resetState(): void {
    tracker.reset();
    lastIndex = -1;
    seen = new Map();
    missedLines = false;
    detail = '';
    unparsed = 0;
    lastUnparsed = '';
    colors = {};
    dirty = true;
  }

  function scan(): void {
    const container = doc.querySelector(SELECTORS.logContainer);
    if (container) {
      let entries = readEntries(container);
      const changed = entries.filter((e) => seen.has(e.index) && seen.get(e.index) !== fingerprint(e.el));
      if (changed.length >= NEW_GAME_CHANGED_LINES) {
        resetState();
        entries = readEntries(container);
      }
      for (const { el, index } of entries.filter((e) => e.index > lastIndex)) {
        if (index !== lastIndex + 1) {
          missedLines = true;
          detail ||= `Expected line ${lastIndex + 1}, got ${index}. Lines on screen: ${entries.map((e) => e.index).join(', ')}. First: "${entries[0].el.textContent?.trim().slice(0, 60)}"`;
          console.warn(`[tracker] missed lines: expected ${lastIndex + 1}, got ${index}.`);
        }
        lastIndex = index;
        seen.set(index, fingerprint(el));
        apply(el);
        dirty = true;
      }
    }
    if (!dirty) return;
    dirty = false;
    overlay.render({
      views: tracker.view(),
      colors,
      outOfSync: tracker.outOfSync || missedLines,
      overLimit: tracker.overLimit,
      stopped: tracker.stopped,
      detail,
      unparsed: { count: unparsed, last: lastUnparsed },
    });
  }

  function apply(el: HTMLElement): void {
    Object.assign(colors, entryPlayerColors(el));
    const events = parseEntry(el, findLocalPlayer(doc));
    for (const e of events) tracker.apply(e);
    if (events.length === 0 && !isKnownNoop(el)) {
      unparsed++;
      lastUnparsed = describeEntry(el);
      console.warn(`[tracker] unparsed (${unparsed}):`, lastUnparsed, el.textContent?.trim());
    }
  }

  overlay.mount(doc.body);
  const observer = new MutationObserver(scan);
  observer.observe(doc.body, { childList: true, subtree: true });
  scan();

  return {
    stop: () => observer.disconnect(),
    tracker,
    get missedLines() {
      return missedLines;
    },
  };
}

/** Log lines (not chat) on screen, in position order. */
function readEntries(container: Element): { el: HTMLElement; index: number }[] {
  return [...container.querySelectorAll<HTMLElement>(SELECTORS.logEntry)]
    .filter((el) => !el.closest(SELECTORS.chat)) // chat numbers its lines separately
    .map((el) => ({ el, index: Number(el.dataset.index) }))
    .filter((e) => Number.isInteger(e.index))
    .sort((a, b) => a.index - b.index);
}

/** What a line says: its text plus its icons (cards are images, invisible in text). */
function fingerprint(el: Element): string {
  const icons = [...el.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
  return `${el.textContent ?? ''}|${icons.join(',')}`;
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id) start();
