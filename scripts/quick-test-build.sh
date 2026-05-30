#!/bin/bash
#
# One-liner build for current platform - simplest possible
# Usage: ./scripts/quick-test-build.sh
#

set -e

echo "🚀 Hermes Desktop - Quick Test Build"
echo "===================================="
echo ""

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin)
    PLATFORM="mac"
    EXT="dmg"
    ;;
  Linux)
    PLATFORM="linux"
    EXT="AppImage"
    ;;
  MINGW*|CYGWIN*|MSYS*)
    PLATFORM="win"
    EXT="exe"
    ;;
  *)
    echo "Unknown OS: $OS"
    exit 1
    ;;
esac

echo "📱 Platform: $OS ($ARCH)"
echo "📦 Target: $PLATFORM (.$EXT)"
echo ""

# Quick dependency check
if ! command -v npm &> /dev/null; then
  echo "❌ npm not found. Install Node.js first: https://nodejs.org"
  exit 1
fi

# Install and build
echo "⏳ Installing dependencies (this may take a minute)..."
npm ci --silent

echo "🔨 Building app..."
npm run build --silent

echo "📦 Packaging..."
case "$PLATFORM" in
  mac)
    npx electron-builder --mac dmg --publish never 2>&1 | tail -5
    ;;
  linux)
    npx electron-builder --linux AppImage --publish never 2>&1 | tail -5
    ;;
  win)
    npx electron-builder --win nsis --x64 --publish never 2>&1 | tail -5
    ;;
esac

# Find the built file
VERSION=$(node -p "require('./package.json').version")
BUILT_FILE=$(ls dist/*.$EXT 2>/dev/null | head -1)

if [ -f "$BUILT_FILE" ]; then
  echo ""
  echo "✅ SUCCESS! Built: $BUILT_FILE"
  echo ""
  echo "📋 To hand to a tester:"
  echo "   1. Copy this file: $BUILT_FILE"
  echo "   2. Copy: TESTING-GUIDE.md"
  echo "   3. Put both in a folder and send to tester"
  echo ""
  ls -lh "$BUILT_FILE"
else
  echo "❌ Build may have failed - check dist/ folder"
  ls -la dist/ 2>/dev/null || echo "No dist folder found"
  exit 1
fi
