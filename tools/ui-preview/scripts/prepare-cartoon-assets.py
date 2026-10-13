#!/usr/bin/env python3
"""Export inspected imagegen illustrations without pixel quantization."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/assets"
SPECS = [
    ("battle-scene", "scene-battle", "scene", (390, 760), "scene-v3"),
    ("start-scene", "scene-start", "scene", (390, 760), "scene-v3"),
    ("map-scene", "scene-map", "scene", (390, 760), "scene-v3"),
    ("player", "player", "character", (384, 576), "player-v2"),
    ("enemy", "enemy", "character", (384, 576), "enemy-v2"),
    ("artifact-rr09", "artifact-rr09", "artifact", (192, 192), "artifact-rr09"),
    ("artifact-rr11", "artifact-rr11", "artifact", (192, 192), "artifact-rr11"),
    ("artifact-rr15", "artifact-rr15", "artifact", (192, 192), "artifact-rr15-v2"),
    ("ui-panel", "ui-panel", "module", (256, 128), "ui-panel"),
    ("ui-button-primary", "ui-button-primary", "module", (320, 80), "ui-button-primary"),
    ("ui-button-secondary", "ui-button-secondary", "module", (320, 80), "ui-button-secondary"),
    ("ui-meter", "ui-meter", "module", (320, 32), "ui-meter"),
    ("player-attack", "player-attack", "pose", (384, 576), "player-attack"),
    ("player-rage", "player-rage", "pose", (384, 576), "player-rage"),
    ("enemy-attack", "enemy-attack", "pose", (384, 576), "enemy-attack"),
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


def export(source, kind, dimensions, name):
    image = source.convert("RGBA")
    if kind == "scene":
        # Preserve the generated lower path; give every label a truly quiet backing.
        result = Image.new("RGBA", dimensions, "#f1f4ef")
        crop = image.crop((0, round(image.height * 0.66), image.width, image.height))
        strip = crop.resize((390, 212), Image.Resampling.LANCZOS)
        result.paste(strip, (0, 548))
        return result

    alpha = image.getchannel("A")
    if not alpha.getbbox() or alpha.getextrema()[0] != 0:
        raise ValueError(f"{name}: native transparency required")
    # Reject generated translucent haze; resampling retains smooth silhouette edges.
    alpha = alpha.point(lambda value: 255 if value >= 200 else 0)
    image.putalpha(alpha)
    image = image.crop(alpha.getbbox())
    if kind == "module":
        result = image.resize(dimensions, Image.Resampling.LANCZOS)
        if name == "ui-button-primary":
            # The central paint stays dark enough for actual white DOM lettering.
            result.putdata([
                (175, 69, 58, a) if r > g * 1.35 and r > b * 1.35 and r > 110
                else (r, g, b, a)
                for r, g, b, a in result.get_flattened_data()
            ])
        return result

    padding = 16 if kind == "artifact" else 24
    scale = min((dimensions[0] - padding * 2) / image.width,
                (dimensions[1] - padding * 2) / image.height)
    image = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    result = Image.new("RGBA", dimensions, (0, 0, 0, 0))
    result.paste(image, ((dimensions[0] - image.width) // 2,
                        dimensions[1] - padding - image.height))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path,
                        default=ROOT / "output/imagegen-cartoon-kit")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    assets = []
    for asset_id, name, kind, dimensions, source_name in SPECS:
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
                    "pixelArt": False, "antialias": "lanczos",
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
            elif kind == "pose":
                asset["actor"] = name.split("-")[0]
                asset["action"] = name.split("-")[1]
            else:
                asset["slice"] = (
                    [24, 24, 24, 24] if name == "ui-panel"
                    else [8, 16, 8, 16] if name == "ui-meter"
                    else [16, 44, 16, 44]
                )
            assets.append(asset)
    manifest = {
        "schemaVersion": 1,
        "approval": {"status": "pending", "reviewedBy": None},
        "provenance": {
            "method": "imagegen hand-drawn cartoon kit",
            "generator": "scripts/prepare-cartoon-assets.py",
            "imageModel": "gpt-image-2.5",
            "promptSet": "prompts/cartoon-kit.jsonl",
            "refinements": "prompts/cartoon-refinements.jsonl",
            "sceneRefinement": "prompts/cartoon-scene-refinement.txt",
            "sceneCleanup": "prompts/cartoon-scene-cleanup.txt",
            "posePrompts": "prompts/cartoon-poses.md",
            "processing": "native alpha threshold 200; lanczos; quiet extended sky",
            "animation": "illustrated pose swaps; not Spine skeletal animation",
        },
        "assets": assets,
    }
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"Exported {len(assets)} inspected hand-drawn assets and manifest")


if __name__ == "__main__":
    main()
