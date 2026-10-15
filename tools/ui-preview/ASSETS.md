# UI Preview Assets

The active set is genuine generated hand-drawn cartoon bitmap art from the configured
`gpt-image-2.5` model, using the imagegen skill's bundled CLI. Sources and reference edits
were generated on October 13, 2026. This is not the earlier deterministic flat renderer
or the rejected pixel style.

| Asset | Export Dimensions | Use |
| --- | ---: | --- |
| `scene-{battle,start,map}.png` | 390x760 | Shared quiet sky/stone stage |
| `player.png`, `enemy.png` | 384x576 | Complete, opposing cartoon characters |
| `player-{attack,rage}.png`, `enemy-attack.png` | 384x576 | Identity-preserving action poses |
| `artifact-rr{09,11,15}.png` | 192x192 | Drum, ember cup, compact jade pendant |
| `ui-panel.png` | 256x128 | Ink-edged paper frame and jade corner curls |
| `ui-button-{primary,secondary}.png` | 320x80 | Red / white painted command tokens |
| `ui-meter.png` | 320x32 | Empty hand-inked trough; fills are runtime DOM |

Source prompts are in `prompts/cartoon-kit.jsonl`, `cartoon-refinements.jsonl`,
`cartoon-scene-refinement.txt`, `cartoon-scene-cleanup.txt` and the three reference-edit prompts listed in
`cartoon-poses.md`. Ignored originals live in `output/imagegen-cartoon-kit/`.
The first character pair was too realistic; selected `*-v2` versions use compact,
explicitly cartoon proportions. The first pendant was too long, so the selected version
has a broad disc and short ties. The original detailed paving is not the final background.
The second scene erroneously included two characters; the inspected `scene-v3` edit removes
them completely. Only the final empty terrace is used behind separately rendered characters.

`scripts/prepare-cartoon-assets.py` crops source silhouettes, removes translucent haze
with an alpha threshold of 200, then resizes with Lanczos to retain smooth ink edges.
No chroma-key claim: transparent sources already contain alpha. The primary red fill is
normalized to `#af453a` for white text. Scene export extends plain `#f1f4ef` sky above the
generated lower terrace; it is not a tint overlay or CSS gradient.

Art uses smooth browser scaling. Scalable UI borders retain corner geometry using
inspected source slice margins: panel 24 all around, button 16/44/16/44,
meter 8/16/8/16 (top/right/bottom/left). The live overview scales real screen DOMs.

The manifest records source and export hashes, dimensions, byte counts, alpha bounds,
visible color counts and slice margins. The offline decoder validates RGBA pixels independently
with chunk CRC and scanline-filter checks. Original sources are not included in Git;
committed public exports are self-contained. Earlier SVG/WebP files are inactive.
Screenshot exports are produced only by `capture:previews`.

Legacy fallback action images preserve the character identity through reference edits. They remain
whole-image poses, not layered animation rigs. Runtime switching is explicitly marked
`illustrated-poses` only when the DragonBones renderer or rig library is unavailable.
No Spine runtime or vendor example art is distributed here.
See [`SPINE.md`](SPINE.md) for the separate feasibility investigation.
The previous skeletal repair reused these generated assets. It is now superseded by the
full-body frame player described in [`ANIMATION.md`](ANIMATION.md).

## Map, Methods And Shared Items

The new batch uses the same configured `gpt-image-2.5` through the imagegen skill CLI.
Prompts: `prompts/cartoon-expansion.jsonl`. Ignored originals:
`output/imagegen-cartoon-expansion/`. Committed exports:

| Family | Exports | Use |
| --- | ---: | --- |
| `rig-rkf01.png` through `rig-rkf04.png` | 4 at 768x768 | Guardian, fighter, healer, fire mage |
| `rig-rkf05.png`, `rig-en-a1-l1.png` | 2 at 1024x768 | Rebuilt swordsman and stone guardian, twelve independent parts |
| `map-{coast,stairs,forest,gate,rest,shop}.png` | 6 at 192x192 | Small map illustrations |
| `icon-*.png` | 19 at 192x192 | Shared vessel/item forms and special artifact silhouettes |

`scripts/prepare-expansion-assets.py` extracts the nine large connected character silhouettes,
assigns them by their centers, trims duplicate waist cloth, and fits each to an atlas slot.
This avoids the cut heads and neighboring fragments produced by exact grid cropping.
Items and map illustrations use their inspected atlas cells; boots are derived from the
swordsman's leg art. Native alpha and Lanczos edges are preserved.
`scripts/enrich-art-library.mjs` reads only the explicit `content/shanhai/manifest.yaml` entries,
adding names, attributes and descriptions without changing YAML. Source and export hashes,
part bounds, mapping and provenance are recorded in `public/assets/library.json`.

The rebuilt pair uses ignored originals in `output/imagegen-rig-rebuild/`,
the prompts in `prompts/rig-{sword,stone}-v2*.txt` and the inspected crop specification
`prompts/rig-rebuild-spec.json`. `scripts/prepare-rig-assets.py` exports the twelve-part
`layered-v2` layout, including separate front/rear arms and a fist drawn over the handle.
It preserves native alpha and records the actual atlas dimensions, regions and hashes.
The October 14 motion repair reuses these current exports without generating new artwork.

The 44 artifact mappings use shared icons where possible, and dedicated images for all five
legendary artifacts plus selected distinctive rare items. An art identity is not a gameplay
uniqueness rule. The browser catalog lets the reviewer inspect all mappings and real attributes.

**Overall cartoon style: approved by the user. New assets and animation: pending.**
Main-session screenshot inspection and automated checks do not replace user acceptance.

## Full-Body Combat Cels, 2026-10-15

Six new atlases, `frames-rkf01.png` through `frames-rkf05.png` and
`frames-en-a1-l1.png`, replace the layered cutouts in the active renderer.
Each is 1200x1792, containing twelve fixed 400x448 full-body cels.
All 72 poses were reference-edited with `gpt-image-2.5` using the imagegen skill CLI.
They are newly drawn complete characters, not baked skeletal screenshots.

`prompts/combat-flipbook.txt` and `combat-frame-subjects.json` preserve the shared prompt,
exact identity instructions and references. `combat-stone-spacing.txt` records the
stone guardian refinement. Ignored originals live in `output/imagegen/combat-frames/`.
`scripts/prepare-combat-frames.py` extracts connected silhouettes, removes low-alpha haze,
uses one scale per character and aligns boot anchors. It does not slice through a
long weapon at a nominal grid boundary or include neighboring characters inside that crop.
The 400x448 cell includes room below the foot anchor for lowered weapon tips.

`public/assets/frames.json` records original/export hashes, dimensions, source bounds,
reviewed floor overrides, fixed scales and anchors. Fresh clones use the committed
exports without original files or generation credentials. Hit and guard share one
defensive drawing with different playback; this is limited-key-pose animation, not
an independent drawing for every render tick. New art remains pending visual approval.
