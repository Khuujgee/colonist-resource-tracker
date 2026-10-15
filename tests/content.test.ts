// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
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

test('resets when the log container is replaced (new game)', async () => {
  const log = makeLog(line(0));
  document.body.append(log);
  session = start(document);
  log.replaceWith(makeLog());
  await flush();
  expect(session.tracker.view()).toEqual([]);
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
