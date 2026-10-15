import { RESOURCES, type Cards, type GameEvent, type HandView, type Resource } from './types';

const N = RESOURCES.length;

/** One possible assignment of cards: counts[playerIndex * N + resourceIndex]. */
type Split = Int32Array;

/**
 * Tracks every card split that is consistent with the events seen so far.
 * Known events are applied to every split; hidden steals branch a split into
 * one copy per resource the victim could have given; splits that would need a
 * negative count are dropped.
 */
export class Tracker {
  private players: string[] = [];
  private splits = new Map<string, Split>();
  private readonly maxSplits: number;
  private _outOfSync = false;
  private _overLimit = false;

  constructor(opts: { maxSplits?: number } = {}) {
    this.maxSplits = opts.maxSplits ?? 5000;
    this.reset();
  }

  get outOfSync(): boolean {
    return this._outOfSync;
  }

  get overLimit(): boolean {
    return this._overLimit;
  }

  get splitCount(): number {
    return this.splits.size;
  }

  reset(): void {
    this.players = [];
    this.splits = new Map([['', new Int32Array(0)]]);
    this._outOfSync = false;
    this._overLimit = false;
  }

  apply(event: GameEvent): void {
    for (const p of playersOf(event)) this.index(p);

    let next = this.step(event, false);
    if (next.size === 0) {
      next = this.step(event, true);
      this._outOfSync = true;
    }
    this.splits = next;
    if (this.splits.size > this.maxSplits) this._overLimit = true;
  }

  view(): HandView[] {
    const all = [...this.splits.values()];
    return this.players.map((player, p) => {
      const certain = {} as Record<Resource, number>;
      const possible: Resource[] = [];
      let total = 0;
      RESOURCES.forEach((r, ri) => {
        let min = Infinity;
        let max = -Infinity;
        for (const s of all) {
          const c = s[p * N + ri];
          min = Math.min(min, c);
          max = Math.max(max, c);
        }
        certain[r] = min;
        if (max !== min) possible.push(r);
      });
      for (const s of all) total = Math.max(total, sum(s, p));
      const known = RESOURCES.reduce((acc, r) => acc + certain[r], 0);
      return { player, total, certain, unknown: total - known, possible };
    });
  }

  /** Index of a player, registering them (with zero cards) if new. */
  private index(player: string): number {
    let i = this.players.indexOf(player);
    if (i >= 0) return i;
    i = this.players.length;
    this.players.push(player);
    const grown = new Map<string, Split>();
    for (const s of this.splits.values()) {
      const g = new Int32Array(s.length + N);
      g.set(s);
      grown.set(g.join(','), g);
    }
    this.splits = grown;
    return i;
  }

  /** Apply an event to every split. With `clamp`, counts floor at zero instead of dropping the split. */
  private step(event: GameEvent, clamp: boolean): Map<string, Split> {
    const out = new Map<string, Split>();
    for (const s of this.splits.values()) {
      for (const r of this.applyToSplit(s, event, clamp)) out.set(r.join(','), r);
    }
    return out;
  }

  private applyToSplit(src: Split, e: GameEvent, clamp: boolean): Split[] {
    const s = src.slice();
    const ok = (() => {
      switch (e.kind) {
        case 'gain':
          return add(s, this.index(e.player), e.cards, 1, clamp);
        case 'spend':
          return add(s, this.index(e.player), e.cards, -1, clamp);
        default:
          return true;
      }
    })();
    return ok ? [s] : [];
  }
}

function playersOf(e: GameEvent): string[] {
  switch (e.kind) {
    case 'trade':
      return [e.a, e.b];
    case 'steal':
      return [e.victim, e.thief];
    default:
      return [e.player];
  }
}

function sum(s: Split, p: number): number {
  let t = 0;
  for (let ri = 0; ri < N; ri++) t += s[p * N + ri];
  return t;
}

/** Add `sign * cards` to player p. Returns false if a count would go negative (unless clamping). */
function add(s: Split, p: number, cards: Cards, sign: 1 | -1, clamp: boolean): boolean {
  for (let ri = 0; ri < N; ri++) {
    const n = cards[RESOURCES[ri]] ?? 0;
    if (!n) continue;
    const v = s[p * N + ri] + sign * n;
    if (v < 0 && !clamp) return false;
    s[p * N + ri] = Math.max(0, v);
  }
  return true;
}
