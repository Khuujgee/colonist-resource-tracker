# Colonist Resource Tracker

A Microsoft Edge (Manifest V3) extension that reads the game log on
[colonist.io](https://colonist.io) and shows, in a small draggable overlay, which
resource cards each player holds:

```
Alice (7)  🧱1 🐑1 🌾2  + 3 of {🌲, 🪨}
```

The cards before the `+` are certain. Cards after it come from steals you
couldn't see, together with the resources they could be.

> **Disclaimer:** this is a personal, educational project. It only reads what the
> page already shows and never sends anything to the game. colonist.io's terms may
> not permit third-party helper tools; use it at your own discretion.

## Install

```bash
npm install
npm run build
```

Then in Edge open `edge://extensions`, turn on **Developer mode**, click
**Load unpacked** and choose the `dist/` folder. Open a game on colonist.io and the
overlay appears in the top-right corner. Drag it by its header, collapse it, or
press **Reset** to start over.

## How it works

Every log line becomes an event (gain, spend, bank trade, player trade, steal,
monopoly). The tracker keeps a list of **every way the cards could currently be
split between the players**. Known events are applied to each possible split. A
steal you couldn't see turns each split into one copy per resource the victim
could have given. Any split that would need a negative card count is dropped.
That's how a later build or trade settles what a stolen card was. The overlay
shows, per player, the lowest count of each resource across all splits (the
certain cards) and which resources vary (the unknowns).

colonist.io's log is a virtual list: only the lines on screen exist in the page.
The extension therefore tracks each line by its position in the log, applies
lines in order and once each, and warns ("out of sync") if it ever missed lines.
That happens, for example, after reloading the page mid-game.

## Development

```bash
npm test        # Vitest: tracker, parser, overlay, content script
npx tsc -p .    # type-check
```

| File | Role |
|---|---|
| `src/parser.ts` | log line element → events |
| `src/tracker.ts` | possible-splits logic (no DOM) |
| `src/overlay.ts` | the on-page overlay |
| `src/content.ts` | watches the log and wires it all together |
