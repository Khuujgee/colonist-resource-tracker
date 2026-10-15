// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { entryPlayerColors, isKnownNoop, parseEntry } from '../src/parser';
import { COSTS } from '../src/types';
import sample from './fixtures/sample-entries.html?raw';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = sample;
});
const entry = (i: number) => root.querySelector<HTMLElement>(`[data-index="${i}"]`)!;

/** Build an entry from the real markup with the message part replaced. */
const custom = (messageHtml: string) => {
  const el = entry(468).cloneNode(true) as HTMLElement;
  el.querySelector('[class*="messagePart-"]')!.innerHTML = messageHtml;
  return el;
};
const name = (n: string, color = '#228103') =>
  `<span style="font-weight:600;word-break:break-all;color:${color}">${n}</span>`;

describe('parseEntry on real colonist.io lines', () => {
  test('dice payout → gain', () => {
    expect(parseEntry(entry(468))).toEqual([{ kind: 'gain', player: 'Alice', cards: { grain: 2 } }]);
  });

  test('bank trade → bankTrade', () => {
    expect(parseEntry(entry(469))).toEqual([
      { kind: 'bankTrade', player: 'Bob', give: { wool: 6 }, get: { brick: 2 } },
    ]);
  });

  test('built a Road → spend road cost', () => {
    expect(parseEntry(entry(470))).toEqual([{ kind: 'spend', player: 'Bob', cards: COSTS.road }]);
  });

  test('ignores known no-op lines', () => {
    expect(parseEntry(entry(472))).toEqual([]);
    expect(isKnownNoop(entry(472))).toBe(true);
  });

  test('unrecognized lines are not known no-ops', () => {
    const el = custom(`${name('Alice')} did something new`);
    expect(parseEntry(el)).toEqual([]);
    expect(isKnownNoop(el)).toBe(false);
  });

  test('parses names with spaces and emoji', () => {
    const el = entry(468);
    el.querySelector('[class*="messagePart-"] span')!.textContent = 'Mr Bean 🐸 2';
    expect(parseEntry(el)).toEqual([{ kind: 'gain', player: 'Mr Bean 🐸 2', cards: { grain: 2 } }]);
  });
});

describe('entryPlayerColors', () => {
  test('returns name → color for every player in the line', () => {
    expect(entryPlayerColors(entry(468))).toEqual({ Alice: '#228103' });
    expect(entryPlayerColors(entry(472))).toEqual({ Alice: '#228103', Bob: '#285FBD' });
  });
});
