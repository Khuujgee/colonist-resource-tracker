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
  private readonly hardLimit: number;
  private _outOfSync = false;
  private _overLimit = false;
  private _stopped = false;

  /**
   * maxSplits: above this, overLimit is set (a warning).
   * hardLimit: an event that would exceed this stops tracking, so the page never freezes.
   */
  constructor(opts: { maxSplits?: number; hardLimit?: number } = {}) {
    this.maxSplits = opts.maxSplits ?? 5000;
    this.hardLimit = opts.hardLimit ?? 200_000;
    this.reset();
  }

  get outOfSync(): boolean {
    return this._outOfSync;
  }

  get overLimit(): boolean {
    return this._overLimit;
  }

  /** True once tracking stopped because it would have exceeded the hard limit. */
  get stopped(): boolean {
    return this._stopped;
  }

  get splitCount(): number {
    return this.splits.size;
  }

  reset(): void {
    this.players = [];
    this.splits = new Map([['', new Int32Array(0)]]);
    this._outOfSync = false;
    this._overLimit = false;
    this._stopped = false;
  }

  apply(event: GameEvent): void {
    if (this._stopped) return;
    for (const p of playersOf(event)) this.index(p);

    let next = this.step(event, false);
    if (next.size === 0) {
      next = this.step(event, true);
      this._outOfSync = true;
    }
    if (next.size > this.hardLimit) {
      this._stopped = true;
      this._overLimit = true;
      return;
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
    switch (e.kind) {
      case 'gain':
        return add(s, this.index(e.player), e.cards, 1, clamp) ? [s] : [];
      case 'spend':
        return add(s, this.index(e.player), e.cards, -1, clamp) ? [s] : [];
      case 'bankTrade': {
        const p = this.index(e.player);
        return add(s, p, e.give, -1, clamp) && add(s, p, e.get, 1, clamp) ? [s] : [];
      }
      case 'trade': {
        const a = this.index(e.a);
        const b = this.index(e.b);
        const ok =
          add(s, a, e.aGives, -1, clamp) &&
          add(s, b, e.aGives, 1, clamp) &&
          add(s, b, e.bGives, -1, clamp) &&
          add(s, a, e.bGives, 1, clamp);
        return ok ? [s] : [];
      }
      case 'steal': {
        const thief = this.index(e.thief);
        const victim = this.index(e.victim);
        const options = e.resource ? [RESOURCES.indexOf(e.resource)] : RESOURCES.map((_, ri) => ri);
        const out: Split[] = [];
        for (const ri of options) {
          if (src[victim * N + ri] < 1) continue;
          const b = src.slice();
          b[victim * N + ri] -= 1;
          b[thief * N + ri] += 1;
          out.push(b);
        }
        if (out.length === 0 && clamp) {
          // The victim had none we know of. A named card still goes to the thief;
          // an unknown one can't be placed, so the thief stays a card short.
          if (e.resource) s[thief * N + RESOURCES.indexOf(e.resource)] += 1;
          out.push(s);
        }
        return out;
      }
      case 'monopoly': {
        const p = this.index(e.player);
        const ri = RESOURCES.indexOf(e.resource);
        let others = 0;
        for (let q = 0; q < this.players.length; q++) if (q !== p) others += s[q * N + ri];
        if (others !== e.count && !clamp) return [];
        for (let q = 0; q < this.players.length; q++) if (q !== p) s[q * N + ri] = 0;
        s[p * N + ri] += e.count;
        return [s];
      }
    }
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
