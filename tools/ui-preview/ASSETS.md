# UI Preview Assets

The seven selected images were generated through the bundled image-generation CLI with model `gpt-image-2.5`. Their prompts are recorded in [`prompts/assets.jsonl`](prompts/assets.jsonl), in the same order as the asset IDs below. The original PNG sources remain in the ignored `output/imagegen/` directory; the public files are processed exports.

| Asset | Source dimensions | Public dimensions | Public format | Source alpha | Public alpha |
| --- | ---: | ---: | --- | --- | --- |
| `scene-battle` | 814x1931 | 814x1931 | WebP, quality 88 | none | none |
| `scene-start` | 814x1933 | 814x1933 | WebP, quality 88 | none | none |
| `player` | 1024x1536 | 512x768 | PNG | 0-254 | 0-255 |
| `enemy` | 1164x1351 | 662x768 | PNG | 0-255 | 0-255 |
| `artifact-rr09` | 1312x1199 | 512x468 | PNG | 0-255 | 0-255 |
| `artifact-rr11` | 1254x1254 | 512x512 | PNG | 0-255 | 0-255 |
| `artifact-rr15` | 1222x1287 | 486x512 | PNG | 0-255 | 0-255 |

`scripts/prepare-assets.py` uses Pillow Lanczos resizing without cropping. Scene exports retain their source aspect ratio and are capped at 814px wide. Character sprites are capped at 768px on the longest edge; artifact images are capped at 512px. Transparent exports are filtered in premultiplied-alpha form and keep their alpha channel without thresholding. Source SHA-256 hashes, dimensions, formats, and output byte sizes are recorded in `public/assets/manifest.json`.

`npm run test:art` decodes the actual public files in Chromium, checks sampled pixel content and transparency, exercises the real screens, and captures battle/start/choice at 320x760 and 390x844 plus the desktop comparison at 1440x900. Captures are ignored under `captures/real-art/`. This validates technical loading and measurable layout only.

**Visual approval: pending.** Neither the manifest nor browser checks assert that the art is aesthetically approved or final.
