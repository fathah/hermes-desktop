#!/usr/bin/env bash
# KB dogfood runner (item 9). Bundles dogfood-kb.ts and runs it under Electron's
# node so the Electron-ABI better-sqlite3 binary loads (same pattern as
# scripts/verify-note-index.sh).
#
# HERMES_HOME is set to a throwaway temp dir BEFORE the bundle loads, so the real
# installer.ts captures it at import time and the whole grounding pipeline reads
# the seeded corpus vault instead of your real ~/.hermes.
#
# Phase B (live answers) runs only if GATEWAY_URL is exported, e.g.:
#   GATEWAY_URL=http://127.0.0.1:8642 GATEWAY_KEY=secret GATEWAY_MODEL=hermes-agent \
#     bash scripts/kb-dogfood/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

DIR="scripts/kb-dogfood"
OUT=".dogfood-kb.cjs"
HOME_TMP="$(mktemp -d "${TMPDIR:-/tmp}/kb-dogfood-home.XXXXXX")"
trap 'rm -f "$OUT"; rm -rf "$HOME_TMP"' EXIT

npx esbuild "$DIR/dogfood-kb.ts" \
  --bundle --platform=node --format=cjs --packages=external --outfile="$OUT"

HERMES_HOME="$HOME_TMP" \
CORPUS_DIR="$PWD/$DIR/corpus" \
QUESTIONS_FILE="$PWD/$DIR/questions.json" \
OUT_DIR="${OUT_DIR:-/tmp/kb-dogfood-out}" \
GATEWAY_URL="${GATEWAY_URL:-}" \
GATEWAY_KEY="${GATEWAY_KEY:-}" \
GATEWAY_MODEL="${GATEWAY_MODEL:-hermes-agent}" \
  ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron "$OUT"
