#!/usr/bin/env python3
"""Export inspected imagegen sources on a shared, hard-edged logical pixel grid."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/assets"
PALETTE = Image.new("P", (1, 1))
PALETTE.putpalette(
    [int(color[offset:offset + 2], 16)
     for color in [
         "28392f", "3e5546", "56866d", "78a18a", "a8bdb1", "c8d5c8",
         "e4ebe2", "f2f4e9", "45504a", "727f75", "9da9a0", "bfc8b8",
         "713c36", "9d3a31", "ba6053", "cf8270", "795424", "a88046",
         "c49b5c", "e1bd7a", "9a7154", "c29b7a", "e5b998", "f3d4b6",
     ]
     for offset in (0, 2, 4)] + [40, 57, 47] * (256 - 24)
)
SPECS = [
    ("battle-scene", "scene-battle", "scene", (192, 384)),
    ("start-scene", "scene-start", "scene", (192, 384)),
    ("map-scene", "scene-map", "scene", (192, 384)),
    ("player", "player", "character", (64, 96)),
    ("enemy", "enemy", "character", (64, 96)),
    ("artifact-rr09", "artifact-rr09", "artifact", (32, 32)),
    ("artifact-rr11", "artifact-rr11", "artifact", (32, 32)),
    ("artifact-rr15", "artifact-rr15", "artifact", (32, 32)),
    ("ui-panel", "ui-panel", "module", (128, 64)),
    ("ui-button-primary", "ui-button-primary", "module", (160, 32)),
    ("ui-button-secondary", "ui-button-secondary", "module", (160, 32)),
    ("ui-meter", "ui-meter", "module", (160, 16)),
]


def digest(filename):
    return hashlib.sha256(filename.read_bytes()).hexdigest()


def stats(image):
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    bbox = alpha.getbbox()
    return {
        "alphaExtrema": list(alpha.getextrema()),
        "alphaZeroPixels": histogram[0],
        "alphaNonzeroPixels": sum(histogram[1:]),
        "alphaNonzeroBBox": list(bbox),
        "alphaTransparentPaddingPx": [
            bbox[0], bbox[1], image.width - bbox[2], image.height - bbox[3],
        ],
        "paletteColors": len({
            pixel[:3] for pixel in image.get_flattened_data() if pixel[3]
        }),
    }


def palette_image(image):
    alpha = image.getchannel("A").point(lambda value: 255 if value >= 220 else 0)
    result = image.convert("RGB").quantize(
        palette=PALETTE, dither=Image.Dither.NONE
    ).convert("RGBA")
    result.putalpha(alpha)
    return result


def export(source, kind, dimensions, name):
    image = source.convert("RGBA")
    if kind == "scene":
        # Keep the generated terrace, and extend quiet sky above it.
        result = Image.new("RGBA", dimensions, "#e4ebe2")
        crop = image.crop((0, round(image.height * 0.74), image.width, image.height))
        strip = palette_image(crop.resize((192, 128), Image.Resampling.NEAREST))
        result.paste(strip, (0, 256))
        return result

    alpha = image.getchannel("A").point(lambda value: 255 if value >= 220 else 0)
    if not alpha.getbbox() or alpha.getextrema()[0] != 0:
        raise ValueError(f"{name}: native transparency required")
    image.putalpha(alpha)
    image = image.crop(alpha.getbbox())
    if kind == "module":
        result = palette_image(image.resize(dimensions, Image.Resampling.NEAREST))
        if name == "ui-button-primary":
            result.putdata([
                (157, 58, 49, a) if r > g * 1.25 and r > b * 1.25 else (r, g, b, a)
                for r, g, b, a in result.get_flattened_data()
            ])
        return result

    padding = 3 if kind == "artifact" else 4
    scale = min((dimensions[0] - padding * 2) / image.width,
                (dimensions[1] - padding * 2) / image.height)
    image = palette_image(image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.NEAREST,
    ))
    result = Image.new("RGBA", dimensions, (0, 0, 0, 0))
    result.paste(image, ((dimensions[0] - image.width) // 2,
                        dimensions[1] - padding - image.height))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path,
                        default=ROOT / "output/imagegen-pixel-kit")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    assets = []
    for asset_id, name, kind, dimensions in SPECS:
        source_name = "scene-quiet-v2" if kind == "scene" else name
        if name == "artifact-rr15":
            source_name = "artifact-rr15-v2"
        source_path = args.source_dir / f"{source_name}.png"
        destination = OUTPUT / f"{name}.png"
        if destination.exists() and not args.force:
            raise ValueError(f"{destination} exists; inspect before using --force")
        with Image.open(source_path) as original:
            result = export(original, kind, dimensions, name)
            result.save(destination, "PNG", optimize=True)
            asset = {
                "id": asset_id, "src": f"/assets/{name}.png",
                "kind": kind, "required": True,
                "source": {
                    "path": source_path.relative_to(ROOT).as_posix(),
                    "sha256": digest(source_path),
                    "dimensions": list(original.size), "mode": original.mode,
                    "origin": "imagegen",
                },
                "processed": {
                    "dimensions": list(dimensions), "format": "png",
                    "pixelArt": True, "antialias": "none",
                    "bytes": destination.stat().st_size,
                    "sha256": digest(destination),
                    **stats(result),
                },
            }
            if kind == "artifact":
                asset.update(target=asset_id, contentId=name[-4:].upper())
            elif kind == "scene":
                asset["screen"] = name.removeprefix("scene-")
            elif kind == "character":
                asset["screen"] = "battle"
            else:
                asset["slice"] = (
                    [12, 12, 12, 12] if name == "ui-panel"
                    else [4, 8, 4, 8] if name == "ui-meter"
                    else [6, 20, 6, 20]
                )
            assets.append(asset)
    manifest = {
        "schemaVersion": 1,
        "approval": {"status": "pending", "reviewedBy": None},
        "provenance": {
            "method": "imagegen pixel module kit",
            "generator": "scripts/prepare-pixel-assets.py",
            "imageModel": "gpt-image-2.5",
            "promptSet": "prompts/pixel-kit.jsonl",
            "sceneRefinement": "prompts/pixel-scene-refinement.txt",
            "pendantRefinement": "prompts/pixel-pendant-refinement.txt",
            "processing": "native alpha threshold 220; nearest-neighbor; shared 24-color palette",
        },
        "assets": assets,
    }
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"Exported {len(assets)} inspected pixel assets and manifest")


if __name__ == "__main__":
    main()
