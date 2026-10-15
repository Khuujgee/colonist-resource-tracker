// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { entryPlayerColors, isKnownNoop, parseEntry } from '../src/parser';
import { COSTS } from '../src/types';
import game1 from './fixtures/game-1.html?raw';
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

describe('parseEntry on a full game (tests/fixtures/game-1.html, local player Alice)', () => {
  let game: HTMLElement;
  beforeEach(() => {
    game = document.createElement('div');
    game.innerHTML = game1;
  });
  const line = (i: number) => game.querySelector<HTMLElement>(`[data-index="${i}"]`)!;
  const parse = (i: number) => parseEntry(line(i), 'Alice');

  test('starting resources → gain', () => {
    expect(parse(17)).toEqual([{ kind: 'gain', player: 'Alice', cards: { lumber: 2, grain: 1 } }]);
  });
  test('discard → spend', () => {
    expect(parse(59)).toEqual([{ kind: 'spend', player: 'Carol', cards: { grain: 4, wool: 1 } }]);
  });
  test('hidden steal → steal with unknown resource', () => {
    expect(parse(61)).toEqual([{ kind: 'steal', thief: 'Carol', victim: 'Bob', resource: null }]);
  });
  test('development card purchase → spend devCard cost', () => {
    expect(parse(89)).toEqual([{ kind: 'spend', player: 'Dave', cards: COSTS.devCard }]);
  });
  test('"You stole" → known steal by the local player', () => {
    expect(parse(95)).toEqual([{ kind: 'steal', thief: 'Alice', victim: 'Bob', resource: 'wool' }]);
  });
  test('"stole … from you" → known steal from the local player', () => {
    expect(parse(157)).toEqual([{ kind: 'steal', thief: 'Dave', victim: 'Alice', resource: 'grain' }]);
  });
  test('built a City / Settlement with a VP suffix → spend', () => {
    expect(parse(108)).toEqual([{ kind: 'spend', player: 'Carol', cards: COSTS.city }]);
    expect(parse(144)).toEqual([{ kind: 'spend', player: 'Alice', cards: COSTS.settlement }]);
  });
  test('player trade → trade', () => {
    expect(parse(134)).toEqual([
      { kind: 'trade', a: 'Dave', b: 'Alice', aGives: { ore: 1 }, bGives: { grain: 1 } },
    ]);
    expect(parse(143)).toEqual([
      { kind: 'trade', a: 'Alice', b: 'Bob', aGives: { wool: 1, grain: 1 }, bGives: { lumber: 1 } },
    ]);
  });

  test.each([
    [0, 'welcome message'],
    [1, 'turn separator'],
    [2, 'disconnected'],
    [3, 'reconnected'],
    [4, 'placed a Settlement'],
    [5, 'placed a Road'],
    [30, 'chat message'],
    [37, 'rolled'],
    [56, 'trade offer'],
    [60, 'moved Robber'],
    [69, 'blocked by the Robber'],
    [155, 'used Knight'],
  ])('line %i (%s) is a known no-op', (i) => {
    expect(parse(i)).toEqual([]);
    expect(isKnownNoop(line(i))).toBe(true);
  });

  test('chat text that looks like a log line is ignored', () => {
    const chat = line(30);
    chat.querySelector('[class*="messagePart-"]')!.innerHTML = `${name('Carol')} got <img src="x/card_ore.svg" alt="Ore">`;
    expect(parse(30)).toEqual([]);
  });

  test('every line in the game is understood', () => {
    const unknown = [...game.querySelectorAll<HTMLElement>('[data-index]')]
      .filter((el) => parseEntry(el, 'Alice').length === 0 && !isKnownNoop(el))
      .map((el) => `${el.dataset.index}: ${el.textContent!.trim()}`);
    expect(unknown).toEqual([]);
  });
});
