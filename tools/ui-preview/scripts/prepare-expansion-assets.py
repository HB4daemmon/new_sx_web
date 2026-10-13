#!/usr/bin/env python3
"""Slice the inspected imagegen paper dolls and small illustrations."""

import hashlib
import json
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output/imagegen-cartoon-expansion"
OUTPUT = ROOT / "public/assets"
PARTS = ["head", "torso", "upper", "forearm", "skirt", "weapon", "legL", "legR", "ribbon"]
RIGS = [
    ("RKF01", "金刚功", "rig-vajra"),
    ("RKF02", "归元诀", "rig-origin"),
    ("RKF03", "回春功", "rig-healer"),
    ("RKF04", "御火诀", "rig-fire"),
    ("RKF05", "养剑诀", "rig-sword"),
    ("EN-A1-L1", "养锋石卫", "rig-stone"),
]
SHARED = ["stone", "jade", "talisman", "bead", "ring", "bottle", "pouch", "coin", "needle"]
SPECIAL = ["rl01", "rl02", "rl03", "rl04", "rl05", "drum", "mirror", "lamp", "armor"]
MAP = ["coast", "stairs", "forest", "gate", "rest", "shop"]
GROUPS = {
    "stone": ["RC01", "RC24"],
    "jade": ["RC02", "RC05", "RC06", "RC09", "RC21", "RR05", "RR07", "RR08", "RR12"],
    "armor": ["RC03"],
    "ring": ["RC04", "RC13", "RC23"],
    "bead": ["RC07", "RC15", "RC19", "RR01"],
    "boots": ["RC08"],
    "talisman": ["RC10", "RC11", "RC20", "RC22"],
    "bottle": ["RC12", "RC14"],
    "pouch": ["RC16", "RC17"],
    "coin": ["RC18", "RR04"],
    "needle": ["RR03", "RR10", "RR13"],
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cells(filename, columns, rows):
    with Image.open(SOURCE / filename) as original:
        image = original.convert("RGBA")
        if image.getchannel("A").getextrema()[0] != 0:
            raise ValueError(f"{filename}: native alpha missing")
        # Keep painted shapes, discard stray translucent haze between parts.
        image.putalpha(image.getchannel("A").point(lambda a: 255 if a >= 200 else 0))
        for row in range(rows):
            for column in range(columns):
                crop = image.crop((
                    round(column * image.width / columns), round(row * image.height / rows),
                    round((column + 1) * image.width / columns),
                    round((row + 1) * image.height / rows),
                ))
                bbox = crop.getchannel("A").getbbox()
                if not bbox:
                    raise ValueError(f"{filename}: empty cell {column}, {row}")
                yield crop.crop(bbox)


def rig_parts(filename):
    with Image.open(SOURCE / filename) as original:
        image = original.convert("RGBA")
        width, height = image.size
        alpha = image.getchannel("A").point(lambda a: 255 if a >= 200 else 0)
        image.putalpha(alpha)
        pixels = bytearray(alpha.tobytes())
        components = []
        # Generated sheets are not exact grids. Extract connected silhouettes before
        # assigning their centers to slots, instead of cutting through heads or ribbons.
        for index in range(len(pixels)):
            if not pixels[index]:
                continue
            pixels[index] = 0
            queue = deque([index])
            left = right = index % width
            top = bottom = index // width
            count = 0
            while queue:
                current = queue.popleft()
                x, y = current % width, current // width
                left, right = min(left, x), max(right, x)
                top, bottom = min(top, y), max(bottom, y)
                count += 1
                for neighbor in (
                    current - 1 if x else -1,
                    current + 1 if x + 1 < width else -1,
                    current - width if y else -1,
                    current + width if y + 1 < height else -1,
                ):
                    if neighbor >= 0 and pixels[neighbor]:
                        pixels[neighbor] = 0
                        queue.append(neighbor)
            if count >= 1000:
                components.append((count, (left, top, right + 1, bottom + 1)))
        largest = sorted(components, reverse=True)[:9]
        if len(largest) != 9:
            raise ValueError(f"{filename}: requires nine separate substantial parts")
        slots = {}
        for count, box in largest:
            column = min(2, int((box[0] + box[2]) / 2 / width * 3))
            row = min(2, int((box[1] + box[3]) / 2 / height * 3))
            slot = row * 3 + column
            if slot in slots:
                raise ValueError(f"{filename}: ambiguous part assignment at {slot}")
            crop = image.crop(box)
            slots[slot] = crop
        return [slots[index] for index in range(9)]


assets = []


def save(image, name, source, kind):
    target = OUTPUT / f"{name}.png"
    image.save(target, "PNG", optimize=True)
    assets.append({
        "id": name, "src": f"/assets/{name}.png", "kind": kind,
        "dimensions": list(image.size), "sha256": digest(target),
        "source": {"path": f"output/imagegen-cartoon-expansion/{source}.png",
                   "sha256": digest(SOURCE / f"{source}.png"), "origin": "imagegen"},
    })
    return f"/assets/{name}.png"


def fit(image, width, height, padding=12):
    image = image.copy()
    image.thumbnail((width - padding * 2, height - padding * 2), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (width, height))
    canvas.alpha_composite(image, ((width - image.width) // 2, (height - image.height) // 2))
    return canvas


def main():
    rigs = {}
    for content_id, name, source in RIGS:
        atlas = Image.new("RGBA", (768, 768))
        parts = {}
        crops = rig_parts(f"{source}.png")
        for index, (part, crop) in enumerate(zip(PARTS, crops)):
            if part == "torso":
                # Waist/skirt is a separate bone, so remove the duplicated lower robe.
                crop = crop.crop((0, 0, crop.width, round(crop.height * 0.76)))
            slot = fit(crop, 256, 256, 16)
            x, y = index % 3 * 256, index // 3 * 256
            atlas.alpha_composite(slot, (x, y))
            box = slot.getchannel("A").getbbox()
            parts[part] = [x + box[0], y + box[1], box[2] - box[0], box[3] - box[1]]
        src = save(atlas, f"rig-{content_id.lower()}", source, "rig")
        rigs[content_id] = {
            "name": name, "src": src, "parts": parts,
            "weaponGrip": {
                "RKF01": 0.73, "RKF02": 0.75, "RKF03": 0.84,
                "RKF04": 0.82, "RKF05": 0.77, "EN-A1-L1": 0.90,
            }[content_id],
        }
        if content_id == "RKF05":
            leg = crops[7]
            boot = leg.crop((0, round(leg.height * 0.56), leg.width, leg.height))
            save(fit(boot, 192, 192), "icon-boots", source, "icon")

    icons = {}
    for source, names, columns, rows in [
        ("map-nodes", MAP, 3, 2),
        ("artifact-common", SHARED, 3, 3),
        ("artifact-special", SPECIAL, 3, 3),
    ]:
        for name, crop in zip(names, cells(f"{source}.png", columns, rows)):
            prefix = "map" if source == "map-nodes" else "icon"
            icons[f"{prefix}-{name}"] = save(fit(crop, 192, 192), f"{prefix}-{name}", source, "icon")
    icons["icon-boots"] = "/assets/icon-boots.png"
    artifact_map = {
        content_id: {"src": f"/assets/icon-{group}.png", "type": "shared", "group": group}
        for group, content_ids in GROUPS.items() for content_id in content_ids
    }
    for content_id, src in {
        "RR02": "artifact-rr11", "RR06": "icon-lamp", "RR09": "icon-drum",
        "RR11": "artifact-rr11", "RR14": "icon-mirror", "RR15": "artifact-rr15",
        **{f"RL0{index}": f"icon-rl0{index}" for index in range(1, 6)},
    }.items():
        artifact_map[content_id] = {
            "src": f"/assets/{src}.png",
            "type": "shared" if content_id in ["RR02", "RR11"] else "special",
        }
    library = {
        "schemaVersion": 1,
        "styleApproval": {"status": "approved", "by": "user", "date": "2026-10-13"},
        "expansionApproval": {"status": "pending"},
        "provenance": {"model": "gpt-image-2.5", "prompts": "prompts/cartoon-expansion.jsonl",
                       "processing": "native alpha threshold 200; connected-component rig extraction; icon cell crop; lanczos",
                       "animation": "DragonBones 5.5 authored armatures and keyframes; PixiJS WebGL; per-character landmarks"},
        "rigs": rigs, "map": {name: icons[f"map-{name}"] for name in MAP},
        "artifacts": artifact_map, "assets": assets,
    }
    (OUTPUT / "library.json").write_text(json.dumps(library, ensure_ascii=False, indent=2) + "\n")
    print(f"Exported {len(assets)} assets, {len(rigs)} rigs, {len(artifact_map)} artifact mappings")


if __name__ == "__main__":
    main()
