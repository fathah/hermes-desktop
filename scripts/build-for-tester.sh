#!/bin/bash
#
# Build Hermes Desktop for a non-technical tester
# Usage: ./scripts/build-for-tester.sh [mac|win|linux]
#

set -e

PLATFORM=${1:-"current"}
VERSION=$(node -p "require('./package.json').version")
DIST_DIR="dist"
BUILD_DIR="builds-for-testing"

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
mkdir -p "$BUILD_DIR"

# Build based on platform
case "$PLATFORM" in
  mac|macos|darwin)
    echo "🍎 Building macOS artifacts..."
    npx electron-builder --mac dmg zip --publish never
    cp "$DIST_DIR"/*.dmg "$BUILD_DIR/" 2>/dev/null || true
    cp "$DIST_DIR"/*-mac.zip "$BUILD_DIR/" 2>/dev/null || true
    ;;
  
  win|windows|win32)
    echo "🪟 Building Windows artifacts..."
    npx electron-builder --win nsis portable --x64 --publish never
    cp "$DIST_DIR"/*-setup.exe "$BUILD_DIR/" 2>/dev/null || true
    cp "$DIST_DIR"/*-portable.exe "$BUILD_DIR/" 2>/dev/null || true
    ;;
  
  linux)
    echo "🐧 Building Linux artifacts..."
    npx electron-builder --linux AppImage deb --publish never
    cp "$DIST_DIR"/*.AppImage "$BUILD_DIR/" 2>/dev/null || true
    cp "$DIST_DIR"/*.deb "$BUILD_DIR/" 2>/dev/null || true
    ;;
  
  current|auto)
    OS=$(uname -s)
    case "$OS" in
      Darwin)
        echo "🍎 Detected macOS, building..."
        npx electron-builder --mac dmg --publish never
        cp "$DIST_DIR"/*.dmg "$BUILD_DIR/" 2>/dev/null || true
        ;;
      Linux)
        echo "🐧 Detected Linux, building AppImage..."
        npx electron-builder --linux AppImage --publish never
        cp "$DIST_DIR"/*.AppImage "$BUILD_DIR/" 2>/dev/null || true
        ;;
      MINGW*|CYGWIN*|MSYS*)
        echo "🪟 Detected Windows, building..."
        npx electron-builder --win nsis --x64 --publish never
        cp "$DIST_DIR"/*-setup.exe "$BUILD_DIR/" 2>/dev/null || true
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
echo "📁 Output files in $BUILD_DIR/:"
ls -lh "$BUILD_DIR/" 2>/dev/null || echo "   (no files found)"
echo ""
echo "📝 Next steps:"
echo "   1. Copy the file(s) from $BUILD_DIR/ to the tester's computer"
echo "   2. Include TESTING-GUIDE.md with the files"
echo "   3. Have them follow the guide!"
echo ""
