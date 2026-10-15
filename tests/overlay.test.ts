// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { Overlay, formatRow } from '../src/overlay';
import type { HandView } from '../src/types';

const alice: HandView = {
  player: 'Alice',
  total: 7,
  certain: { brick: 1, lumber: 0, wool: 1, grain: 2, ore: 0 },
  unknown: 3,
  possible: ['lumber', 'ore'],
};
const bob: HandView = {
  player: 'Bob',
  total: 0,
  certain: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
  unknown: 0,
  possible: [],
};

test('formatRow with unknowns', () => {
  expect(formatRow(alice)).toBe('Alice (7)  🧱1 🐑1 🌾2  + 3 of {🌲, 🪨}');
});

test('formatRow without unknowns', () => {
  expect(formatRow(bob)).toBe('Bob (0)');
});

test('render shows one row per player, player color, and warning badges', () => {
  const host = document.createElement('div');
  const o = new Overlay(() => {});
  o.mount(host);
  o.render({ views: [alice, bob], colors: { Alice: 'rgb(255, 0, 0)' }, outOfSync: true, overLimit: false });
  const root = host.firstElementChild!.shadowRoot!;
  const rows = root.querySelectorAll<HTMLElement>('[data-row]');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toBe(formatRow(alice));
  expect(rows[0].style.color).toBe('rgb(255, 0, 0)');
  expect(root.querySelector('[data-warning="outOfSync"]')).not.toBeNull();
  expect(root.querySelector('[data-warning="overLimit"]')).toBeNull();
});

test('reset button calls onReset', () => {
  const host = document.createElement('div');
  const onReset = vi.fn();
  const o = new Overlay(onReset);
  o.mount(host);
  host.firstElementChild!.shadowRoot!.querySelector<HTMLElement>('[data-action="reset"]')!.click();
  expect(onReset).toHaveBeenCalledOnce();
});

test('render shows diagnostic detail under the out-of-sync warning', () => {
  const host = document.createElement('div');
  const o = new Overlay(() => {});
  o.mount(host);
  o.render({ views: [], colors: {}, outOfSync: true, overLimit: false, detail: 'expected 0, got 7' });
  const root = host.firstElementChild!.shadowRoot!;
  expect(root.querySelector('[data-warning="detail"]')?.textContent).toBe('expected 0, got 7');
});

test('render shows the unparsed-lines warning', () => {
  const host = document.createElement('div');
  const o = new Overlay(() => {});
  o.mount(host);
  o.render({ views: [], colors: {}, outOfSync: false, overLimit: false, unparsed: { count: 2, last: '@ did a thing' } });
  const w = host.firstElementChild!.shadowRoot!.querySelector('[data-warning="unparsed"]');
  expect(w?.textContent).toBe('⚠ 2 log lines not understood (last: "@ did a thing")');
});
