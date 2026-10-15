import { Overlay } from './overlay';
import { SELECTORS, entryPlayerColors, isKnownNoop, parseEntry } from './parser';
import { Tracker } from './tracker';

export interface Session {
  stop(): void;
  readonly tracker: Tracker;
  /** True when some log lines were never seen (joined mid-game, reload, or a skipped position). */
  readonly missedLines: boolean;
}

/**
 * Watches the game log and feeds new lines to the tracker.
 *
 * The log is a virtual list: only on-screen lines exist in the DOM and
 * scrolling re-renders old ones. Each line's data-index is its position in the
 * whole log, so lines are applied strictly in position order, once each.
 */
export function start(doc: Document = document): Session {
  const tracker = new Tracker();
  const overlay = new Overlay(() => {
    resetState();
    scan();
  });
  let container: Element | null = null;
  let lastIndex = -1;
  let missedLines = false;
  let unparsed = 0;
  let colors: Record<string, string> = {};

  function resetState(): void {
    tracker.reset();
    lastIndex = -1;
    missedLines = false;
    colors = {};
  }

  function scan(): void {
    const current = doc.querySelector(SELECTORS.logContainer);
    if (current !== container) {
      if (container) resetState(); // the log was replaced: a new game
      container = current;
    }
    if (container) {
      const fresh = [...container.querySelectorAll<HTMLElement>(SELECTORS.logEntry)]
        .map((el) => ({ el, index: Number(el.dataset.index) }))
        .filter((e) => Number.isInteger(e.index) && e.index > lastIndex)
        .sort((a, b) => a.index - b.index);
      for (const { el, index } of fresh) {
        if (index !== lastIndex + 1) missedLines = true;
        lastIndex = index;
        apply(el);
      }
    }
    overlay.render({
      views: tracker.view(),
      colors,
      outOfSync: tracker.outOfSync || missedLines,
      overLimit: tracker.overLimit,
    });
  }

  function apply(el: HTMLElement): void {
    Object.assign(colors, entryPlayerColors(el));
    const events = parseEntry(el);
    for (const e of events) tracker.apply(e);
    if (events.length === 0 && !isKnownNoop(el)) {
      unparsed++;
      console.debug(`[tracker] unparsed (${unparsed}):`, el.textContent?.trim());
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

if (typeof chrome !== 'undefined' && chrome.runtime?.id) start();
