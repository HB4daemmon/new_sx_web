#!/usr/bin/env python3
"""Export manually reviewed imagegen rig regions into layered-v2 atlases."""

import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path, PurePosixPath

from PIL import Image, UnidentifiedImageError


ROOT = Path(__file__).resolve().parents[1]
MODEL = "gpt-image-2.5"
RIGS = {
    "RKF05": {
        "asset": "rig-rkf05",
        "source": "rig-sword-refined.png",
        "prompt": "prompts/rig-sword-v2-refinement.txt",
    },
    "EN-A1-L1": {
        "asset": "rig-en-a1-l1",
        "source": "rig-stone-refined.png",
        "prompt": "prompts/rig-stone-v2-refinement.txt",
    },
}
PARTS = (
    "head",
    "torso",
    "backUpper",
    "backForearm",
    "frontUpper",
    "frontForearm",
    "handGrip",
    "skirt",
    "legL",
    "legR",
    "weapon",
    "ribbon",
)
ATLAS_SIZE = (1024, 768)
CELL_SIZE = 256
CELL_PADDING = 16
MAX_ISOLATED_ALPHA = 8


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError(f"non-finite JSON value is not allowed: {value}")


def load_json(path, label):
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read {label} {path}: {error}") from error


def require_object(value, label, expected_keys=None):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    if expected_keys is not None and set(value) != set(expected_keys):
        missing = sorted(set(expected_keys) - set(value))
        extra = sorted(set(value) - set(expected_keys))
        details = []
        if missing:
            details.append(f"missing {', '.join(missing)}")
        if extra:
            details.append(f"unexpected {', '.join(extra)}")
        raise ValueError(f"{label} has invalid fields ({'; '.join(details)})")
    return value


def safe_relative_reference(value, label):
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty relative path")
    if "\x00" in value or "\\" in value or re.match(r"^[A-Za-z]:", value):
        raise ValueError(f"{label} contains an unsafe path: {value!r}")
    pieces = value.split("/")
    if value.startswith("/") or any(piece in ("", ".", "..") for piece in pieces):
        raise ValueError(f"{label} contains an unsafe path: {value!r}")
    path = PurePosixPath(value)
    if path.as_posix() != value:
        raise ValueError(f"{label} is not a normalized path: {value!r}")
    return path


def resolve_prompt(prompt_reference):
    relative = safe_relative_reference(prompt_reference, "prompt")
    path = ROOT.joinpath(*relative.parts)
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(ROOT.resolve())
    except (OSError, ValueError) as error:
        raise ValueError(f"prompt path escapes the project or is missing: {prompt_reference}") from error
    if not resolved.is_file() or resolved.suffix.lower() != ".txt":
        raise ValueError(f"prompt must reference an existing .txt file: {prompt_reference}")
    try:
        text = resolved.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as error:
        raise ValueError(f"cannot read prompt {prompt_reference}: {error}") from error
    if not text:
        raise ValueError(f"prompt is empty: {prompt_reference}")
    return resolved


def validate_spec(path):
    spec = require_object(load_json(path, "spec"), "spec", ("model", "rigs"))
    if spec["model"] != MODEL:
        raise ValueError(f"spec model must be exactly {MODEL}")
    rig_specs = require_object(spec["rigs"], "spec.rigs", RIGS)

    validated = {}
    for rig_id, expected in RIGS.items():
        entry = require_object(
            rig_specs[rig_id],
            f"spec.rigs.{rig_id}",
            ("source", "prompt", "regions"),
        )
        if entry["source"] != expected["source"]:
            raise ValueError(
                f"{rig_id} source must be exactly {expected['source']}"
            )
        if entry["prompt"] != expected["prompt"]:
            raise ValueError(
                f"{rig_id} prompt must be exactly {expected['prompt']}"
            )
        safe_relative_reference(entry["source"], f"{rig_id} source")
        resolve_prompt(entry["prompt"])
        regions = require_object(
            entry["regions"], f"spec.rigs.{rig_id}.regions", PARTS
        )
        validated[rig_id] = {"source": entry["source"], "prompt": entry["prompt"],
                             "regions": regions}
    return validated


