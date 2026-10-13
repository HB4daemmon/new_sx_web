# UI Preview Assets

The active set is generated bitmap pixel art from the configured `gpt-image-2.5` model,
using the imagegen skill's bundled CLI. Ten initial assets and two targeted refinements
were generated on October 13, 2026. This is not the earlier hand-drawn flat renderer.

| Asset | Logical Dimensions | Use |
| --- | ---: | --- |
| `scene-{battle,start,map}.png` | 192x384 | Shared quiet sky/stone stage |
| `player.png`, `enemy.png` | 64x96 | Complete, opposing full-body sprites |
| `artifact-rr{09,11,15}.png` | 32x32 | Drum, ember cup, compact jade pendant |
| `ui-panel.png` | 128x64 | Jade-stone frame and copper corner fittings |
| `ui-button-{primary,secondary}.png` | 160x32 | Red lacquer / jade command modules |
| `ui-meter.png` | 160x16 | Empty status trough; fills are runtime DOM |

Source prompts are in `prompts/pixel-kit.jsonl`, `pixel-scene-refinement.txt` and
`pixel-pendant-refinement.txt`. Ignored originals live in `output/imagegen-pixel-kit/`.
The first scene's railings were rejected; the refined scene has just quiet sky, low
mountain silhouettes and a shallow floor. The first pendant's long cord made its jade
body too small; the selected refinement uses a broad pendant and short ties.

`scripts/prepare-pixel-assets.py` crops the visible source silhouettes, removes generated
low-alpha fringe with a threshold of 220, exports with nearest-neighbor, and maps colors
without dithering to a shared 24-color palette. No invented background-removal claim:
the transparent sources already have alpha. The primary red fill is normalized to
`#9d3a31` for white text. Scene export extends plain `#e4ebe2` sky, not a tint overlay.

Sprite display uses integer 2x scale in battle, 2x/3x on start, and 2x for items.
Scalable UI borders retain their corner geometry using inspected slice margins:
panel 12 all around, button 6/20/6/20, meter 4/8/4/8 (top/right/bottom/left).
The live overview is intentionally a scaled thumbnail, not a pixel-perfect play surface.

The manifest records source and export hashes, dimensions, byte counts, alpha bounds,
palette counts and slice margins. The offline decoder validates RGBA pixels independently
with chunk CRC and scanline-filter checks. Original sources are not included in Git;
committed public exports are self-contained. Earlier SVG/WebP files are inactive.
Screenshot exports are produced only by `capture:previews`.

**User visual approval: pending.** Main-session screenshot inspection and automated
checks do not stand in for the user's acceptance of this direction.
