# Colonist.io Resource Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Edge (Manifest V3) extension that reads the colonist.io game log and shows each player's certain resource cards plus their unknown cards in a draggable overlay.

**Architecture:** A single content script. `parser.ts` turns log-entry elements into `GameEvent`s, `tracker.ts` keeps the set of every possible card split and summarises it, `overlay.ts` renders the summary in a Shadow-DOM box, and `content.ts` wires them to a `MutationObserver` on the log. Parser and tracker are pure and unit-tested.

**Tech Stack:** TypeScript 5, esbuild (bundling), Vitest + jsdom (tests), Manifest V3, no UI framework, no background worker.

**Spec:** `docs/superpowers/specs/2026-10-15-colonist-resource-tracker-design.md`

## Global Constraints

- Manifest V3; content script only; matches `https://colonist.io/*`; only permission is `storage`.
- Read-only: never send anything to the game, never intercept network traffic.
- Resources (exact identifiers, in this order): `brick`, `lumber`, `wool`, `grain`, `ore`.
- Build costs: road = brick + lumber; settlement = brick + lumber + wool + grain; city = 2 grain + 3 ore; development card = wool + grain + ore.
- Split-count warning threshold: 5 000 (`overLimit`), no pruning.
- Display format per row: `Name (total) <certain cards> + N of {<possible>}`; the `+ …` part only when `unknown > 0`. No probabilities.
- Unparsed log entries are logged as `[tracker] unparsed: <text>` with a running counter.
- README states the project is personal/educational and that colonist.io's terms may not permit third-party tools.

## Review Focus

1. **Entries processed twice** — the initial replay and the `MutationObserver` can both see the same entry on attach; each entry must be applied exactly once (Task 6 test `processes each entry once`).
2. **The local player shown as "You"** — if colonist writes the local player as "You" in some lines, those events must resolve to the same player name as the rest of the log (Task 4 test `maps "You" to the local player name`, written against whichever form the fixtures show).
3. **Player names with spaces, digits or emoji** — must parse as one player (Task 4 test `parses names with spaces and emoji`).
4. **Non-resource log lines** (dice roll announcements, robber moved, chat, "has no cards to steal") — must change nothing and must not be counted as errors for lines that are known no-ops (Task 4 test `ignores known no-op lines`).
5. **Log trimming** — if colonist removes old entries, removals alone must not reset the tracker; only a replaced or fully emptied log container resets (Task 6 test `does not reset when old entries are removed`).

---

## File structure

```
manifest.json            MV3 manifest (copied into dist/ by build)
package.json, tsconfig.json, vitest.config.ts, build.mjs
src/types.ts             Resource, Cards, GameEvent, HandView, RESOURCES, COSTS
src/tracker.ts           Tracker class (pure)
src/parser.ts            SELECTORS, parseEntry, entryPlayerColors (pure over a DOM Element)
src/overlay.ts           Overlay class (Shadow DOM)
src/content.ts           wiring: find log, replay, observe, reset
tests/tracker.test.ts
tests/parser.test.ts
tests/fixtures/*.html    real colonist.io log entries
tests/overlay.test.ts
tests/content.test.ts
README.md
```

---

### Task 1: Project scaffold, types, and tracker basics (gain / spend / view)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (`node_modules`, `dist`), `src/types.ts`, `src/tracker.ts`
- Test: `tests/tracker.test.ts`

**Interfaces:**
- Produces (`src/types.ts`):
  ```ts
  export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;
  export type Resource = (typeof RESOURCES)[number];
  export type Cards = Partial<Record<Resource, number>>;
  export const COSTS: Record<'road' | 'settlement' | 'city' | 'devCard', Cards>;
  export type GameEvent =
    | { kind: 'gain'; player: string; cards: Cards }
    | { kind: 'spend'; player: string; cards: Cards }
    | { kind: 'bankTrade'; player: string; give: Cards; get: Cards }
    | { kind: 'trade'; a: string; b: string; aGives: Cards; bGives: Cards }
    | { kind: 'steal'; thief: string; victim: string; resource: Resource | null }
    | { kind: 'monopoly'; player: string; resource: Resource; count: number };
  export interface HandView {
    player: string;
    total: number;
    certain: Record<Resource, number>;
    unknown: number;
    possible: Resource[]; // in RESOURCES order
  }
  ```
- Produces (`src/tracker.ts`):
  ```ts
  export class Tracker {
    constructor(opts?: { maxSplits?: number }); // default 5000
    apply(event: GameEvent): void;
    view(): HandView[];          // players in first-seen order
    reset(): void;
    readonly outOfSync: boolean;
    readonly overLimit: boolean;
    readonly splitCount: number;
  }
  ```

