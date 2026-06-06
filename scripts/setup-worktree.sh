#!/usr/bin/env bash
# setup-worktree.sh — bootstrap a fresh git worktree with its OWN node_modules.
#
# Why this exists: worktrees do not get a node_modules of their own, and the
# tempting shortcut — symlinking node_modules to the primary checkout — is a trap.
# This repo has native modules (better-sqlite3) and is routinely worked on from
# several concurrent sessions; a concurrent `npm install` in the shared tree
# mutates the symlinked modules mid-flight, producing phantom "cannot find
# module" typecheck/build failures in files you never touched.
#
# Run this once from inside a new worktree:  bash scripts/setup-worktree.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -L node_modules ]; then
  echo "→ removing symlinked node_modules (must be isolated per worktree)"
  rm -f node_modules
fi

if [ -f package-lock.json ]; then
  echo "→ npm ci (clean, lockfile-exact install)"
  npm ci
else
  echo "→ npm install (no lockfile found)"
  npm install
fi

echo "✓ worktree ready — node_modules is isolated to this tree"
