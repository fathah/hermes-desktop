#!/usr/bin/env bash
# Runtime proof for the External Context Bridge index. Bundles the standalone
# verification script and runs it under Electron's node (so the Electron-ABI
# better-sqlite3 binary loads). See scripts/verify-external-context.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=".verify-ec.cjs"
trap 'rm -f "$OUT"' EXIT

npx esbuild scripts/verify-external-context.ts \
  --bundle --platform=node --format=cjs --packages=external --outfile="$OUT"

ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron "$OUT"
