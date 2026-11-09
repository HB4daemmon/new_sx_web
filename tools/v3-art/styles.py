"""Builds prompt files for alternative V3 art sets from prompts.jsonl.
Every image keeps its subject (which creature / cultivator / landscape) and accent colour;
only the style changes. Characters stay on pure black so process.py can key them out.

Usage: python3 tools/v3-art/styles.py <out_dir> [ids...]
Writes <out_dir>/prompts-<style>.jsonl for every style below (all 33 ids, or only the given ones).
"""
import json, os, re, sys

HERE = os.path.dirname(__file__)

# Readable over ornate: big shapes, few colours, little texture, strong silhouette —
# the qualities card-battler and roguelike art tends to share. No style names a specific game.
CLEAN = 'simple clean shapes, minimal detail, no intricate ornament, no busy patterns, no excessive texture, lots of negative space'

STYLES = {
    'cel': {
        'name': '墨线平涂',
        'figure': 'Bold graphic cel-shaded illustration, thick confident black ink outlines, flat colour with two or three tone hard shading, very limited palette of deep charcoal, warm cream and {accent}, comic-book poster look, ' + CLEAN + ', strong readable silhouette',
        'bg': 'Bold graphic cel-shaded landscape at night, flat colour layers with hard edges, very limited dark palette with {accent} accents, dark and low contrast with a mostly empty dark center for game UI, {scene}, ' + CLEAN + ', no people, no creatures, no text, no border',
    },
    'painted': {
        'name': '手绘卡牌',
        'figure': 'Clean painterly digital card illustration, soft visible brushwork, simple chunky forms, muted desaturated palette with a single {accent} accent, gentle rim light, ' + CLEAN + ', strong readable silhouette',
        'bg': 'Clean painterly digital landscape at dusk, soft brushwork, simple large shapes, muted desaturated palette with {accent} accents, dark and low contrast with a mostly empty dark center for game UI, {scene}, ' + CLEAN + ', no people, no creatures, no text, no border',
    },
    'woodcut': {
        'name': '木刻版画',
        'figure': 'High-contrast woodcut linocut print, heavy black ink and bone-white paper, bold carved strokes and sparse hatching, one single {accent} accent colour only, stark and graphic, ' + CLEAN + ', strong readable silhouette',
        'bg': 'High-contrast woodcut linocut landscape print at night, heavy black ink with sparse carved highlights, one single {accent} accent colour, dark with a mostly empty dark center for game UI, {scene}, ' + CLEAN + ', no people, no creatures, no text, no border',
    },
    'pixel': {
        'name': '像素',
        'figure': 'Crisp retro 32-bit pixel art sprite, clean pixel outlines, limited 16-colour palette with {accent} as the key colour, flat pixel shading, no anti-aliasing blur, ' + CLEAN + ', strong readable silhouette',
        'bg': 'Crisp retro pixel art landscape at night, limited 16-colour palette, layered parallax shapes with {accent} accents, dark and low contrast with a mostly empty dark center for game UI, {scene}, ' + CLEAN + ', no people, no creatures, no text, no border',
    },
}

FIGURE_TAIL = '{subject}, centered with generous empty margin, {pose}, isolated on a pure solid black background (#000000), no glow, no halo, no bloom around the figure, no ground, no text, no seal, no border, no frame, {role}'


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


# Pixel sprites kept glowing halos (which survive the black key); spell it out harder there.
PIXEL_NO_GLOW = ('no glow, no halo, no bloom around the figure',
                 'hard-edged sprite with absolutely no glow, no aura, no light bloom and no soft gradient around it; the background stays '
                 'pure flat black #000000 right up to the sprite outline; fire and lightning drawn as solid pixel shapes')
# A few subjects read as a blob of fire in some styles: describe the body instead.
SUBJECT_OVERRIDE = {
    ('pixel', 'a1-chi'): 'single full-body hornless red dragon-lizard 火螭 with a short spiky flame mane along its back only, its scaly body clearly visible',
}


def build(style, row):
    s = STYLES[style]
    info = parse(row)
    if info['kind'] == 'bg':
        prompt = s['bg'].format(scene=info['scene'], accent=info['accent'])
    else:
        info['subject'] = SUBJECT_OVERRIDE.get((style, row['id']), info['subject'])
        prompt = s['figure'].format(accent=info['accent']) + ', ' + FIGURE_TAIL.format(**info)
        if style == 'pixel':
            prompt = prompt.replace(*PIXEL_NO_GLOW)
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
