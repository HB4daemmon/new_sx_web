#!/bin/bash
# Subsets LXGW WenKai Medium (霞鹜文楷, OFL) to every CJK character used by the V3 sources and stylesheet.
# Needs fontTools (pyftsubset) and the full TTF:
#   https://github.com/lxgw/LxgwWenKai/releases (LXGWWenKai-Medium.ttf)
# Re-run after adding new text to src/v3/, or the new characters fall back to the system font.
set -e
cd "$(dirname "$0")/../.."
TTF=${TTF:?set TTF=/path/to/LXGWWenKai-Medium.ttf}
CHARS=$(mktemp)
python3 - "$CHARS" <<'PY'
import glob, re, sys
chars = set(chr(c) for c in range(0x20, 0x7f)) | set('×·…—“”‘’')
for f in glob.glob('src/v3/**/*.ts', recursive=True) + glob.glob('src/v3/**/*.css', recursive=True) + ['index.html']:
    chars |= set(re.findall(r'[　-鿿＀-￯]', open(f, encoding='utf-8').read()))
open(sys.argv[1], 'w').write(''.join(sorted(chars)))
print(len(chars), 'glyphs')
PY
PYFT=$(command -v pyftsubset || echo ~/.virtualenvs/gri-env/bin/pyftsubset)
"$PYFT" "$TTF" --text-file="$CHARS" --flavor=woff2 --output-file=assets/fonts/lxgw-wenkai-v3.woff2 --layout-features='*'
ls -la assets/fonts/lxgw-wenkai-v3.woff2
