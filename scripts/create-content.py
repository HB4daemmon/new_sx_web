"""Validate authored JSON and embed display copy; never regenerate gameplay values."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "data/game.json"
content = json.loads(path.read_text(encoding="utf-8"))
content["presentation"] = json.loads((ROOT / "data/presentation.json").read_text(encoding="utf-8"))
ids = [item["id"] for kind in ("abilities", "enemies", "events", "schools", "hybrids") for item in content[kind]]
assert len(ids) == len(set(ids)), "Duplicate content ID"
path.write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Content {content['version']}: {len(content['abilities'])} abilities, {len(content['enemies'])} enemies, {len(content['events'])} events")
