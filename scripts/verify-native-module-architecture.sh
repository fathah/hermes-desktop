#!/usr/bin/env bash

set -euo pipefail

ARCH="${1:-}"
if [[ "$ARCH" != "x64" && "$ARCH" != "arm64" ]]; then
  echo "Usage: $0 <x64|arm64>" >&2
  exit 2
fi

APP_ROOT="dist/mac-$ARCH/Hermes One.app"
if [[ ! -d "$APP_ROOT" ]]; then
  APP_ROOT="dist/mac/Hermes One.app"
fi

NODE_FILE="$APP_ROOT/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/darwin-$ARCH.node"
if [[ ! -f "$NODE_FILE" ]]; then
  echo "Missing packaged better-sqlite3 binary: $NODE_FILE" >&2
  exit 1
fi

file "$NODE_FILE"
case "$ARCH" in
  x64) file "$NODE_FILE" | grep -q "x86_64" ;;
  arm64) file "$NODE_FILE" | grep -q "arm64" ;;
esac
