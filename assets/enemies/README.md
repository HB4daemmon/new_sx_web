# Enemy Art

The manifest maps all 34 content-library enemy IDs to independent frame atlases.
The existing `EN-A1-L1` stone guardian is reused; the other 33 atlases were generated
with `gpt-image-2.5` using the bundled imagegen CLI. New artwork is agent-reviewed,
not yet user-approved. This metadata is separate from the earlier approved player art.

Each atlas contains twelve independently drawn complete poses in a 3 by 4 grid.
Cells are 400 by 448 pixels with a fixed foot anchor at `(160, 420)`. Every pose
uses the same uniform scale. `bodyHeight` records the maximum visual size across
the full motion set: `max(height, width * 0.85)`, rounded to the nearest pixel.

Prompts are in `tools/ui-preview/prompts/enemies/`. Original generation results
and review contact sheets are local authoring files in `output/imagegen/enemies/`;
they are not published or required to build the game. Their hashes and dimensions
remain in the manifest. Source tests additionally verify originals when present.

To re-export from locally available originals:

```sh
uv run --with pillow python scripts/prepare-enemy-art.py --prepare
node --test tests/shanhai-enemy-source.test.mjs tests/shanhai-art-assets.test.mjs
```

The production build verifies the content IDs, PNG hashes, frame rectangles, actual
dimensions, independent enemy mappings and review metadata before publishing.
