import { describe, expect, test } from 'vitest';
import { Tracker } from '../src/tracker';
import type { HandView, Resource } from '../src/types';

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


describe('trades, steals, monopoly', () => {
  test('bank trade moves cards', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { wool: 4 } });
    t.apply({ kind: 'bankTrade', player: 'A', give: { wool: 4 }, get: { ore: 1 } });
    expect(h(t.view(), 'A')).toMatchObject({ total: 1, certain: { wool: 0, ore: 1 }, unknown: 0 });
  });

  test('player trade swaps cards', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { brick: 1 } });
    t.apply({ kind: 'gain', player: 'B', cards: { grain: 1 } });
    t.apply({ kind: 'trade', a: 'A', b: 'B', aGives: { brick: 1 }, bGives: { grain: 1 } });
    expect(h(t.view(), 'A')).toMatchObject({ total: 1, certain: { brick: 0, grain: 1 } });
    expect(h(t.view(), 'B')).toMatchObject({ total: 1, certain: { brick: 1, grain: 0 } });
  });

  test("hidden steal creates an unknown with the victim's possible resources", () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { grain: 1, wool: 2 } });
    t.apply({ kind: 'steal', thief: 'B', victim: 'A', resource: null });
    expect(h(t.view(), 'B')).toMatchObject({ total: 1, unknown: 1, possible: ['wool', 'grain'] });
    expect(h(t.view(), 'A')).toMatchObject({
      total: 2,
      certain: { wool: 1, grain: 0 },
      unknown: 1,
      possible: ['wool', 'grain'],
    });
  });

  test('a later spend resolves a hidden steal', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { grain: 1, wool: 2 } });
    t.apply({ kind: 'steal', thief: 'B', victim: 'A', resource: null });
    t.apply({ kind: 'spend', player: 'B', cards: { grain: 1 } });
    expect(h(t.view(), 'B')).toMatchObject({ total: 0, unknown: 0 });
    expect(h(t.view(), 'A')).toMatchObject({ total: 2, certain: { wool: 2 }, unknown: 0, possible: [] });
    expect(t.outOfSync).toBe(false);
  });

  test('known steal moves the named resource', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { wool: 1 } });
    t.apply({ kind: 'steal', thief: 'B', victim: 'A', resource: 'wool' });
    expect(h(t.view(), 'B')).toMatchObject({ total: 1, certain: { wool: 1 }, unknown: 0 });
    expect(h(t.view(), 'A')).toMatchObject({ total: 0 });
  });

  test('chained hidden steals', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { brick: 1, ore: 1 } });
    t.apply({ kind: 'steal', thief: 'B', victim: 'A', resource: null });
    t.apply({ kind: 'steal', thief: 'C', victim: 'B', resource: null });
    expect(h(t.view(), 'C')).toMatchObject({ total: 1, unknown: 1, possible: ['brick', 'ore'] });
    expect(h(t.view(), 'B')).toMatchObject({ total: 0 });
    expect(h(t.view(), 'A')).toMatchObject({ total: 1, unknown: 1, possible: ['brick', 'ore'] });
    t.apply({ kind: 'spend', player: 'C', cards: { ore: 1 } });
    expect(h(t.view(), 'A')).toMatchObject({ total: 1, certain: { brick: 1 }, unknown: 0 });
  });

  test('monopoly keeps only consistent splits', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'C', cards: { grain: 1, ore: 1 } });
    t.apply({ kind: 'steal', thief: 'B', victim: 'C', resource: null });
    t.apply({ kind: 'monopoly', player: 'C', resource: 'grain', count: 0 });
    expect(h(t.view(), 'B')).toMatchObject({ total: 1, certain: { ore: 1 }, unknown: 0 });
    expect(h(t.view(), 'C')).toMatchObject({ total: 1, certain: { grain: 1, ore: 0 }, unknown: 0 });
    expect(t.outOfSync).toBe(false);
  });

  test('monopoly takes the named resource from everyone else', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { grain: 2 } });
    t.apply({ kind: 'gain', player: 'B', cards: { grain: 1, ore: 1 } });
    t.apply({ kind: 'monopoly', player: 'C', resource: 'grain', count: 3 });
    expect(h(t.view(), 'C')).toMatchObject({ total: 3, certain: { grain: 3 } });
    expect(h(t.view(), 'A')).toMatchObject({ total: 0 });
    expect(h(t.view(), 'B')).toMatchObject({ total: 1, certain: { ore: 1 } });
  });
});

