#!/bin/bash
# Generates V3 art via the local imagegen CLI. Raw PNGs go to $OUT (not committed).
#   PROMPTS=<jsonl> (default prompts.jsonl; alternative sets come from styles.py)
#   MODEL=<image model> (default gpt-image-2.5)
OUT=${OUT:?set OUT=/dir/for/raw/pngs}
PROMPTS=${PROMPTS:-$(dirname "$0")/prompts.jsonl}
MODEL=${MODEL:-gpt-image-2.5}
mkdir -p "$OUT"
IMAGE_GEN=~/.codex/skills/.system/imagegen/scripts/image_gen.py
export OPENAI_BASE_URL=${OPENAI_BASE_URL:-https://cli.inlite.cn/v1}
gen() { id=$(jq -r .id <<<"$1"); [ -s "$OUT/$id.png" ] && return; python3 "$IMAGE_GEN" generate --model "$MODEL" --quality high --no-augment --size "$(jq -r .size <<<"$1")" --prompt "$(jq -r .prompt <<<"$1")" --out "$OUT/$id.png" >"$OUT/$id.log" 2>&1 && echo "ok $id" || echo "FAIL $id"; }
export -f gen; export OUT IMAGE_GEN OPENAI_BASE_URL MODEL
xargs -d '\n' -P "${JOBS:-4}" -I{} bash -c 'gen "$@"' _ {} < "$PROMPTS"
