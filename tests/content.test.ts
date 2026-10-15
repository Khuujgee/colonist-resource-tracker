// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Overlay } from '../src/overlay';
import { start } from '../src/content';
import sample from './fixtures/sample-entries.html?raw';

// Real entries from the sample: 468 = "Alice got 🌾🌾", 470 = "Bob built a Road".
const proto = document.createElement('div');
proto.innerHTML = sample;
const payout = proto.querySelector('[data-index="468"]')!;

/** A copy of the "Alice got 🌾🌾" entry at a given log position. */
const line = (index: number) => {
  const el = payout.cloneNode(true) as HTMLElement;
  el.dataset.index = String(index);
  return el;
};

const makeLog = (...entries: HTMLElement[]) => {
  const c = document.createElement('div');
  c.className = 'responsiveContainer-AS9_lPrM gameFeedsContainer-jBSxvDCV';
  c.append(...entries);
  return c;
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const grain = (t: ReturnType<typeof start>) =>
  t.tracker.view().find((v) => v.player === 'Alice')?.certain.grain ?? 0;

let session: ReturnType<typeof start> | undefined;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => session?.stop());

test('replays existing entries on start', () => {
  document.body.append(makeLog(line(0), line(1)));
  session = start(document);
  expect(grain(session)).toBe(4);
  expect(session.missedLines).toBe(false);
});

test('processes each entry once, even when scrolling re-renders it', async () => {
  const log = makeLog(line(0));
  document.body.append(log);
  session = start(document);
  log.append(line(1));
  await flush();
  log.firstElementChild!.remove(); // scrolled out of view
  log.prepend(line(0)); // scrolled back into view
  await flush();
  expect(grain(session)).toBe(4);
});

test('does not reset when old entries are removed', async () => {
  const log = makeLog(line(0), line(1));
  document.body.append(log);
  session = start(document);
  log.firstElementChild!.remove();
  await flush();
  expect(grain(session)).toBe(4);
});

/** A payout line at `index` for a different player, i.e. a different game's log. */
const otherGame = (index: number) => {
  const el = line(index);
  el.querySelector('[class*="messagePart-"] span')!.textContent = 'Zed';
  return el;
};

test('a new game in a new log container resets tracking', async () => {
  const log = makeLog(line(0), line(1));
  document.body.append(log);
  session = start(document);
  log.replaceWith(makeLog(otherGame(0), otherGame(1)));
  await flush();
  expect(session.tracker.view().map((v) => v.player)).toEqual(['Zed']);
});

test('a rematch reusing the same log container resets tracking', async () => {
  const log = makeLog(line(0), line(1), line(2));
  document.body.append(log);
  session = start(document);
  log.replaceChildren(otherGame(0), otherGame(1));
  await flush();
  expect(session.tracker.view().map((v) => v.player)).toEqual(['Zed']);
  expect(session.tracker.view()[0].certain.grain).toBe(4);
  expect(session.missedLines).toBe(false);
});

test('one line changing in place does not reset tracking', async () => {
  const log = makeLog(line(0), line(1));
  document.body.append(log);
  session = start(document);
  log.firstElementChild!.replaceWith(otherGame(0));
  await flush();
  expect(grain(session)).toBe(4);
});

test('the log container being remounted mid-game keeps tracking', async () => {
  const log = makeLog(line(0), line(1));
  document.body.append(log);
  session = start(document);
  log.remove();
  await flush();
  document.body.append(makeLog(line(1), line(2)));
  await flush();
  expect(grain(session)).toBe(6);
  expect(session.missedLines).toBe(false);
});

test('waits for the log container to appear', async () => {
  session = start(document);
  document.body.append(makeLog(line(0)));
  await flush();
  expect(grain(session)).toBe(2);
});

test('flags missed lines when the first line seen is not the start of the log', () => {
  document.body.append(makeLog(line(468)));
  session = start(document);
  expect(session.missedLines).toBe(true);
});

test('flags missed lines when positions skip', async () => {
  const log = makeLog(line(0));
  document.body.append(log);
  session = start(document);
  log.append(line(5));
  await flush();
  expect(session.missedLines).toBe(true);
});

test('ignores chat lines, whose positions overlap the log', async () => {
  const chatLine = (index: number) => {
    const el = document.createElement('div');
    el.dataset.index = String(index);
    el.innerHTML =
      '<div class="feedMessage-O8TLknGe"><button><span class="username-j4cMk1M1">Bob<span>: </span></span></button>' +
      '<span class="messagePart-XeUsOgLX">hi</span></div>';
    return el;
  };
  const chat = document.createElement('div');
  chat.className = 'chatContainer-wnnfw0or';
  chat.append(chatLine(0), chatLine(1), chatLine(7));
  const log = makeLog(line(0));
  log.append(chat);
  document.body.append(log);
  session = start(document);
  log.append(line(1));
  await flush();
  expect(grain(session)).toBe(4);
  expect(session.missedLines).toBe(false);
});

test('"You" in the log is the local player from the player panel', () => {
  const panel = document.createElement('div');
  panel.innerHTML =
    '<div class="playerInformation-FS7FmDYj currentUser-JOam6Xvt"><div class="usernameLarge-FoNEago3">Alice</div></div>';
  const steal = line(1);
  steal.querySelector('[class*="messagePart-"]')!.innerHTML =
    'You stole <img src="x/card_grain.svg" alt="Grain"> from <span style="font-weight:600;color:#285FBD">Bob</span>';
  const bobGain = line(0);
  bobGain.querySelector('[class*="messagePart-"] span')!.textContent = 'Bob';
  document.body.append(panel, makeLog(bobGain, steal));
  session = start(document);
  const views = session.tracker.view();
  expect(views.map((v) => v.player)).toEqual(['Bob', 'Alice']);
  expect(views.find((v) => v.player === 'Alice')!.certain.grain).toBe(1);
});

const overlayRoot = () =>
  [...document.body.children].find((el) => el.shadowRoot)!.shadowRoot!;

test('unrecognised lines are shown in the overlay', async () => {
  const odd = line(1);
  odd.querySelector('[class*="messagePart-"]')!.innerHTML = 'Something brand new happened';
  document.body.append(makeLog(line(0), odd));
  session = start(document);
  expect(overlayRoot().querySelector('[data-warning="unparsed"]')?.textContent).toContain('1 log line');
});

test('does not re-render the overlay on unrelated page changes', async () => {
  document.body.append(makeLog(line(0)));
  const render = vi.spyOn(Overlay.prototype, 'render');
  session = start(document);
  const before = render.mock.calls.length;
  document.body.append(document.createElement('div'));
  await flush();
  expect(render.mock.calls.length).toBe(before);
  render.mockRestore();
});
