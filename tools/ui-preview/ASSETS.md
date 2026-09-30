# UI Preview Assets

The active asset set is mixed-format: four raster images generated through the bundled image-generation CLI with model `gpt-image-2.5`, plus three original hand-authored artifact SVGs. The raster prompts are recorded in [`prompts/assets.jsonl`](prompts/assets.jsonl); their original PNG sources remain in the ignored `output/imagegen/` directory. The SVG source hashes and byte sizes are recorded in `public/assets/manifest.json`. The manifest's global `provenance.model` applies only to the original raster images; `provenance.vectorAuthoring` records the separately authored vector work.

| Asset | Source dimensions | Public dimensions | Public format | Source alpha | Public alpha |
| --- | ---: | ---: | --- | --- | --- |
| `scene-battle` | 814x1931 | 814x1931 | WebP, quality 88 | none | none |
| `scene-start` | 814x1933 | 814x1933 | WebP, quality 88 | none | none |
| `player` | 1024x1536 | 512x768 | PNG | 0-254 | 0-255 |
| `enemy` | 1164x1351 | 662x768 | PNG | 0-255 | 0-255 |
| `artifact-rr09` | 256x256 SVG | 256x256 | SVG | n/a | transparent |
| `artifact-rr11` | 256x256 SVG | 256x256 | SVG | n/a | transparent |
| `artifact-rr15` | 256x256 SVG | 256x256 | SVG | n/a | transparent |

`scripts/prepare-assets.py` exports only the four active raster sources. It uses Pillow Lanczos resizing without cropping: scene exports retain their source aspect ratio and are capped at 814px wide, while character sprites are capped at 768px on the longest edge. Transparent sprites are filtered in premultiplied-alpha form without thresholding. The script leaves the active vector assets untouched. The former artifact PNG exports remain in `public/assets/` as previous-generation references and are no longer active manifest sources. Source hashes, dimensions, formats, and output byte sizes are recorded in `public/assets/manifest.json`.

`npm run test:art` decodes the actual public files in Chromium, checks sampled pixel content and transparency, exercises the real screens, and captures battle/start/choice at 320x760 and 390x844 plus the desktop comparison at 1440x900. Captures are ignored under `captures/real-art/`. This validates technical loading and measurable layout only.

**Visual approval: pending.** Neither the manifest nor browser checks assert that the art is aesthetically approved or final.
