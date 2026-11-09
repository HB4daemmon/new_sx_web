"""Builds prompt files for alternative V3 art sets from prompts.jsonl.
Every image keeps its subject (which creature / cultivator / landscape) and accent colour;
only the style changes. Characters stay on pure black so process.py can key them out.

Usage: python3 tools/v3-art/styles.py <out_dir> [ids...]
Writes <out_dir>/prompts-<style>.jsonl for every style below (all 33 ids, or only the given ones).
"""
import json, os, re, sys

HERE = os.path.dirname(__file__)

STYLES = {
    'ink': {
        'name': '水墨写意',
        'figure': 'Expressive Chinese xieyi ink-wash painting, bold wet brushstrokes with ink bleeds, dry-brush texture and splashes, painted in pale rice-paper-white and silver-grey ink tones with a single {accent} wash accent, loose yet confident, strong readable silhouette',
        'bg': 'Chinese xieyi ink-wash landscape at night, wide cinematic composition, wet ink bleeds and mist, very dark and low contrast with a mostly empty dark center for game UI, {scene}, a faint {accent} wash glow, rice-paper texture, no people, no creatures, no text, no border',
    },
    'gongbi': {
        'name': '工笔重彩',
        'figure': 'Chinese gongbi fine-line painting with heavy mineral pigments, delicate even ink outlines, azurite blue, malachite green, cinnabar red and gold-leaf details, ornate patterned robes and scales, {accent} highlights, rich but clean, strong readable silhouette',
        'bg': 'Chinese blue-green gongbi landscape painting at dusk, wide cinematic composition, azurite and malachite mountains with gold-leaf outlines, darkened and low contrast with a mostly empty dark center for game UI, {scene}, {accent} highlights, silk texture, no people, no creatures, no text, no border',
    },
    'dunhuang': {
        'name': '敦煌壁画',
        'figure': 'Dunhuang cave mural painting style, flowing celestial ribbons, earthy ochre, lapis-lazuli blue and malachite green, faded vermilion, weathered plaster texture with fine cracks, {accent} accents, graceful mural linework, strong readable silhouette',
        'bg': 'Dunhuang cave mural landscape, wide cinematic composition, faded mineral colours on weathered plaster, darkened and low contrast with a mostly empty dark center for game UI, {scene}, {accent} accents, no people, no creatures, no text, no border',
    },
    'guochao': {
        'name': '国潮插画',
        'figure': 'Modern Chinese guochao illustration, bold flat vector shapes, crisp clean linework, vibrant saturated colours with auspicious cloud and wave patterns, {accent} as the key colour, poster-like and punchy, strong readable silhouette',
        'bg': 'Modern Chinese guochao landscape illustration at night, wide cinematic composition, flat layered shapes with auspicious cloud patterns, dark and low contrast with a mostly empty dark center for game UI, {scene}, {accent} highlights, no people, no creatures, no text, no border',
    },
}

FIGURE_TAIL = '{subject}, centered with generous empty margin, {pose}, isolated on a pure solid black background (#000000), no ground, no text, no seal, no border, no frame, {role}'


def parse(row):
    """Pull subject, accent and pose out of an original prompt."""
    p = row['prompt']
    acc = re.search(r'(?:plus|of) ([^,]+?) accents', p)
    accent = acc.group(1).strip() if acc else 'vermilion'
    if row['id'].startswith('bg-'):
        scene = re.search(r'silhouettes of (.+?), accent glow', p)
        return {'kind': 'bg', 'scene': scene.group(1) if scene else 'misty mountains', 'accent': accent}
    if row['id'].startswith('hero-'):
        subject = re.search(r'accents, (single full-body .+?), centered', p).group(1)
        pose = re.search(r'centered, (.+?), isolated', p).group(1)
        return {'kind': 'hero', 'subject': subject, 'pose': pose, 'accent': accent, 'role': 'game hero character art, xianxia cultivator'}
    subject = re.search(r'silhouette, (single full-body .+?), centered', p).group(1)
    pose = re.search(r'margin, (.+?), isolated', p).group(1)
    return {'kind': 'enemy', 'subject': subject, 'pose': pose, 'accent': accent, 'role': 'game enemy art, mythological Shan Hai Jing creature'}


def build(style, row):
    s = STYLES[style]
    info = parse(row)
    if info['kind'] == 'bg':
        prompt = s['bg'].format(scene=info['scene'], accent=info['accent'])
    else:
        prompt = s['figure'].format(accent=info['accent']) + ', ' + FIGURE_TAIL.format(**info)
    return {'id': row['id'], 'size': row['size'], 'prompt': prompt}


if __name__ == '__main__':
    out = sys.argv[1]
    only = set(sys.argv[2:])
    rows = [json.loads(l) for l in open(os.path.join(HERE, 'prompts.jsonl'), encoding='utf-8') if l.strip()]
    os.makedirs(out, exist_ok=True)
    for style in STYLES:
        with open(os.path.join(out, f'prompts-{style}.jsonl'), 'w', encoding='utf-8') as f:
            for row in rows:
                if not only or row['id'] in only:
                    f.write(json.dumps(build(style, row), ensure_ascii=False) + '\n')
    print('styles:', ', '.join(f"{k}({v['name']})" for k, v in STYLES.items()))
