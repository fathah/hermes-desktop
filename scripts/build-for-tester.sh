#!/bin/bash
#
# Build Hermes Desktop for a non-technical tester
# Usage: ./scripts/build-for-tester.sh [mac|win|linux]
# Requires bash-compatible tooling: bash, npm, npx, cp, mktemp, and uname.
#

set -euo pipefail

PLATFORM=${1:-"current"}
VERSION=$(node -p "require('./package.json').version")
DIST_DIR="dist"
BUILD_DIR="builds-for-testing"
ARTIFACT_DIR="$BUILD_DIR/artifacts"
STAGE_DIR=""

cleanup() {
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
    rm -rf "$STAGE_DIR"
  fi
}
trap cleanup EXIT

prepare_stage() {
  mkdir -p "$BUILD_DIR"
  STAGE_DIR=$(mktemp -d "$BUILD_DIR/stage.XXXXXX")
}

publish_artifacts() {
  local patterns=("$@")
  local artifacts=()

  shopt -s nullglob
  for pattern in "${patterns[@]}"; do
    artifacts+=( $pattern )
  done
  shopt -u nullglob

  if [ "${#artifacts[@]}" -eq 0 ]; then
    echo "❌ No fresh installer artifacts found in $DIST_DIR"
    exit 1
  fi

  cp "${artifacts[@]}" "$STAGE_DIR/"
  rm -rf "$ARTIFACT_DIR"
  mkdir -p "$ARTIFACT_DIR"
  cp "$STAGE_DIR"/* "$ARTIFACT_DIR/"
}

echo "🏗️  Building Hermes Desktop v$VERSION for platform: $PLATFORM"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Rebuild native modules
echo "🔧 Rebuilding native modules..."
npx electron-builder install-app-deps

# Build the app
echo "🚀 Building application..."
npm run build

# Create output directory
prepare_stage

# Build based on platform
case "$PLATFORM" in
  mac|macos|darwin)
    echo "🍎 Building macOS artifacts..."
    npx electron-builder --mac dmg zip --publish never
    publish_artifacts "$DIST_DIR"/*.dmg "$DIST_DIR"/*-mac.zip
    ;;
  
  win|windows|win32)
    echo "🪟 Building Windows artifacts..."
    npx electron-builder --win nsis portable --x64 --publish never
    publish_artifacts "$DIST_DIR"/*-setup.exe "$DIST_DIR"/*-portable.exe
    ;;
  
  linux)
    echo "🐧 Building Linux artifacts..."
    npx electron-builder --linux AppImage deb --publish never
    publish_artifacts "$DIST_DIR"/*.AppImage "$DIST_DIR"/*.deb
    ;;
  
  current|auto)
    OS=$(uname -s)
    case "$OS" in
      Darwin)
        echo "🍎 Detected macOS, building..."
        npx electron-builder --mac dmg --publish never
        publish_artifacts "$DIST_DIR"/*.dmg
        ;;
      Linux)
        echo "🐧 Detected Linux, building AppImage..."
        npx electron-builder --linux AppImage --publish never
        publish_artifacts "$DIST_DIR"/*.AppImage
        ;;
      MINGW*|CYGWIN*|MSYS*)
        echo "🪟 Detected Windows, building..."
        npx electron-builder --win nsis --x64 --publish never
        publish_artifacts "$DIST_DIR"/*-setup.exe
        ;;
      *)
        echo "❌ Unknown OS: $OS"
        exit 1
        ;;
    esac
    ;;
  
  *)
    echo "❌ Unknown platform: $PLATFORM"
    echo "Usage: $0 [mac|win|linux|current]"
    exit 1
    ;;
esac

echo ""
echo "✅ Build complete!"
echo ""
echo "📁 Output files in $ARTIFACT_DIR/:"
ls -lh "$ARTIFACT_DIR/"
echo ""
echo "📝 Next steps:"
echo "   1. Copy the file(s) from $ARTIFACT_DIR/ to the tester's computer"
echo "   2. Include TESTING-GUIDE.md and SHA256 checksums with the files"
echo "   3. Have them follow the guide!"
echo ""
