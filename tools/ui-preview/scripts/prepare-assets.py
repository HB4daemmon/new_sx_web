#!/usr/bin/env python3
"""Export the active raster imagegen sources into compact public preview assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

from PIL import Image


MODULE_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = MODULE_ROOT / "output" / "imagegen"
OUTPUT_ROOT = MODULE_ROOT / "public" / "assets"
EXPORTS = {
    "scene-battle": {"output": "scene-battle.webp", "kind": "scene", "limit": 814},
    "scene-start": {"output": "scene-start.webp", "kind": "scene", "limit": 814},
    "player": {"output": "player.png", "kind": "sprite", "limit": 768},
    "enemy": {"output": "enemy.png", "kind": "sprite", "limit": 768},
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dimensions_for(width: int, height: int, limit: int) -> tuple[int, int]:
    scale = min(1.0, limit / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def export_image(source: Path, destination: Path, kind: str, limit: int) -> dict:
    with Image.open(source) as original:
        original.load()
        source_width, source_height = original.size
        if kind == "scene":
            image = original.convert("RGB")
            scale = min(1.0, limit / source_width)
            output_size = (
                max(1, round(source_width * scale)),
                max(1, round(source_height * scale)),
            )
            if output_size != image.size:
                image = image.resize(output_size, Image.Resampling.LANCZOS)
            image.save(destination, "WEBP", quality=88, method=6)
            alpha = None
            alpha_preserved = False
        else:
            if "A" not in original.getbands():
                raise ValueError(f"Transparent source required for {source.name}")
            output_size = dimensions_for(source_width, source_height, limit)
            image = original.convert("RGBa")
            if output_size != image.size:
                image = image.resize(output_size, Image.Resampling.LANCZOS)
            image = image.convert("RGBA")
            image.save(destination, "PNG", optimize=True)
            alpha = list(image.getchannel("A").getextrema())
            alpha_preserved = True

        return {
            "source": source.relative_to(MODULE_ROOT).as_posix(),
            "sourceSha256": sha256(source),
            "sourceDimensions": [source_width, source_height],
            "sourceMode": original.mode,
            "sourceAlphaExtrema": (
                list(original.getchannel("A").getextrema())
                if "A" in original.getbands()
                else None
            ),
            "output": destination.name,
            "outputDimensions": list(output_size),
            "outputBytes": destination.stat().st_size,
            "outputAlphaExtrema": alpha,
            "alphaPreserved": alpha_preserved,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=SOURCE_ROOT,
        help="directory containing the four active raster source PNGs",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_ROOT,
        help="directory for public exports",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace colliding export files (never changes source PNGs)",
    )
    args = parser.parse_args()
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()

    sources = {name: source_dir / f"{name}.png" for name in EXPORTS}
    missing = [str(path) for path in sources.values() if not path.is_file()]
    if missing:
        raise SystemExit("Missing source image(s):\n" + "\n".join(missing))

    destinations = {
        name: output_dir / spec["output"] for name, spec in EXPORTS.items()
    }
    collisions = [str(path) for path in destinations.values() if path.exists()]
    if collisions and not args.force:
        raise SystemExit(
            "Export file(s) already exist; inspect them or pass --force to replace:\n"
            + "\n".join(collisions)
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    temporary_paths = []
    try:
        for name, spec in EXPORTS.items():
            source = sources[name]
            destination = destinations[name]
            suffix = destination.suffix
            with tempfile.NamedTemporaryFile(
                prefix=f".{destination.stem}-",
                suffix=suffix,
                dir=output_dir,
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
            temporary_paths.append(temporary_path)
            result = export_image(source, temporary_path, spec["kind"], spec["limit"])
            result["output"] = destination.name
            result["assetId"] = (
                f"artifact-{name.removeprefix('artifact-')}"
                if spec["kind"] == "artifact"
                else name
            )
            result["limit"] = spec["limit"]
            os.replace(temporary_path, destination)
            temporary_paths.remove(temporary_path)
            result["outputBytes"] = destination.stat().st_size
            results.append(result)
    finally:
        for temporary_path in temporary_paths:
            temporary_path.unlink(missing_ok=True)

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
