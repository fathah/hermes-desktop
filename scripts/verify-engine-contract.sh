#!/usr/bin/env bash
# Runtime proof for the installed Hermes Agent contract surface. Bundles the
# verifier and runs it under Electron's node, matching the other verify:* gates.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=".verify-engine-contract.cjs"
trap 'rm -f "$OUT"' EXIT

npx esbuild scripts/verify-engine-contract.ts \
  --bundle --platform=node --format=cjs --packages=external --outfile="$OUT"

ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron "$OUT"
