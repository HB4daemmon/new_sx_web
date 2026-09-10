# Implementation notes

This repository implements the supplied MVP as a deterministic, JSON-driven Mobile Web Roguelite.

## Runtime

The runtime uses TypeScript and native Web Components rather than a package-heavy UI framework. This is intentional: the game is a static, offline-capable single-player app and the delivery environment could not resolve npm registry hosts. The architecture still keeps pure rules (`engine`), presentation (`app`), procedural SVG art (`art`), and content (`data/game.json`) separate.

The visual direction uses an original dark Chinese-mythology card-print aesthetic, branching mountain-scroll map, gold/jade/cinnabar accents, and procedural character/relic SVGs. No Balatro or Slay the Spire assets, fonts, music, code, or copied UI art are included.

## Determinism

Random streams are separated into `route`, `reward`, `shop`, `event`, and `combat`. The save stores seed, content/rules versions, generated route/stock/replay state, RNG cursors, causal state, and the action log. Combat is fully resolved before playback, so 1x/2x/4x/pause/skip only changes presentation.

## Verification

- 25 rule/invariant tests pass.
- 120 automated runs (40 per origin) terminate in either victory or death; all three origins have winning seeds under the same no-cheat heuristic policy.
- Browser smoke flow covers cover → character/fate → route → combat → reward → event → remount save → build view.
- Responsive checks cover 375x667, 390x844, 414x896, 430x932, and 750x1334 with no horizontal overflow.

Because this execution environment blocks browser navigation to local URLs, the browser harness injects the standalone `PLAY.html` into Chromium and uses an in-memory Storage-compatible adapter. The same exact standalone artifact is shipped to the user; the production static build uses normal browser `localStorage`.

Automated simulation is a regression/balance signal, not an estimate of human win rate. The current heuristic results show the Warrior/shield path is stronger than the other two origins and is the first balance target for a later content patch.
