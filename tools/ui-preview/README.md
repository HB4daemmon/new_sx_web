# Shanhai UI Preview

A four-screen interactive presentation prototype: start, route selection, combat, and
artifact choice. It uses actual `gpt-image-2.5` generated hand-drawn cartoon assets,
including reusable panel, button and meter modules. Chinese text and progress values are real
DOM elements, never painted into the generated artwork.

This is a visual preview, not the production game. It does not import the game runtime,
change content, or save a run. The two sample routes converge on `EN-A1-L1` 养锋石卫.
Combat playback is a looping six-beat layout fixture, not an engine simulation.
The user approved the current cartoon artwork and drawn-frame motions for the production
game on 2026-10-15. This preview remains a separate fixture and does not run or save a game.

## Run and Verify

From this directory:

```bash
npm ci
npm run build:animation
npm run dev
npm test
npm run test:layout
npm run test:art
npm run test:assets
npm run test:surfaces
npm run test:rig
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
- `/?screen=battle&method=RKF03`: physician skin; `RKF01` through `RKF05` are supported.
- The toolbar's `宝` opens a 44-item catalog populated from the actual content library.

The overview does not use exported screenshots, iframes, or cloned screens. Its game
controls are inert; the title links open the real screens. The shared router supports
browser history. Screenshot export writes `public/previews/{start,map,battle,choice}.png`;
these are optional external exports and are not loaded by the overview.

`npm test` checks reproducible runtime builds, notices, real DragonBones parsing,
serving boundaries, traversal, headers, CSP and a PNG decoder audit.
`test:layout` uses structural fixtures to check routing, touch targets, dialogs, failed
asset loading and the full interaction flow. `test:art` uses all real image exports and
checks decoded pixels, responsive geometry, sprite/control overlap, smooth illustration
rendering, action-pose swaps, shield absorption, merged damage, pause, speed, detail
snapshots and reduced motion.
`test:surfaces` checks module references and the controlled text palette.
`test:rig` checks five distinct rendered method skins, all 31 library raster exports,
canvas movement and frozen pixels, timed impacts, six action beats, both opponents,
catalog navigation, reduced motion, leaving battle, and texture/WebGL failure fallback.
It also decodes all 72 complete character cels, checks distinct pose pixels and transparent
padding, and samples every action in three real actor-canvas sizes for clipping.
Contact-frame timing, cancellation, pause and reduced-motion settlement are covered.
The suite also checks normalized method stature in both start and battle canvases,
wider opponent spacing, and actual rage-effect pixels, side palettes, phases and cleanup.
Six fixed-scale attack/rage contact sheets are written to `captures/frames/`.
Retained DragonBones parser tests describe the previous implementation, not the active player.

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

`public/assets/library.json` augments, rather than replaces, the baseline asset contract.
It declares six legacy layered atlases, six map illustrations
and nineteen icon exports. Shared icons cover all 44 real artifacts; all five legendary items
have dedicated images. Character parts are extracted from connected silhouettes, not blindly
cut at grid boundaries. `npm run prepare:expansion` needs the ignored generated originals and
the existing content-kit dependencies. It slices art, then enriches names and attributes from
the explicit YAML manifest. No model or publishing command runs during this export.

## Boundaries

The sample flow is `启程` -> node preview -> battle -> artifact choice -> map.
State lives only in page memory. Chosen items do not affect the sample battle.
Playback starts from player 640/920 HP, 180 shield, 36 rage and enemy 344/450 HP,
50 shield, 44 rage. Each action's three hits are summed into one feedback line;
shield is consumed before HP. After these three attacks, the guardian activates 镇心玉,
the player receives a representative 36-point heal, and the guardian performs a 152-point
rage attack. These illustrative values are not method-specific balance claims. The fixture
then resets; neither the heal nor artifact beat mutates gameplay content or a real run.

Pause stops both numeric playback and animation. Details freeze both and show the current
snapshot; closing resumes unless manually paused. Leaving battle cancels its timer and
restores idle artwork. Reduced motion removes character movement and bar transitions, preserving
one pending impact; if paused, it is committed only on resume. Method appearance is also retained
in the preview's query string. No run state is persisted.

`public/rig.js` now compiles the pinned PixiJS full-body frame player from `src/frames.js`.
`public/assets/frames.json` declares six 12-cel atlases generated with `gpt-image-2.5`.
These are independently drawn complete poses, not screenshots baked from the old skeleton.
Attack, rage, artifact, heal, hit and guard have distinct playback sequences; hit and guard
share the defensive cel but differ in timing and recoil.
One transparent WebGL canvas renders both combatants; a separate static canvas previews the method.
Only the presentation fixture supplies impacts; the renderer performs no damage calculation or RNG.
The original full-body illustrations and pose swaps remain as a failure fallback.
Each character uses one fixed cel size, scale and boot anchor across actions.
The manifest's ready-body measurements normalize all six to a 300px reference stature;
this same per-character correction applies on the start and battle screens, independent
of weapon length. Wider stances retain rearward recoil and lowered-weapon padding.
Rage alone adds timed charge marks, a luminous directional stroke and impact sparks:
jade diamonds for the player, vermilion/gold chevrons for the enemy. Effects share the
frame clock and pause/reduced-motion lifecycle; no screen flash or camera shake is used.
Lowered weapon tips retain space below the feet. No limb stitching or flexible mesh is used.
`npm run prepare:frames` exports the ignored originals without calling a model.
Fresh clones render and test committed PNGs without credentials or original source files.
The production build also consumes this committed public asset source: it validates the
approval records and PNG hashes, publishes only the three scenes, four UI modules, assets
referenced by the 44 artifact mappings, six map illustrations and six frame atlases, then
copies `rig.js` as the game's animation module with its MIT notice. It does not publish the
preview app, old layered rigs, WebP scene drafts, prompts or authoring tools.

## Open-Source Animation

The current animation is explicitly `drawn-frames`, not DragonBones or Spine.
See [`ANIMATION.md`](ANIMATION.md) for authoring sources, clock ownership and test boundaries.
The active player uses MIT-licensed PixiJS. Previous skeletal sources and their MIT notices
are retained for reference and offline parser tests, but are not bundled into the active player.
`SPINE.md` retains the prior evaluation; `probe:spine` is optional and unrelated to the selected
runtime. No Spine runtime or vendor character is distributed.

Only public HTML, `styles.css`, `cartoon.css`, application and rig scripts, manifests, exact preview exports
and approved asset names and animation notices are served. Prompts, generators, imagegen sources, package
metadata and paths outside `public/` remain private. Production game and docs site are
unchanged by this preview.
