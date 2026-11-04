#!/bin/bash
# Generates V3 art with gpt-image-2.5 via the local imagegen CLI. Raw PNGs go to $OUT (not committed).
OUT=${OUT:-/tmp/claude-1000/-project/208ef5cb-c3f2-4f22-bd5d-377601abb739/scratchpad/v3art}
mkdir -p "$OUT"
IMAGE_GEN=~/.codex/skills/.system/imagegen/scripts/image_gen.py
export OPENAI_BASE_URL=${OPENAI_BASE_URL:-https://cli.inlite.cn/v1}
gen() { id=$(jq -r .id <<<"$1"); [ -s "$OUT/$id.png" ] && return; python3 "$IMAGE_GEN" generate --model gpt-image-2.5 --quality high --no-augment --size "$(jq -r .size <<<"$1")" --prompt "$(jq -r .prompt <<<"$1")" --out "$OUT/$id.png" >"$OUT/$id.log" 2>&1 && echo "ok $id" || echo "FAIL $id"; }
export -f gen; export OUT IMAGE_GEN OPENAI_BASE_URL
cat "$(dirname "$0")/prompts.jsonl" | xargs -d '\n' -P 4 -I{} bash -c 'gen "$@"' _ {}