def resolve_cli_path(value):
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


def source_provenance_path(source_dir_argument, source_path):
    source_dir = Path(source_dir_argument).expanduser()
    if not source_dir.is_absolute():
        source_dir = ROOT / source_dir
    resolved_source = source_path.resolve()
    try:
        return resolved_source.relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        # Absolute external source directories are useful for isolated test fixtures.
        return (Path(source_dir.name) / source_path.name).as_posix()


def validate_region(box, label, image_size):
    if not isinstance(box, list) or len(box) != 4:
        raise ValueError(f"{label} must be [x, y, width, height]")
    if any(type(value) is not int for value in box):
        raise ValueError(f"{label} coordinates must be integers")
    x, y, width, height = box
    image_width, image_height = image_size
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise ValueError(f"{label} must have non-negative origin and positive size")
    if x + width > image_width or y + height > image_height:
        raise ValueError(
            f"{label} is outside source bounds {image_width}x{image_height}: {box}"
        )
    return (x, y, x + width, y + height)


def remove_isolated_haze(alpha):
    """Drop only disconnected alpha components too faint to be intentional ink."""
    values = bytearray(alpha.tobytes())
    visited = bytearray(len(values))
    width, height = alpha.size

    for start, value in enumerate(values):
        if value == 0 or visited[start]:
            continue
        queue = [start]
        visited[start] = 1
        component = [start]
        maximum = value
        cursor = 0
        while cursor < len(queue):
            current = queue[cursor]
            cursor += 1
            x, y = current % width, current // width
            for row in range(max(0, y - 1), min(height, y + 2)):
                row_start = row * width
                for column in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row_start + column
                    neighbor_alpha = values[neighbor]
                    if neighbor_alpha and not visited[neighbor]:
                        visited[neighbor] = 1
                        queue.append(neighbor)
                        component.append(neighbor)
                        maximum = max(maximum, neighbor_alpha)
        if maximum <= MAX_ISOLATED_ALPHA:
            for index in component:
                values[index] = 0

    return Image.frombytes("L", alpha.size, bytes(values))


def crop_region(source, box, label):
    crop = source.crop(box).convert("RGBA")
    # Generated soft halos are not cloth. Resampling restores a smooth ink edge.
    alpha = crop.getchannel("A").point(lambda value: value if value >= 200 else 0)
    alpha = remove_isolated_haze(alpha)
    crop.putalpha(alpha)
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError(f"{label} is empty after removing isolated low-alpha haze")
    return crop.crop(bounds)


def fit_cell(crop):
    available = CELL_SIZE - CELL_PADDING * 2
    scale = min(available / crop.width, available / crop.height)
    width = max(1, min(available, round(crop.width * scale)))
    height = max(1, min(available, round(crop.height * scale)))
    premultiplied = crop.convert("RGBa").resize(
        (width, height), Image.Resampling.LANCZOS
    )
    return premultiplied.convert("RGBA")