- [ ] **Step 1: Scaffold.** `npm init -y`; dev-deps `typescript vitest jsdom esbuild @types/chrome`; scripts `"test": "vitest run"`, `"build": "node build.mjs"` (build.mjs is added in Task 6). `tsconfig`: `strict`, `target ES2022`, `module ESNext`, `moduleResolution bundler`, `lib ["ES2022","DOM"]`, `noEmit`. `vitest.config.ts`: default environment `node`.

- [ ] **Step 2: Write failing tests** in `tests/tracker.test.ts`:

  ```ts
  test('gain then spend gives certain cards', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { grain: 2, brick: 1 } });
    t.apply({ kind: 'spend', player: 'A', cards: { grain: 1 } });
    expect(t.view()).toEqual([{ player: 'A', total: 2,
      certain: { brick: 1, lumber: 0, wool: 0, grain: 1, ore: 0 }, unknown: 0, possible: [] }]);
  });
  test('players appear in first-seen order', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'B', cards: { ore: 1 } });
    t.apply({ kind: 'gain', player: 'A', cards: { ore: 1 } });
    expect(t.view().map(v => v.player)).toEqual(['B', 'A']);
  });
  test('reset clears players and flags', () => { /* gain, reset → view() is [] and splitCount is 1 */ });
  ```

- [ ] **Step 3: Run** `npm test` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/types.ts` and the `Tracker` basics.** State: `players: string[]`, `splits: Map<string, Int32Array>` keyed by `split.join(',')`, initially one empty split. Registering a new player appends 5 zeros to every split. `view()`: per player `certain[r] = min` over splits, `total = max` over splits of the player's sum (equal in every split unless out of sync), `unknown = total − Σcertain`, `possible` = resources whose count is not identical across all splits.

- [ ] **Step 5: Run** `npm test` — Expected: PASS.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: scaffold project and tracker gain/spend"`

---

### Task 2: Tracker — trades, steals, monopoly, recovery, size guard

**Files:**
- Modify: `src/tracker.ts`
- Test: `tests/tracker.test.ts`

**Interfaces:**
- Consumes: `Tracker`, `GameEvent`, `HandView` from Task 1. No new public API.

