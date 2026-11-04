#!/bin/bash
# Subsets Zhi Mang Xing (OFL) to every CJK character used by the V3 sources.
# Needs fontTools (pyftsubset) and the full TTF (google/fonts ofl/zhimangxing).
set -e
cd "$(dirname "$0")/../.."
TTF=${TTF:-/tmp/claude-1000/-project/208ef5cb-c3f2-4f22-bd5d-377601abb739/scratchpad/font/ZhiMangXing.ttf}
CHARS=$(mktemp)
python3 - "$CHARS" <<'PY'
import glob, re, sys
chars = set('0123456789×+-·!?！？')
for f in glob.glob('src/v3/**/*.ts', recursive=True):
    chars |= set(re.findall(r'[　-鿿＀-￯]', open(f, encoding='utf-8').read()))
open(sys.argv[1], 'w').write(''.join(sorted(chars)))
print(len(chars), 'glyphs')
PY
PYFT=$(command -v pyftsubset || echo ~/.virtualenvs/gri-env/bin/pyftsubset)
"$PYFT" "$TTF" --text-file="$CHARS" --flavor=woff2 --output-file=assets/fonts/zhi-mang-xing-v3.woff2 --layout-features='*'
ls -la assets/fonts/zhi-mang-xing-v3.woff2