def export_atlas(source_path, rig_id, rig_spec):
    try:
        with Image.open(source_path) as original:
            original.load()
            if "A" not in original.getbands():
                raise ValueError(f"{rig_id} source has no native alpha channel")
            source_size = original.size
            rgba = original.convert("RGBA")
    except (OSError, UnidentifiedImageError) as error:
        raise ValueError(f"cannot decode {rig_id} source {source_path}: {error}") from error

    original_alpha = rgba.getchannel("A")
    alpha_extrema = original_alpha.getextrema()
    if alpha_extrema[0] != 0 or alpha_extrema[1] == 0:
        raise ValueError(f"{rig_id} source requires native transparent and visible pixels")

    atlas = Image.new("RGBA", ATLAS_SIZE, (0, 0, 0, 0))
    source_regions = {}
    parts = {}
    for index, part in enumerate(PARTS):
        box = validate_region(
            rig_spec["regions"][part], f"{rig_id}.{part}", source_size
        )
        source_regions[part] = list(rig_spec["regions"][part])
        crop = crop_region(rgba, box, f"{rig_id}.{part}")
        fitted = fit_cell(crop)
        cell_x = index % 4 * CELL_SIZE
        cell_y = index // 4 * CELL_SIZE
        offset = (
            cell_x + (CELL_SIZE - fitted.width) // 2,
            cell_y + (CELL_SIZE - fitted.height) // 2,
        )
        atlas.alpha_composite(fitted, offset)
        alpha_bounds = fitted.getchannel("A").getbbox()
        if alpha_bounds is None:
            raise ValueError(f"{rig_id}.{part} became empty while fitting atlas")
        left, top, right, bottom = alpha_bounds
        parts[part] = [
            offset[0] + left,
            offset[1] + top,
            right - left,
            bottom - top,
        ]

    return atlas, parts, source_regions, source_size


def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()


