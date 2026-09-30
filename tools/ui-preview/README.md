# Shanhai UI Preview

An isolated style overview and three-screen mobile mockup for battle, run start, and artifact choice. It uses native HTML, CSS, and JavaScript and does not import the game runtime or root dependencies. It is a presentation prototype, not a playable game; example combat values are static samples.

## Run and verify

From this directory:

```bash
npm run dev
npm test
npm run test:layout
npm run test:art
npm run capture:previews
```

The preview server binds to `0.0.0.0:4174`. Open the style overview at `http://localhost:4174/?screen=overview`; the root URL also opens this view. The three complete screenshot previews link to the existing interactive samples, and the shared navigation supports direct URLs plus browser back/forward. The desktop comparison remains available as an optional view.

`npm test` uses Node's built-in test runner and exercises the static-file allowlist, traversal rejection, and CSP. `npm run test:layout` uses an already-installed Playwright module when available; it starts a temporary loopback server on an ephemeral port and checks mobile layouts, interactions, capture sizes, and desktop comparison. Its temporary 1x1 PNG fixtures test loading and decoding only. `npm run test:art` uses the same cached Playwright setup and the real local assets without request interception; it checks decoded pixels, overview screenshots, mobile captures, interactions, animation, and browser errors. It writes ignored screenshots under `captures/real-art/` and `captures/style-overview/`. Neither browser test grants visual approval.

The overview screenshots under `public/previews/` are captured from the real 320x760 sample screens, not miniature interactive layouts. Run `npm run capture:previews` explicitly after changing the sample UI or assets. This command starts its own temporary loopback server, uses the existing local Playwright/browser installation, and overwrites only those three screenshots; normal tests, builds, and watchers do not regenerate them. Ordinary preview screens are exactly 320x760 CSS pixels, have no decorative phone frame, and can be opened directly with `?screen=battle`, `?screen=start`, or `?screen=choice`. Capture mode fills the actual viewport and hides the toolbar. The desktop comparison remains three 320x760 samples side by side.

## Asset contract

`public/assets/manifest.json` is the module-local asset interface. It lists required IDs, paths, roles, targets, source content IDs, and a separate manual approval state. Paths must be local PNG or WebP files directly under `public/assets/`; both extensions are supported so generated PNG files do not require conversion.

Preferred names:

- `scene-battle.webp` or `scene-battle.png`: full-screen battle environment.
- `scene-start.webp` or `scene-start.png`: full-screen run-start environment.
- `player.png` or `player.webp`, `enemy.png` or `enemy.webp`: transparent battle character art.
- `artifact-rr09.png` or `artifact-rr09.webp`: drum-shaped art for `RR09` 震岳鼓.
- `artifact-rr11.png` or `artifact-rr11.webp`: cup-shaped art for `RR11` 余烬盏.
- `artifact-rr15.png` or `artifact-rr15.webp`: pendant-shaped art for `RR15` 定心佩.

The three artifact choices are static visual fixtures from `content/shanhai/artifacts/rare/RR09.yaml`, `RR11.yaml`, and `RR15.yaml`. 震岳鼓 shows 防御 +8 and the cue `盾返后回怒`; its full detail states that an existing shield reflect must deal damage and that the artifact does not grant reflection. 余烬盏 shows 最大气血 +30 and `毒燃伤害回怒`; it responds once per round to actual HP damage from self-applied poison or burn, not damage fully absorbed by shield. 定心佩 shows 最大气血 +30 and `外来削怒减半`; its detail preserves the additive resistance cap and exclusions. Every artifact has its own `详` button and detail dialog. These artifacts have `summary`, not `quick`, fields in the content source.

The start screen offers only the five basic methods from `content/shanhai/methods/RKF01.yaml` through `RKF05.yaml`: 金刚功, 归元诀, 回春功, 御火诀, and 养剑诀. The editable `命数（种子）` field is seed text, not lives. The battle opponent is `EN-A1-L1` 养锋石卫, whose method is 养剑诀; all shown combat values are static layout samples.

The selected imagegen sources are preserved in the ignored `output/imagegen/` directory. To build into an empty asset directory, run `uv run --with pillow --no-project python scripts/prepare-assets.py`. To deliberately refresh existing public exports after inspecting the changed sources, add `--force`. Provenance, source hashes, dimensions, prompt references, and the processing record are in `ASSETS.md` and `public/assets/manifest.json`.

The page sets runtime `data-assets-ready="true"` only after every required image loads and every matching target decodes, including repeated battle-scene and player placements. This enables `截图样稿`, which creates a **待确认样稿** capture view. Runtime `data-visual-approval` and manifest `approval.status` remain `pending`; the browser never marks visual approval. Until assets load, the toolbar says `待装入正式素材`; flat neutral debugging surfaces are intentional, not substitute scenery or character illustrations.

Expected composition: battle and start scenes should be composed for 320x760 and 390x844 portrait captures; the battle scene leaves the top corners and bottom controls legible. Player and enemy art should have transparent backgrounds and fit their opposing positions. Artifact images should be legible in a compact, roughly 82x82 area. The target palette is natural greens, gray-white, vermilion, and restrained gold. The selected assets are loaded but remain pending visual review.

## Boundaries

The preview controls only change local presentation state. They do not start a run, advance combat, or read/write game state. The server only exposes the public HTML, stylesheet, script, manifest, three exact screenshot preview paths, and approved asset filename patterns; module scripts, package metadata, and files outside `public/` are not served.
