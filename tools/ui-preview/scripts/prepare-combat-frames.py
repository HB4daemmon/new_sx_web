#!/usr/bin/env python3
"""Export connected, complete imagegen cels without cutting weapons at grid edges."""

import hashlib
import json
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output/imagegen/combat-frames"
OUTPUT = ROOT / "public/assets"
SIZE = (400, 448)
ANCHOR = (160, 420)
IDS = ["RKF01", "RKF02", "RKF03", "RKF04", "RKF05", "EN-A1-L1"]
# Reviewed tips below the boots must not become the character's floor.
FLOORS = {"RKF05": {11: 1510}, "RKF03": {8: 1118, 11: 1510}}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract(path):
    image = Image.open(path).convert("RGBA")
    if image.getchannel("A").getextrema()[0] != 0:
        raise ValueError(f"{path}: native transparency required")
    width, height = image.size
    alpha = image.getchannel("A").point(lambda value: 255 if value >= 200 else 0)
    image.putalpha(alpha)
    remaining = bytearray(alpha.tobytes())
    components = []
    for index in range(len(remaining)):
        if not remaining[index]:
            continue
        remaining[index] = 0
        queue = deque([index])
        points = []
        left = right = index % width
        top = bottom = index // width
        while queue:
            current = queue.popleft()
            points.append(current)
            x, y = current % width, current // width
            left, right = min(left, x), max(right, x)
            top, bottom = min(top, y), max(bottom, y)
            for neighbor in (
                current - 1 if x else -1,
                current + 1 if x + 1 < width else -1,
                current - width if y else -1,
                current + width if y + 1 < height else -1,
            ):
                if neighbor >= 0 and remaining[neighbor]:
                    remaining[neighbor] = 0
                    queue.append(neighbor)
        if len(points) >= 5000:
            components.append((points, (left, top, right + 1, bottom + 1)))
    if len(components) != 12:
        raise ValueError(f"{path}: expected 12 complete cels, found {len(components)}")
    slots = {}
    for points, box in components:
        left, top, right, bottom = box
        column = min(2, int((left + right) / 2 / width * 3))
        row = min(3, int((top + bottom) / 2 / height * 4))
        slot = row * 3 + column
        if slot in slots:
            raise ValueError(f"{path}: ambiguous cel at {slot}")
        mask = bytearray((right - left) * (bottom - top))
        for point in points:
            x, y = point % width, point // width
            mask[(y - top) * (right - left) + x - left] = 255
        crop = image.crop(box)
        crop.putalpha(Image.frombytes("L", crop.size, bytes(mask)))
        # Bottommost painted boot pixels locate the stance, not the moving sword.
        floor = FLOORS.get(path.stem.upper(), {}).get(slot, bottom - 1)
        feet = [point % width for point in points if floor - 30 <= point // width <= floor]
        center = (min(feet) + max(feet)) / 2
        slots[slot] = {"image": crop, "bounds": box, "floor": floor, "center": center}
    return [slots[index] for index in range(12)]


def main():
    characters = {}
    for content_id in IDS:
        filename = "en-a1-l1-spaced" if content_id == "EN-A1-L1" else content_id.lower()
        source = SOURCE / f"{filename}.png"
        cels = extract(source)
        # One scale for the entire character, including its longest weapon stroke.
        left_extent = max(cel["center"] - cel["bounds"][0] for cel in cels)
        right_extent = max(cel["bounds"][2] - cel["center"] for cel in cels)
        rise = max(cel["floor"] - cel["bounds"][1] for cel in cels)
        scale = min(152 / left_extent, 232 / right_extent, 400 / rise, 1.3)
        atlas = Image.new("RGBA", (SIZE[0] * 3, SIZE[1] * 4))
        frames, metrics = [], []
        for index, cel in enumerate(cels):
            crop = cel["image"]
            resized = crop.resize((round(crop.width * scale), round(crop.height * scale)),
                                  Image.Resampling.LANCZOS)
            left, top, _, _ = cel["bounds"]
            x = round(ANCHOR[0] - (cel["center"] - left) * scale)
            y = round(ANCHOR[1] - (cel["floor"] - top) * scale)
            if x < 4 or x + resized.width > SIZE[0] - 4 or y < 4 or y + resized.height > SIZE[1] - 4:
                raise ValueError(f"{content_id}/{index}: cel exceeds its fixed frame")
            column, row = index % 3, index // 3
            atlas.alpha_composite(resized, (column * SIZE[0] + x, row * SIZE[1] + y))
            frames.append([column * SIZE[0], row * SIZE[1], *SIZE])
            metrics.append({"sourceBounds": list(cel["bounds"]),
                            "sourceAnchor": [cel["center"], cel["floor"]],
                            "bounds": [x, y, x + resized.width, y + resized.height]})
        target = OUTPUT / f"frames-{content_id.lower()}.png"
        atlas.save(target, "PNG", optimize=True)
        characters[content_id] = {
            "src": f"/assets/{target.name}", "frames": frames, "anchor": list(ANCHOR),
            "scale": scale, "dimensions": list(atlas.size), "sha256": digest(target),
            "source": {"path": str(source.relative_to(ROOT)), "sha256": digest(source),
                       "dimensions": list(Image.open(source).size)},
            "cels": metrics,
        }
        print(f"{content_id}: 12 complete cels, fixed scale {scale:.4f}, {target.stat().st_size} bytes")
    manifest = {
        "schemaVersion": 1, "frameSize": list(SIZE), "characters": characters,
        "approval": "pending",
        "provenance": {
            "model": "gpt-image-2.5", "mode": "reference-edit",
            "prompt": "prompts/combat-flipbook.txt",
            "subjects": "prompts/combat-frame-subjects.json",
            "refinement": "prompts/combat-stone-spacing.txt",
            "exporter": "scripts/prepare-combat-frames.py",
            "alphaThreshold": 200,
            "animation": "12 independently drawn full-body key poses, not baked skeletons",
        },
    }
    (OUTPUT / "frames.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
