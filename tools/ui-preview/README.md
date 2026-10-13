# Shanhai UI Preview

A four-screen interactive presentation prototype: start, route selection, combat, and
artifact choice. It uses actual `gpt-image-2.5` generated hand-drawn cartoon assets,
including reusable panel, button and meter modules. Chinese text and progress values are real
DOM elements, never painted into the generated artwork.

This is a visual preview, not the production game. It does not import the game runtime,
change content, or save a run. The two sample routes converge on `EN-A1-L1` 养锋石卫.
Combat playback is a looping three-action layout fixture, not an engine simulation.
User visual approval remains pending.

## Run and Verify

From this directory:

```bash
npm run dev
npm test
npm run test:layout
npm run test:art
npm run test:assets
npm run test:surfaces
npm run capture:previews
npm run probe:spine
```

The server binds to `0.0.0.0:4174`. Public entry:
`http://sg.229465154.xyz:4174/?screen=overview`.

- `/?screen=overview`: four actual screen DOMs, desktop row or mobile 2x2.
- `/?screen=start|map|battle|choice`: individual interactive screen.
- `/?screen=battle&capture=1`: full-viewport battle without the preview toolbar.
- `/?screen=compare`: four 320x760 desktop samples.
- `/?screen=map&node=coast`: directly open a partial encounter preview.

The overview does not use exported screenshots, iframes, or cloned screens. Its game
controls are inert; the title links open the real screens. The shared router supports
browser history. Screenshot export writes `public/previews/{start,map,battle,choice}.png`;
these are optional external exports and are not loaded by the overview.

`npm test` covers serving boundaries, traversal, headers, CSP and a PNG decoder audit.
`test:layout` uses structural fixtures to check routing, touch targets, dialogs, failed
asset loading and the full interaction flow. `test:art` uses all real image exports and
checks decoded pixels, responsive geometry, sprite/control overlap, smooth illustration
rendering, action-pose swaps, shield absorption, merged damage, pause, speed, detail
snapshots and reduced motion.
`test:surfaces` checks module references and the controlled text palette.

Browser captures beneath ignored `captures/cartoon-art/` cover 320x568, 320x760, 390x844 and
1440x900, both toolbar-framed and full-screen phone layouts. Tests do not approve artwork.

## Asset Contract

`public/assets/manifest.json` declares fifteen required assets: three scene exports, two
characters, three items, four reusable UI modules, and three action poses. Eight illustration
IDs map to ten image placements. Modules and poses are decoded before readiness;
modules use CSS nine-slice borders. A missing module or pose keeps capture disabled.

All active artwork is lossless RGBA PNG with smooth ink edges, not a pixel filter.
Native generated transparency is thresholded before Lanczos resizing to remove haze.
Scenes reuse one inspected background crop and reserve the upper 548 of 760 rows for
plain cool-white sky. Primary-button red is normalized for text contrast.
Details and provenance: [`ASSETS.md`](ASSETS.md).

`npm run prepare:assets` requires the local ignored imagegen sources and Pillow via `uv`.
It exports assets and records hashes; it does not call a model, capture screenshots or
publish Git changes. Fresh clones can render and test committed public PNGs without
imagegen credentials. Earlier flat and pixel generators are inactive; do not run them
over the current cartoon assets.

The five basic methods are `RKF01` through `RKF05`; the three artifact choices use
`RR09`, `RR11`, `RR15`. Compact cues omit details but the inspection dialog preserves
conditions, including the fact that 震岳鼓 does not itself grant shield retaliation.
The editable 命数（种子） is seed text. Route lines use a local canvas, not a changed
route-generation system.

## Boundaries

The sample flow is `启程` -> node preview -> battle -> artifact choice -> map.
State lives only in page memory. Chosen items do not affect the sample battle.
Playback starts from player 640/920 HP, 180 shield, 36 rage and enemy 344/450 HP,
50 shield, 44 rage. Each action's three hits are summed into one feedback line;
shield is consumed before HP. The fixture resets after three actions.

Pause stops both numeric playback and animation. Details freeze both and show the current
snapshot; closing resumes unless manually paused. Leaving battle cancels its timer and
restores idle artwork. Reduced motion removes pose changes, character movement and bar
transitions. Ordinary and rage attacks use distinct generated poses, not just moving one PNG.

## Spine

The current animation is explicitly `illustrated-poses`, not Spine. See [`SPINE.md`](SPINE.md)
for the verified browser path, asset production checklist, version matching, license
requirements and integration proposal. `probe:spine` evaluates the vendor's published player
on its own website and records captures privately. It is a network-dependent optional check,
not part of offline tests, and does not embed or redistribute vendor assets.

Only public HTML, `styles.css`, `cartoon.css`, application script, manifest, exact preview exports
and approved asset names are served. Prompts, generators, imagegen sources, package
metadata and paths outside `public/` remain private. Production game and docs site are
unchanged by this preview.