def image_bytes(image):
    from io import BytesIO

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def update_library(library_path, outputs, source_dir_argument):
    library = load_json(library_path, "library")
    if not isinstance(library, dict) or type(library.get("schemaVersion")) is not int:
        raise ValueError("library must be an object with schemaVersion 1")
    if library["schemaVersion"] != 1:
        raise ValueError("library schemaVersion must be 1")
    rigs = library.get("rigs")
    assets = library.get("assets")
    if not isinstance(rigs, dict) or not isinstance(assets, list):
        raise ValueError("library must contain rigs object and assets array")

    assets_by_id = {}
    for asset in assets:
        if isinstance(asset, dict) and asset.get("id") in {
            value["asset"] for value in RIGS.values()
        }:
            assets_by_id.setdefault(asset["id"], []).append(asset)

    for rig_id, expected in RIGS.items():
        if rig_id not in rigs or not isinstance(rigs[rig_id], dict):
            raise ValueError(f"library is missing rig {rig_id}")
        asset_id = expected["asset"]
        rig = rigs[rig_id]
        asset_matches = assets_by_id.get(asset_id, [])
        if len(asset_matches) != 1:
            raise ValueError(f"library must have exactly one asset entry for {asset_id}")
        asset = asset_matches[0]
        src = f"/assets/{asset_id}.png"
        if rig.get("src") != src or asset.get("src") != src or asset.get("kind") != "rig":
            raise ValueError(f"library {rig_id} paths do not match {src}")
        image_data = outputs[rig_id]["bytes"]
        rig.update(
            layout="layered-v2",
            dimensions=list(ATLAS_SIZE),
            parts=outputs[rig_id]["parts"],
            sourceRegions=outputs[rig_id]["sourceRegions"],
        )
        asset.update(
            dimensions=list(ATLAS_SIZE),
            sha256=digest_bytes(image_data),
            source={
                "path": source_provenance_path(
                    source_dir_argument, outputs[rig_id]["source_path"]
                ),
                "sha256": outputs[rig_id]["source_sha256"],
                "origin": "imagegen",
                "model": MODEL,
                "prompt": outputs[rig_id]["prompt"],
            },
        )
    return (json.dumps(library, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _write_temp(parent, prefix, data, mode):
    descriptor, filename = tempfile.mkstemp(prefix=prefix, suffix=".tmp", dir=parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(filename, mode)
        return Path(filename)
    except BaseException:
        Path(filename).unlink(missing_ok=True)
        raise


def write_transaction(files):
    destinations = [path.resolve() for path in files]
    if len(destinations) != len(set(destinations)):
        raise ValueError("output paths must be distinct")

    staged = {}
    backups = {}
    committed = []
    retained_backups = set()
    try:
        for destination, data in zip(destinations, files.values()):
            destination.parent.mkdir(parents=True, exist_ok=True)
            mode = destination.stat().st_mode & 0o777 if destination.exists() else 0o644
            staged[destination] = _write_temp(
                destination.parent, f".{destination.name}.", data, mode
            )
        for destination in destinations:
            if destination.exists():
                mode = destination.stat().st_mode & 0o777
                backups[destination] = _write_temp(
                    destination.parent,
                    f".{destination.name}.backup.",
                    destination.read_bytes(),
                    mode,
                )
        for destination in destinations:
            os.replace(staged[destination], destination)
            committed.append(destination)
    except BaseException as error:
        rollback_errors = []
        for destination in reversed(committed):
            backup = backups.get(destination)
            if backup is not None:
                try:
                    os.replace(backup, destination)
                    backups.pop(destination, None)
                except OSError as rollback_error:
                    retained_backups.add(backup)
                    rollback_errors.append(
                        f"{destination}: {rollback_error} (backup retained at {backup})"
                    )
            else:
                try:
                    destination.unlink(missing_ok=True)
                except OSError as rollback_error:
                    rollback_errors.append(f"{destination}: {rollback_error}")
        if rollback_errors:
            raise RuntimeError(
                f"output commit failed ({error}); rollback incomplete: "
                + "; ".join(rollback_errors)
            ) from error
        raise
    finally:
        for temporary in (*staged.values(), *backups.values()):
            if temporary not in retained_backups:
                temporary.unlink(missing_ok=True)


def build_outputs(spec, source_dir, source_dir_argument):
    source_root = source_dir.resolve(strict=True)
    if not source_root.is_dir():
        raise ValueError(f"source-dir is not a directory: {source_dir}")
    outputs = {}
    for rig_id, rig_spec in spec.items():
        source_path = source_root / rig_spec["source"]
        try:
            resolved_source = source_path.resolve(strict=True)
            resolved_source.relative_to(source_root)
        except (OSError, ValueError) as error:
            raise ValueError(
                f"{rig_id} source is missing or escapes source-dir: {rig_spec['source']}"
            ) from error
        if not resolved_source.is_file():
            raise ValueError(f"{rig_id} source is not a file: {source_path}")
        prompt_path = resolve_prompt(rig_spec["prompt"])
        atlas, parts, source_regions, source_size = export_atlas(
            resolved_source, rig_id, rig_spec
        )
        outputs[rig_id] = {
            "bytes": image_bytes(atlas),
            "parts": parts,
            "sourceRegions": source_regions,
            "source_path": resolved_source,
            "source_sha256": hashlib.sha256(resolved_source.read_bytes()).hexdigest(),
            "source_size": list(source_size),
            "prompt": rig_spec["prompt"],
            "prompt_path": prompt_path,
        }
    return outputs


def run(args):
    spec_path = resolve_cli_path(args.spec)
    source_dir = resolve_cli_path(args.source_dir)
    output_dir = resolve_cli_path(args.output_dir)
    library_path = resolve_cli_path(args.library)

    spec = validate_spec(spec_path)
    outputs = build_outputs(spec, source_dir, args.source_dir)
    library_data = update_library(library_path, outputs, args.source_dir)
    files = {}
    for rig_id, expected in RIGS.items():
        files[output_dir / f"{expected['asset']}.png"] = outputs[rig_id]["bytes"]
    files[library_path] = library_data
    write_transaction(files)
    print("Exported RKF05 and EN-A1-L1 layered-v2 atlases (1024x768)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True, help="strict rig crop specification JSON")
    parser.add_argument("--source-dir", required=True, help="directory containing RGBA source sheets")
    parser.add_argument("--output-dir", required=True, help="directory for authorized rig PNG replacements")
    parser.add_argument("--library", required=True, help="existing public assets library JSON")
    args = parser.parse_args()
    try:
        run(args)
    except (OSError, ValueError, UnidentifiedImageError) as error:
        parser.exit(2, f"error: {error}\n")


if __name__ == "__main__":
    main()
