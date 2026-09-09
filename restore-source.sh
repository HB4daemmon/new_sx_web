#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
cat bootstrap/source.part.*.b64 | base64 -d > /tmp/fengshen-source.tar.xz
tar -xJf /tmp/fengshen-source.tar.xz
printf 'Fengshen source restored.\nRun: npm install && npm test\n'
