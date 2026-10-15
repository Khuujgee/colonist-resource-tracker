import { describe, expect, test } from 'vitest';
import { Tracker } from '../src/tracker';
import type { HandView } from '../src/types';

const h = (views: HandView[], name: string) => {
  const v = views.find((x) => x.player === name);
  if (!v) throw new Error(`no player ${name}`);
  return v;
};

describe('basics', () => {
  test('gain then spend gives certain cards', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { grain: 2, brick: 1 } });
    t.apply({ kind: 'spend', player: 'A', cards: { grain: 1 } });
    expect(t.view()).toEqual([
      {
        player: 'A',
        total: 2,
        certain: { brick: 1, lumber: 0, wool: 0, grain: 1, ore: 0 },
        unknown: 0,
        possible: [],
      },
    ]);
  });

  test('players appear in first-seen order', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'B', cards: { ore: 1 } });
    t.apply({ kind: 'gain', player: 'A', cards: { ore: 1 } });
    expect(t.view().map((v) => v.player)).toEqual(['B', 'A']);
  });

  test('reset clears players and flags', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { ore: 1 } });
    t.reset();
    expect(t.view()).toEqual([]);
    expect(t.splitCount).toBe(1);
    expect(t.outOfSync).toBe(false);
    expect(t.overLimit).toBe(false);
  });
});

