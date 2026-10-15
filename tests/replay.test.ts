// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { parseEntry } from '../src/parser';
import { Tracker } from '../src/tracker';
import type { GameEvent } from '../src/types';
import game1 from './fixtures/game-1.html?raw';

/**
 * Replays a whole real game (Alice is the local player) through parser + tracker,
 * applying `extra` events just before the given line numbers.
 */
function replay(html: string, me: string, extra: Record<number, GameEvent[]> = {}, until = Infinity) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const t = new Tracker();
  const entries = [...root.querySelectorAll<HTMLElement>('[data-index]')].sort(
    (a, b) => Number(a.dataset.index) - Number(b.dataset.index),
  );
  for (const el of entries) {
    const i = Number(el.dataset.index);
    if (i > until) break;
    for (const e of [...(extra[i] ?? []), ...parseEntry(el, me)]) {
      t.apply(e);
      if (t.outOfSync) throw new Error(`out of sync at line ${el.dataset.index}: ${JSON.stringify(e)}`);
    }
  }
  return t;
}

// When this log was captured, chat lines overwrote log lines 30–34, which held
// the first roll's payouts. Two lost payouts are pinned down by evidence:
// - Alice +1 grain: the screenshot at line 164 shows her real hand.
// - Bob +1 grain: his discards at lines 147 and 207 (5 and 4 cards) are half his
//   hand only if he held one more card than the log alone accounts for.
const LOST: Record<number, GameEvent[]> = {
  30: [
    { kind: 'gain', player: 'Alice', cards: { grain: 1 } },
    { kind: 'gain', player: 'Bob', cards: { grain: 1 } },
  ],
};

test('a full real game replays without ever going out of sync', () => {
  const t = replay(game1, 'Alice', LOST);
  expect(t.outOfSync).toBe(false);
  expect(t.overLimit).toBe(false);
});

test("Alice's tracked hand matches the real game at line 164", () => {
  const alice = replay(game1, 'Alice', LOST, 164)
    .view()
    .find((v) => v.player === 'Alice')!;
  expect(alice).toMatchObject({
    total: 5,
    certain: { brick: 0, lumber: 2, wool: 0, grain: 1, ore: 2 },
    unknown: 0,
  });
});
