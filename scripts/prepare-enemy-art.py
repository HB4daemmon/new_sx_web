#!/usr/bin/env python3
"""Build enemy imagegen batches, frame atlases, and a reproducible manifest."""

import argparse
import hashlib
import json
import math
import subprocess
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PROMPT_ROOT = ROOT / "tools/ui-preview/prompts/enemies"
RAW_ROOT = ROOT / "output/imagegen/enemies"
OUTPUT_ROOT = ROOT / "assets/enemies"
OLD_MANIFEST = ROOT / "tools/ui-preview/public/assets/frames.json"
OLD_STONE_ATLAS = ROOT / "tools/ui-preview/public/assets/frames-en-a1-l1.png"
FRAME_SIZE = (400, 448)
ATLAS_SIZE = (FRAME_SIZE[0] * 3, FRAME_SIZE[1] * 4)
FRAME_PADDING = 2
ANCHOR = (160, 420)
TARGET_BODY_HEIGHT = 300
ALPHA_THRESHOLD = 200
REVIEW_DATE = "2026-10-15"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def content_ids():
    result = subprocess.run(
        ["node", "--input-type=module", "-e", """
import { loadContent } from './tools/content-kit/src/loader.mjs';
const content = await loadContent();
if (content.issues.length) throw new Error('Enemy art requires valid content');
process.stdout.write(JSON.stringify(content.byKind.get('enemy').map(row => row.id).sort()));
"""],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    ids = json.loads(result.stdout)
    if len(ids) != 34 or len(ids) != len(set(ids)):
        raise ValueError(f"expected 34 unique enemy content ids, found {len(ids)}")
    if ids.count("EN-A1-L1") != 1:
        raise ValueError("EN-A1-L1 must exist exactly once")
    return ids


def prompt_text(content_id):
    common = (PROMPT_ROOT / "common.txt").read_text().strip()
    specific = (PROMPT_ROOT / f"{content_id.lower()}.txt").read_text().strip()
    return f"{common}\n\n{specific}"


def write_batch(only_ids=None, batch_name="prompts.jsonl"):
    RAW_ROOT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for content_id in content_ids():
        if content_id == "EN-A1-L1":
            continue
        if only_ids and content_id not in only_ids:
            continue
        jobs.append({
            "prompt": prompt_text(content_id),
            "out": f"{content_id.lower()}.png",
        })
    if only_ids and {job["out"].removesuffix(".png").upper() for job in jobs} != only_ids:
        raise ValueError("requested retry id is unknown or does not have a generated atlas")
    if Path(batch_name).name != batch_name or not batch_name.endswith(".jsonl"):
        raise ValueError("batch name must be a local .jsonl filename")
    batch_path = RAW_ROOT / batch_name
    batch_path.write_text("".join(json.dumps(job, ensure_ascii=False) + "\n" for job in jobs))
    print(f"wrote {len(jobs)} distinct prompts to {batch_path.relative_to(ROOT)}")


def components(alpha_bytes, width, height):
    """Return opaque connected regions, retaining any meaningful detached part."""
    remaining = bytearray(value >= ALPHA_THRESHOLD for value in alpha_bytes)
    regions = []
    for start in range(len(remaining)):
        if not remaining[start]:
            continue
        remaining[start] = 0
        queue = deque([start])
        points = []
        left = right = start % width
        top = bottom = start // width
        while queue:
            current = queue.popleft()
            points.append(current)
            x, y = current % width, current // width
            left, right = min(left, x), max(right, x)
            top, bottom = min(top, y), max(bottom, y)
            neighbors = (
                current - 1 if x else -1,
                current + 1 if x + 1 < width else -1,
                current - width if y else -1,
                current + width if y + 1 < height else -1,
            )
            for neighbor in neighbors:
                if neighbor >= 0 and remaining[neighbor]:
                    remaining[neighbor] = 0
                    queue.append(neighbor)
        if len(points) >= 24:
            regions.append((points, (left, top, right + 1, bottom + 1)))
    return regions


def extract_cells(source_path):
    image = Image.open(source_path).convert("RGBA")
    width, height = image.size
    if image.getchannel("A").getextrema()[0] != 0:
        raise ValueError(f"{source_path}: generated image has no transparent pixels")
    regions = [
        region for region in components(
            image.getchannel("A").tobytes(), width, height,
        )
        if len(region[0]) >= 5000
    ]
    if len(regions) != 12:
        raise ValueError(f"{source_path}: expected 12 complete characters, found {len(regions)}")

    slots = {}
    for points, bounds in regions:
        left, top, right, bottom = bounds
        column = min(2, int(((left + right) / 2) / width * 3))
        row = min(3, int(((top + bottom) / 2) / height * 4))
        slot = row * 3 + column
        if slot in slots:
            raise ValueError(f"{source_path}: multiple connected characters in cel {slot}")
        floor = bottom - 1
        floor_points = [
            point % width for point in points
            if floor - 30 <= point // width <= floor
        ]
        if not floor_points:
            raise ValueError(f"{source_path}: no ground contact for cel {slot}")
        center = (min(floor_points) + max(floor_points)) / 2
        mask = bytearray((right - left) * (bottom - top))
        for point in points:
            x, y = point % width, point // width
            mask[(y - top) * (right - left) + x - left] = 255
        crop = image.crop(bounds)
        crop.putalpha(Image.frombytes("L", crop.size, bytes(mask)))
        slots[slot] = {
            "image": crop,
            "bounds": list(bounds),
            "sourceAnchor": [center, floor],
            "width": right - left,
            "height": bottom - top,
            "floor": floor,
        }
    if set(slots) != set(range(12)):
        raise ValueError(f"{source_path}: expected one complete character per grid cell")
    return image.size, [slots[index] for index in range(12)]


def render_character(content_id, source_path, write_atlas=True):
    source_dimensions, cells = extract_cells(source_path)
    cel_hashes = {
        hashlib.sha256(
            f"{cel['image'].width}x{cel['image'].height}".encode() + cel["image"].tobytes()
        ).hexdigest()
        for cel in cells
    }
    if len(cel_hashes) != 12:
        raise ValueError(f"{content_id}: duplicate cel image detected; all 12 poses must be unique")
    for cel in cells:
        cel["effectiveSource"] = max(cel["height"], cel["width"] * 0.85)
    max_metric = max(cel["effectiveSource"] for cel in cells)
    left_extent = max(cel["sourceAnchor"][0] - cel["bounds"][0] for cel in cells)
    right_extent = max(cel["bounds"][2] - cel["sourceAnchor"][0] for cel in cells)
    rise = max(cel["sourceAnchor"][1] - cel["bounds"][1] for cel in cells)
    scale = min(
        min(1.1, TARGET_BODY_HEIGHT / max_metric),
        (ANCHOR[0] - FRAME_PADDING) / max(1, left_extent),
        (FRAME_SIZE[0] - ANCHOR[0] - FRAME_PADDING) / max(1, right_extent),
        (ANCHOR[1] - FRAME_PADDING) / max(1, rise),
    )

    atlas = Image.new("RGBA", ATLAS_SIZE) if write_atlas else None
    frames = []
    metrics = []
    for index, cel in enumerate(cells):
        crop = cel["image"]
        size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
        if write_atlas:
            resized = crop.resize(size, Image.Resampling.LANCZOS)
        source_left, source_top, _, _ = cel["bounds"]
        source_anchor_x, source_floor = cel["sourceAnchor"]
        x = round(ANCHOR[0] - (source_anchor_x - source_left) * scale)
        y = round(ANCHOR[1] - (source_floor - source_top) * scale)
        rendered_width, rendered_height = size
        right, bottom = x + rendered_width, y + rendered_height
        if (x < FRAME_PADDING or y < FRAME_PADDING or
                right > FRAME_SIZE[0] - FRAME_PADDING or bottom > FRAME_SIZE[1] - FRAME_PADDING):
            raise ValueError(f"{content_id}/{index}: cel exceeds the fixed {FRAME_SIZE} frame at scale {scale:.3f}")
        column, row = index % 3, index // 3
        if write_atlas:
            atlas.alpha_composite(resized, (column * FRAME_SIZE[0] + x, row * FRAME_SIZE[1] + y))
        frames.append([column * FRAME_SIZE[0], row * FRAME_SIZE[1], *FRAME_SIZE])
        metrics.append({
            "sourceBounds": cel["bounds"],
            "sourceAnchor": cel["sourceAnchor"],
            "sourceSizeMetric": {
                "width": cel["width"],
                "height": cel["height"],
                "effective": round(cel["effectiveSource"], 3),
            },
            "bounds": [x, y, right, bottom],
            "sizeMetric": {
                "width": rendered_width,
                "height": rendered_height,
                "effective": round(max(rendered_height, rendered_width * 0.85), 3),
            },
        })

    target = OUTPUT_ROOT / f"frames-{content_id.lower()}.png"
    body_height = round(max(metric["sizeMetric"]["effective"] for metric in metrics))
    if not write_atlas:
        return {"scale": scale, "bodyHeight": body_height}, 0

    atlas.save(target, "PNG", optimize=True)
    entry = {
        "src": f"/assets/{target.name}",
        "frames": frames,
        "anchor": list(ANCHOR),
        "scale": scale,
        "bodyHeight": body_height,
        "sizeMetric": {
            "basis": "max(actual height, actual width * 0.85)",
            "bodyHeight": body_height,
            "maximumSourceMetric": round(max_metric, 3),
        },
        "dimensions": list(ATLAS_SIZE),
        "sha256": sha256(target),
        "source": {
            "path": str(source_path.relative_to(ROOT)),
            "sha256": sha256(source_path),
            "dimensions": list(source_dimensions),
        },
        "cels": metrics,
    }
    return entry, target.stat().st_size


def scan_sources():
    failures = []
    checked = 0
    for content_id in content_ids():
        if content_id == "EN-A1-L1":
            continue
        source = RAW_ROOT / f"{content_id.lower()}.png"
        try:
            entry, _ = render_character(content_id, source, write_atlas=False)
        except (FileNotFoundError, ValueError) as error:
            failures.append((content_id, str(error)))
            continue
        checked += 1
        print(
            f"{content_id}: valid, scale {entry['scale']:.4f}, "
            f"bodyHeight {entry['bodyHeight']}px"
        )

    print(f"scanned {checked} valid sources; {len(failures)} need attention")
    for content_id, reason in failures:
        print(f"{content_id}: {reason}")
    return failures


def make_contact_sheet(manifest):
    entries = manifest["characters"]
    columns = 5
    tile_width, tile_height = 178, 273
    margin, label_height = 12, 24
    rows = math.ceil(len(entries) / columns)
    sheet = Image.new(
        "RGBA",
        (columns * tile_width + (columns + 1) * margin,
         rows * (tile_height + label_height) + (rows + 1) * margin),
        (245, 245, 245, 255),
    )
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    for index, (content_id, entry) in enumerate(entries.items()):
        filename = Path(entry["src"]).name
        path = OUTPUT_ROOT / filename
        if not path.is_file() and content_id == "EN-A1-L1":
            path = OLD_STONE_ATLAS
        atlas = Image.open(path).convert("RGBA")
        preview = atlas.resize((tile_width, tile_height), Image.Resampling.LANCZOS)
        x = margin + (index % columns) * tile_width
        y = margin + (index // columns) * (tile_height + label_height)
        sheet.alpha_composite(preview, (x, y))
        draw.text((x, y + tile_height + 3), content_id, fill=(20, 30, 35, 255), font=font)
    target = RAW_ROOT / "contact-sheet.png"
    sheet.convert("RGB").save(target, "PNG", optimize=True)
    return target


def prepare():
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    RAW_ROOT.mkdir(parents=True, exist_ok=True)
    old = json.loads(OLD_MANIFEST.read_text())["characters"]["EN-A1-L1"]
    characters = {}
    byte_total = 0
    for content_id in content_ids():
        if content_id == "EN-A1-L1":
            characters[content_id] = old
            print("EN-A1-L1: reusing the existing reviewed atlas entry")
            continue
        source = RAW_ROOT / f"{content_id.lower()}.png"
        if not source.is_file():
            raise FileNotFoundError(f"missing imagegen result: {source}")
        entry, size = render_character(content_id, source)
        characters[content_id] = entry
        byte_total += size
        print(f"{content_id}: 12 cels, scale {entry['scale']:.4f}, {size} bytes")

    manifest = {
        "schemaVersion": 1,
        "frameSize": list(FRAME_SIZE),
        "targetBodyHeight": TARGET_BODY_HEIGHT,
        "characters": characters,
        "review": {
            "status": "agent-reviewed",
            "reviewedBy": "agent",
            "date": REVIEW_DATE,
        },
        "userApproval": "not-yet-requested",
        "provenance": {
            "model": "gpt-image-2.5",
            "mode": "generation",
            "prompt": "tools/ui-preview/prompts/enemies/common.txt",
            "subjects": "tools/ui-preview/prompts/enemies/en-*.txt",
            "exporter": "scripts/prepare-enemy-art.py",
            "alphaThreshold": ALPHA_THRESHOLD,
            "animation": "12 independently drawn full-body key poses, not baked skeletons",
        },
    }
    manifest_path = OUTPUT_ROOT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    contact = make_contact_sheet(manifest)
    print(f"wrote {manifest_path.relative_to(ROOT)} ({byte_total} new atlas bytes)")
    print(f"contact sheet: {contact.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--write-batch", action="store_true")
    actions.add_argument("--prepare", action="store_true")
    actions.add_argument("--scan", action="store_true")
    parser.add_argument("--only", action="append", help="include only this enemy id; repeat for multiple ids")
    parser.add_argument("--batch-name", default="prompts.jsonl")
    args = parser.parse_args()
    if args.write_batch:
        write_batch(set(args.only or []), args.batch_name)
    elif args.scan:
        if scan_sources():
            raise SystemExit(1)
    else:
        prepare()


if __name__ == "__main__":
    main()
