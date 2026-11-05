#!/bin/bash
# Builds the V3 display font (titles, buttons, tile and relic glyphs):
#   - Ma Shan Zheng (马善政毛笔楷书, OFL) subset to every CJK character V3 uses;
#   - characters Ma Shan Zheng lacks are taken from LXGW WenKai Medium (霞鹜文楷, OFL) into a tiny fallback.
# Needs fontTools and both TTFs:
#   MSZ=https://github.com/google/fonts/raw/main/ofl/mashanzheng/MaShanZheng-Regular.ttf
#   WENKAI=https://github.com/lxgw/LxgwWenKai/releases (LXGWWenKai-Medium.ttf)
# Re-run after adding new text to src/v3/, or the new characters fall back to the system font.
set -e
cd "$(dirname "$0")/../.."
MSZ=${MSZ:?set MSZ=/path/to/MaShanZheng-Regular.ttf}
WENKAI=${WENKAI:?set WENKAI=/path/to/LXGWWenKai-Medium.ttf}
PY=$(command -v python3)
[ -x ~/.virtualenvs/gri-env/bin/python ] && ! "$PY" -c 'import fontTools' 2>/dev/null && PY=~/.virtualenvs/gri-env/bin/python
WORK=$(mktemp -d)
"$PY" - "$MSZ" "$WORK" <<'PY'
import glob, re, sys
from fontTools.ttLib import TTFont
chars = set(chr(c) for c in range(0x20, 0x7f)) | set('×·…—“”‘’')
for f in glob.glob('src/v3/**/*.ts', recursive=True) + glob.glob('src/v3/**/*.css', recursive=True) + ['index.html']:
    chars |= set(re.findall(r'[　-鿿＀-￯]', open(f, encoding='utf-8').read()))
cmap = TTFont(sys.argv[1]).getBestCmap()
have = ''.join(sorted(c for c in chars if ord(c) in cmap))
lack = ''.join(sorted(c for c in chars if ord(c) not in cmap))
open(sys.argv[2] + '/main.txt', 'w').write(have)
open(sys.argv[2] + '/fallback.txt', 'w').write(lack or '箓')
print(len(have), 'glyphs from Ma Shan Zheng;', len(lack), 'from WenKai:', lack)
PY
"$PY" -m fontTools.subset "$MSZ" --text-file="$WORK/main.txt" --flavor=woff2 --output-file=assets/fonts/ma-shan-zheng-v3.woff2 --layout-features='*'
"$PY" -m fontTools.subset "$WENKAI" --text-file="$WORK/fallback.txt" --flavor=woff2 --output-file=assets/fonts/brush-fallback-v3.woff2 --layout-features='*'
ls -la assets/fonts/ma-shan-zheng-v3.woff2 assets/fonts/brush-fallback-v3.woff2
