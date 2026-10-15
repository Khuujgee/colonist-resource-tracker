# Colonist.io Resource Tracker — Design

Date: 2026-10-15
Status: Approved in conversation, pending written-spec review

## Goal

A Microsoft Edge extension (Manifest V3) that runs on colonist.io during a game, reads the
in-page game log, and shows an always-current estimate of every player's resource hand:
the cards that are certain, plus any cards whose type is uncertain (from hidden steals) and
which resources they could be.

## Constraints and scope

- Personal use only; not published to the Edge Add-ons store. The source will be public on
  GitHub, with a README note that it is a personal/educational project and that colonist.io's
  terms may not permit third-party helper tools.
- Read-only: the extension only reads what the page already displays (the game log DOM). It
  never sends anything to the game or its servers and does not intercept network traffic.
- Tracking starts at the beginning of a game. Joining a game in progress is out of scope.
- Base-game resources only: brick, lumber, wool, grain, ore.

## Display decision

Each player row shows certain cards plus unknowns, e.g.

```
Alice (7)  🌾2 🧱1 🐑1  + 3 of {🌲, 🪨}
```

No probabilities. The display ships as a page overlay; the rendering code takes a plain
data summary so it can later be moved to Edge's side panel without touching other modules.

## Architecture

```
colonist.io page
  └─ content script (content.ts)
       ├─ log watcher ── MutationObserver on the game-log container
       ├─ parser.ts ──── log-entry element → GameEvent[]
       ├─ tracker.ts ─── possible-hands logic (pure, no DOM)
       └─ overlay.ts ─── renders HandView[] into a Shadow-DOM overlay
```

Stack: plain TypeScript, bundled with esbuild into a single content script; Vitest for tests;
no UI framework; no background service worker.

### Module boundaries

| Module | Input | Output | Depends on |
|---|---|---|---|
| `types.ts` | — | `Resource`, `Cards`, `GameEvent`, `HandView` | — |
| `parser.ts` | one log-entry `Element` | `GameEvent[]` (empty if unrecognized) | `types` |
| `tracker.ts` | `GameEvent` | `HandView[]` via `view()`, `outOfSync`, `overLimit` flags | `types` |
| `overlay.ts` | `HandView[]` + flags | DOM (Shadow root) | `types` |
| `content.ts` | page DOM | wires the above together | all |

`parser` and `tracker` are pure and unit-tested in isolation. `overlay` receives a ready-made
summary only.

## Events

`Cards` is a count per resource (`Record<Resource, number>`).

| Event | Source in log | Effect on each possible split |
|---|---|---|
| `gain(p, cards)` | dice payout, starting resources, year of plenty | add `cards` to `p` |
| `spend(p, cards)` | road / settlement / city / dev card purchase, discard | subtract; drop split if any count < 0 |
| `bankTrade(p, give, get)` | 4:1, 3:1, 2:1 trades | subtract `give`, add `get`; drop if negative |
| `trade(a, b, aGives, bGives)` | accepted player trade | move cards both ways; drop if negative |
| `steal(thief, victim, res?)` | robber steal; `res` known only when the local player is involved | known: move one `res`; hidden: branch into one split per resource the victim holds ≥ 1 of |
| `monopoly(p, res, n)` | monopoly card | keep only splits where the other players' total of `res` equals `n`; then move all of it to `p` |

Build costs are expanded inside the parser:
road = brick + lumber; settlement = brick + lumber + wool + grain; city = 2 grain + 3 ore;
development card = wool + grain + ore.

Players are registered the first time they appear in any event.

## Tracker

- **State:** a set of possible splits. A split is a flat `Int` array of length
  `players × 5`, deduplicated by a string key. A new player appended later extends every
  split with five zeros. Initial state: one empty split.
- **Applying an event:** map each split through the event (possibly branching for hidden
  steals), drop invalid splits, dedupe.
- **`view()`** per player:
  - `total` — card count (identical in every split; hidden steals move exactly one card).
  - `certain[r]` — minimum count of `r` across all splits.
  - `unknown` — `total − Σ certain`.
  - `possible` — resources whose count differs between splits (non-empty iff `unknown > 0`).
- **Inconsistency recovery:** if an event leaves zero valid splits (a missed or misparsed log
  line), re-apply it to the previous splits with counts clamped at zero, and set
  `outOfSync = true`. The overlay shows this as a warning badge until a manual reset.
- **Size guard:** if the split count exceeds 5 000, set `overLimit = true` (overlay warning).
  No pruning — correctness is preferred; this is not expected in real games.

## Log watcher

- On attach, find the game-log container and parse every existing entry in order (supports a
  page reload mid-game, provided colonist keeps the full log in the DOM — to be verified).
- Then observe added entries with a `MutationObserver` and feed them to the parser in order.
- If the log container is replaced or emptied (new game), reset the tracker.
- Unrecognized entries are logged to the console (`[tracker] unparsed: …`) with a running
  counter, so log-format changes are easy to spot.
- DOM selectors live in one place (`parser.ts` / a `selectors` constant).

## Overlay

- Fixed-position box, contents in a Shadow DOM to isolate styles in both directions.
- Draggable by header; position persisted in `chrome.storage.local`.
- Collapse toggle and manual "Reset" button.
- One row per player in their in-game color: name, total, certain cards, `+ N of {…}`.
- Warning badges for `outOfSync` and `overLimit`.

## Testing

- **Tracker (Vitest):** known gains/spends, trades, hidden steal then resolving spend, chained
  hidden steals (A steals from B, C steals from A), monopoly resolving unknowns, inconsistency
  recovery, and the user's original Python CASE 1–4 scenarios rewritten with correct expected
  results.
- **Parser (Vitest + jsdom):** fixtures made from real colonist.io log HTML, one per event kind.
- **Open item:** colonist.io's current log markup is unknown. Before writing the parser, obtain
  real log HTML samples (user copies from DevTools, or captured via the browser pane during a
  game).

## Out of scope (YAGNI)

Side panel (later), probabilities, joining mid-game, expansions (Cities & Knights, Seafarers),
dev-card tracking, network interception, store publishing.