describe('recovery and limits', () => {
  test('impossible event sets outOfSync and clamps at zero', () => {
    const t = new Tracker();
    t.apply({ kind: 'spend', player: 'A', cards: { ore: 1 } });
    expect(t.outOfSync).toBe(true);
    expect(h(t.view(), 'A')).toMatchObject({ total: 0, unknown: 0 });
  });

  test('a known steal in recovery still gives the thief the card', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'Bob', cards: { grain: 1 } });
    t.apply({ kind: 'steal', thief: 'Alice', victim: 'Bob', resource: 'wool' });
    expect(t.outOfSync).toBe(true);
    expect(h(t.view(), 'Alice')).toMatchObject({ total: 1, certain: { wool: 1 } });
    expect(h(t.view(), 'Bob')).toMatchObject({ total: 1, certain: { grain: 1, wool: 0 } });
  });

  test('stops tracking instead of growing past the hard limit', () => {
    const t = new Tracker({ maxSplits: 1, hardLimit: 3 });
    t.apply({ kind: 'gain', player: 'A', cards: { brick: 1, wool: 1 } });
    t.apply({ kind: 'steal', thief: 'B', victim: 'A', resource: null }); // 2 splits
    t.apply({ kind: 'gain', player: 'C', cards: { brick: 1, wool: 1, ore: 1 } });
    t.apply({ kind: 'steal', thief: 'D', victim: 'C', resource: null }); // would be 6
    expect(t.splitCount).toBe(2);
    expect(t.overLimit).toBe(true);
    expect(t.stopped).toBe(true);
    t.apply({ kind: 'gain', player: 'A', cards: { ore: 5 } });
    expect(h(t.view(), 'A').certain.ore).toBe(0);
  });

  test('overLimit when splits exceed maxSplits', () => {
    const t = new Tracker({ maxSplits: 2 });
    t.apply({ kind: 'gain', player: 'A', cards: { brick: 1, wool: 1, ore: 1 } });
    t.apply({ kind: 'steal', thief: 'B', victim: 'A', resource: null });
    expect(t.splitCount).toBe(3);
    expect(t.overLimit).toBe(true);
  });
});

// The original Python SetSystem scenarios: add → gain, remove → spend,
// transfer(a, b) → hidden steal with thief b and victim a.
describe('original Python scenarios', () => {
  const gain = (t: Tracker, player: string, r: Resource, n = 1) =>
    t.apply({ kind: 'gain', player, cards: { [r]: n } });
  const spend = (t: Tracker, player: string, r: Resource, n = 1) =>
    t.apply({ kind: 'spend', player, cards: { [r]: n } });
  const transfer = (t: Tracker, victim: string, thief: string) =>
    t.apply({ kind: 'steal', thief, victim, resource: null });

  test('CASE 1', () => {
    const t = new Tracker();
    gain(t, 'red', 'grain');
    gain(t, 'red', 'wool', 2);
    transfer(t, 'red', 'green');
    spend(t, 'green', 'grain');
    expect(h(t.view(), 'red')).toMatchObject({ total: 2, certain: { wool: 2 }, unknown: 0 });
    expect(h(t.view(), 'green')).toMatchObject({ total: 0 });
    expect(t.outOfSync).toBe(false);
  });

  test('CASE 2', () => {
    const t = new Tracker();
    gain(t, 'red', 'grain');
    gain(t, 'red', 'wool');
    transfer(t, 'red', 'green');
    transfer(t, 'red', 'blue');
    spend(t, 'blue', 'wool');
    expect(h(t.view(), 'red')).toMatchObject({ total: 0 });
    expect(h(t.view(), 'green')).toMatchObject({ total: 1, certain: { grain: 1 }, unknown: 0 });
    expect(h(t.view(), 'blue')).toMatchObject({ total: 0 });
    expect(t.outOfSync).toBe(false);
  });

  test('CASE 3', () => {
    const t = new Tracker();
    gain(t, 'red', 'grain', 5);
    gain(t, 'red', 'brick');
    gain(t, 'green', 'grain');
    transfer(t, 'red', 'green');
    spend(t, 'green', 'grain');
    transfer(t, 'green', 'blue');
    expect(h(t.view(), 'red')).toMatchObject({ total: 5, unknown: 1, possible: ['brick', 'grain'] });
    expect(h(t.view(), 'green')).toMatchObject({ total: 0 });
    expect(h(t.view(), 'blue')).toMatchObject({ total: 1, unknown: 1, possible: ['brick', 'grain'] });
    expect(t.outOfSync).toBe(false);
  });

  test('CASE 4', () => {
    const t = new Tracker();
    gain(t, 'red', 'wool');
    for (const p of ['red', 'green', 'blue']) gain(t, p, 'brick', 10);
    transfer(t, 'red', 'green');
    transfer(t, 'green', 'blue');
    for (const p of ['red', 'green', 'blue']) spend(t, p, 'brick', 9);
    expect(t.outOfSync).toBe(false);
    expect(h(t.view(), 'red')).toMatchObject({ total: 1, unknown: 1, possible: ['brick', 'wool'] });
    expect(h(t.view(), 'green')).toMatchObject({ total: 1, unknown: 1, possible: ['brick', 'wool'] });
    expect(h(t.view(), 'blue')).toMatchObject({
      total: 2,
      certain: { brick: 1 },
      unknown: 1,
      possible: ['brick', 'wool'],
    });
  });
});
