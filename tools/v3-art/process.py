"""Keys the solid black background out of generated V3 art and writes web-ready WebP.
Usage: python3 tools/v3-art/process.py <raw_dir> [set] [model]  (raw PNGs from run.sh)
  set:   alternative art set name (e.g. ink) -> assets/v3/<set>/; omit for the default set.
  model: image model recorded in the manifest (default gpt-image-2.5)."""
import sys, os, json, hashlib
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

raw = sys.argv[1]
art_set = sys.argv[2] if len(sys.argv) > 2 else ''
model = sys.argv[3] if len(sys.argv) > 3 else 'gpt-image-2.5'
out = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'v3', art_set)
prefix = f'assets/v3/{art_set}/' if art_set else 'assets/v3/'
os.makedirs(out, exist_ok=True)
rows = []
for name in sorted(os.listdir(raw)):
    if not name.endswith('.png'):
        continue
    id = name[:-4]
    src = os.path.join(raw, name)
    im = Image.open(src).convert('RGB')
    if id.startswith('bg-'):
        w = 1600
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        dst = os.path.join(out, f'{id}.webp')
        im.save(dst, 'WEBP', quality=74, method=6)
    else:
        a = np.asarray(im).astype(np.int16)
        lum = a.max(axis=2)
        border = np.concatenate([lum[0], lum[-1], lum[:, 0], lum[:, -1]])
        thr = int(np.percentile(border, 90)) + 22
        dark = lum <= thr
        labels, _ = ndimage.label(dark)
        edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
        bg = np.isin(labels, list(edge))
        alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
        rgba = im.copy(); rgba.putalpha(alpha)
        box = rgba.getbbox()
        rgba = rgba.crop(box)
        limit = 720 if id.startswith('hero') else 760
        rgba.thumbnail((limit, limit), Image.LANCZOS)
        dst = os.path.join(out, f'{id}.webp')
        rgba.save(dst, 'WEBP', quality=80, method=6)
    rows.append({'id': id, 'file': f'{prefix}{id}.webp', 'sourceSha256': hashlib.sha256(open(src, 'rb').read()).hexdigest(), 'bytes': os.path.getsize(dst)})
    print(id, os.path.getsize(dst) // 1024, 'KB')
json.dump({'schemaVersion': 1, 'provenance': {'imageModel': model, 'generator': 'imagegen skill CLI (generate --quality high --no-augment)', 'prompts': f'tools/v3-art/styles.py ({art_set})' if art_set else 'tools/v3-art/prompts.jsonl', 'processing': 'black background keyed by border-connected flood fill, cropped, WebP'}, 'assets': rows}, open(os.path.join(out, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