- [ ] **Step 1: Write failing tests** (`h(v, name)` = helper that finds a player's `HandView`):

  ```ts
  test('bank trade and player trade move cards', () => {
    // A gains 4 wool; bankTrade A gives 4 wool gets 1 ore → A certain ore 1, total 1
    // A gains brick 1, B gains grain 1; trade A gives brick, B gives grain → A grain 1, B brick 1
  });
  test('hidden steal creates an unknown with the victim\'s possible resources', () => {
    const t = new Tracker();
    t.apply({ kind: 'gain', player: 'A', cards: { grain: 1, wool: 2 } });
    t.apply({ kind: 'steal', thief: 'B', victim: 'A', resource: null });
    expect(h(t.view(), 'B')).toMatchObject({ total: 1, unknown: 1, possible: ['wool', 'grain'] });
    expect(h(t.view(), 'A')).toMatchObject({ total: 2, certain: { wool: 1, grain: 0 }, unknown: 1, possible: ['wool', 'grain'] });
  });
  test('a later spend resolves a hidden steal', () => {
    // continue previous: B spends grain 1 → B total 0; A certain wool 2, unknown 0
  });
  test('known steal moves the named resource', () => { /* A wool 1; steal B←A wool → B wool 1 certain */ });
  test('chained hidden steals', () => {
    // A: brick 1, ore 1. B steals hidden from A. C steals hidden from B.
    // C total 1 possible ['brick','ore']; B total 0; A total 1 possible ['brick','ore'].
    // C spends ore 1 → A certain brick 1, unknown 0.
  });
  test('monopoly keeps only consistent splits', () => {
    // C: grain 1, ore 1. B steals hidden from C. C plays monopoly grain, count 0
    // → only the split where B took the ore survives:
    //   B certain ore 1 unknown 0; C certain grain 1 ore 0 unknown 0
  });
  test('impossible event sets outOfSync and clamps at zero', () => {
    const t = new Tracker();
    t.apply({ kind: 'spend', player: 'A', cards: { ore: 1 } });
    expect(t.outOfSync).toBe(true);
    expect(h(t.view(), 'A')).toMatchObject({ total: 0, unknown: 0 });
  });
  test('overLimit when splits exceed maxSplits', () => {
    // new Tracker({ maxSplits: 2 }); A gains 1 of each of three resources; B steals hidden → 3 splits → overLimit true
  });
  ```

  Fill the commented assertions with exact `toMatchObject` values as described.

- [ ] **Step 2: Run** `npm test` — Expected: new tests FAIL.

- [ ] **Step 3: Implement `apply` for all event kinds.** Each event maps one split to zero or more splits:
  - `bankTrade` = spend `give` then gain `get`; `trade` = move `aGives` a→b and `bGives` b→a; drop the split if any count < 0.
  - hidden `steal`: one output split per resource with victim count ≥ 1 (victim −1, thief +1). If the victim has 0 cards in a split, that split produces nothing.
  - `monopoly`: keep only splits where Σ over other players of `resource` equals `count`; then set others to 0 and add `count` to the player.
  - Recovery: if the result is empty, re-run on the previous splits in clamp mode (negative counts become 0; hidden steal from an empty victim gives the thief nothing; monopoly skips the filter and gives the player `count`), and set `outOfSync = true`.
  - After each event, `overLimit ||= splits.size > maxSplits`.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: tracker trades, steals, monopoly, recovery"`

---

### Task 3: Tracker — the original Python scenarios as regression tests

**Files:**
- Test: `tests/tracker.test.ts` (tests only; fix `src/tracker.ts` if any fail)

Python `t.add(p, r)` → `gain`, `t.remove(p, r)` → `spend`, `t.transfer(a, b)` → hidden `steal` with thief `b`, victim `a`.

- [ ] **Step 1: Write the tests:**
  - `CASE 1`: red gains grain, wool, wool; green steals hidden from red; green spends grain → red certain wool 2 (unknown 0), green total 0.
  - `CASE 2`: red gains grain, wool; green steals from red; blue steals from red; blue spends wool → red total 0, green certain grain 1, blue total 0.
  - `CASE 3`: red gains 5 grain + brick; green gains grain; green steals from red; green spends grain; blue steals from green → red total 5 possible ['brick','grain']; green total 0; blue total 1 possible ['brick','grain'].
  - `CASE 4`: red gains wool + 10 brick; green and blue gain 10 brick each; green steals from red; blue steals from green; red, green, blue each spend 9 brick → no `outOfSync`; red total 1 possible ['brick','wool']; green total 1 unknown 1 possible ['brick','wool']; blue total 2 certain brick 1 unknown 1 possible ['brick','wool'].

- [ ] **Step 2: Run** `npm test` — Expected: PASS (fix the tracker if not, and say what was wrong in the commit message).

- [ ] **Step 3: Commit** `git commit -am "test: port original Python scenarios"`

---

### Task 4: Parser (needs real log HTML first)

**Files:**
- Create: `src/parser.ts`, `tests/fixtures/*.html`
- Test: `tests/parser.test.ts` (`// @vitest-environment jsdom` at top)

**Interfaces:**
- Consumes: `GameEvent`, `Cards`, `Resource`, `COSTS` from Task 1.
- Produces:
  ```ts
  export const SELECTORS: { logContainer: string; logEntry: string };
  export function parseEntry(el: Element, localPlayer?: string): GameEvent[]; // [] = no resource effect
  export function isKnownNoop(el: Element): boolean; // dice-roll text, robber moved, chat, etc.
  export function entryPlayerColors(el: Element): Record<string, string>; // name → CSS color
  ```

- [ ] **Step 1: Collect fixtures.** Blocked on the user. During a real game (ideally 4 players, including at least one steal involving the user and one not), copy the log container's `outerHTML` from DevTools into `tests/fixtures/game-log.html`. Alternatively capture it with the browser pane while the user is in a game. Note from the fixture: the container and entry selectors, how resources are represented (likely `<img alt="…">`), how names and colors appear, and whether the local player appears as "You".

- [ ] **Step 2: Write failing tests**, one per log form found in the fixture. Each test selects one entry from the fixture and asserts the exact `GameEvent[]`:
  - `starting resources` → `gain`
  - `dice payout` → `gain` (one entry per player, or several events if one line covers several players)
  - `builds road / settlement / city / buys dev card` → `spend` with `COSTS.*`
  - `discard` → `spend`
  - `bank/port trade` → `bankTrade`
  - `player trade` → `trade`
  - `hidden steal` → `steal` with `resource: null`
  - `steal involving the local player` → `steal` with the resource
  - `monopoly` → `monopoly` with count
  - `year of plenty` → `gain`
  - Review Focus tests: `maps "You" to the local player name`, `parses names with spaces and emoji` (edit a fixture entry's name to `"Mr Bean 🐸 2"`), `ignores known no-op lines` (dice-roll, robber moved, chat → `parseEntry` returns `[]` and `isKnownNoop` is true).
  - `entryPlayerColors` returns the name → color map from a payout entry.

- [ ] **Step 3: Run** `npm test` — Expected: parser tests FAIL.

- [ ] **Step 4: Implement `parser.ts`** with all selectors and text patterns in one `SELECTORS`/pattern table at the top. Read resources from the image markup (not emoji text). Build events use `COSTS`.

- [ ] **Step 5: Run** `npm test` — Expected: PASS.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: parse colonist.io log entries"`

---

### Task 5: Overlay

**Files:**
- Create: `src/overlay.ts`
- Test: `tests/overlay.test.ts` (`// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: `HandView`, `Resource` from Task 1.
- Produces:
  ```ts
  export interface OverlayState { views: HandView[]; colors: Record<string, string>; outOfSync: boolean; overLimit: boolean; }
  export function formatRow(v: HandView): string; // text of one row
  export class Overlay {
    constructor(onReset: () => void);
    mount(parent?: HTMLElement): void;   // default document.body
    render(state: OverlayState): void;
  }
  ```
  Emoji per resource: brick 🧱, lumber 🌲, wool 🐑, grain 🌾, ore 🪨.

- [ ] **Step 1: Write failing tests:**
  ```ts
  test('formatRow with unknowns', () => {
    expect(formatRow({ player: 'Alice', total: 7, certain: { brick: 1, lumber: 0, wool: 1, grain: 2, ore: 0 },
      unknown: 3, possible: ['lumber', 'ore'] })).toBe('Alice (7)  🧱1 🐑1 🌾2  + 3 of {🌲, 🪨}');
  });
  test('formatRow without unknowns', () => { /* 'Bob (0)' for an empty hand */ });
  test('render shows one row per player, player color, and warning badges', () => {
    // mount on a div, render two views with outOfSync true → shadowRoot has 2 elements [data-row],
    // first row style.color equals colors[name], an element [data-warning="outOfSync"] exists
  });
  test('reset button calls onReset', () => { /* click [data-action="reset"] in shadowRoot */ });
  ```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement** with an attached shadow root (`mode: 'open'`), fixed position, a header that drags the box and saves `{x, y, collapsed}` under the `chrome.storage.local` key `overlayPos` (guard with `typeof chrome !== 'undefined' && chrome.storage` so tests run), a collapse toggle `[data-action="collapse"]`, and a reset button `[data-action="reset"]`.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: overlay"`

---

### Task 6: Content script, manifest, build, README

**Files:**
- Create: `src/content.ts`, `manifest.json`, `build.mjs`, `README.md`
- Test: `tests/content.test.ts` (`// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: `Tracker` (Task 1), `SELECTORS`, `parseEntry`, `isKnownNoop`, `entryPlayerColors` (Task 4), `Overlay`, `OverlayState` (Task 5).
- Produces:
  ```ts
  export function start(doc?: Document): { stop(): void; tracker: Tracker }; // content.ts also calls start() at top level unless imported by tests (guard with `if (typeof chrome !== 'undefined' && chrome.runtime?.id) start()`)
  ```

- [ ] **Step 1: Write failing tests** (using fixture entries from Task 4 inserted into a jsdom container matching `SELECTORS.logContainer`):
  - `replays existing entries on start` — container pre-filled with a payout entry → `tracker.view()` shows it.
  - `processes each entry once` — append an entry right after `start()`, flush microtasks → it is counted once (track processed elements in a `WeakSet`).
  - `does not reset when old entries are removed` — remove the first entry → view unchanged.
  - `resets when the container is emptied or replaced` — replace the container with a new empty one → `view()` is `[]`.
  - `waits for the log container to appear` — `start()` before the container exists, then insert it → entries are processed.

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `start`.** Observe `doc.body` (`childList`, `subtree`) to find or re-find the container; observe the container for added entries. Each new entry: `parseEntry` → `tracker.apply` for each event; if `[]` and not `isKnownNoop`, increment the counter and `console.debug('[tracker] unparsed:', text)`; merge `entryPlayerColors`; re-render the overlay. On reset (overlay button or container replaced/emptied), call `tracker.reset()` and clear colors.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Add `manifest.json`** (`manifest_version: 3`, `name: "Colonist Resource Tracker"`, `version: "0.1.0"`, `permissions: ["storage"]`, one content script `content.js` on `https://colonist.io/*` with `run_at: "document_idle"`) **and `build.mjs`** (esbuild bundles `src/content.ts` → `dist/content.js`, format `iife`, target `es2022`; copies `manifest.json` into `dist/`).

- [ ] **Step 6: Run** `npm run build` — Expected: `dist/content.js` and `dist/manifest.json` exist; `npx tsc` reports no errors.

- [ ] **Step 7: Manual test in Edge.** `edge://extensions` → Developer mode → Load unpacked → `dist/`. Play or spectate a game: overlay appears, rows update on payouts/builds/steals, drag position survives reload, reload mid-game replays the log. Report anything not working.

- [ ] **Step 8: Write `README.md`** — what it does, a screenshot placeholder line removed once a real screenshot exists, install steps (build + Load unpacked), how the possible-splits tracking works (one paragraph), and the personal/educational disclaimer from Global Constraints.

- [ ] **Step 9: Commit** `git add -A && git commit -m "feat: content script, manifest, build and README"`
