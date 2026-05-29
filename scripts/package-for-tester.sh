#!/bin/bash
#
# Package Hermes Desktop for easy handoff to a tester
# Creates a zip with the installer + testing guide
#

set -e

PLATFORM=${1:-"current"}
VERSION=$(node -p "require('./package.json').version")
BUILD_DIR="builds-for-testing"

echo "📦 Packaging Hermes Desktop v$VERSION for testers"
echo ""

# Run the build
./scripts/build-for-tester.sh "$PLATFORM"

# Create package folder
PKG_NAME="hermes-desktop-v$VERSION-for-testing"
PKG_DIR="$BUILD_DIR/$PKG_NAME"

mkdir -p "$PKG_DIR"

# Copy files
cp "$BUILD_DIR"/*.{dmg,exe,AppImage,deb,rpm} "$PKG_DIR/" 2>/dev/null || true
cp TESTING-GUIDE.md "$PKG_DIR/README.txt"

# Create a simple info file
cat > "$PKG_DIR/INSTALL.txt" << 'EOF'
HERMES DESKTOP - TEST VERSION
==============================

1. Find your installer:
   - Mac: .dmg file (drag to Applications)
   - Windows: .exe file (run installer)
   - Linux: .AppImage (double-click to run)

2. Read TESTING-GUIDE.md for detailed instructions

3. Report issues to: https://github.com/fathah/hermes-desktop/issues

THANK YOU FOR TESTING!
EOF

# Create zip
OUTPUT_FILE="$BUILD_DIR/$PKG_NAME.zip"
cd "$BUILD_DIR"
zip -r "$PKG_NAME.zip" "$PKG_NAME"
cd ..

# Cleanup temp folder
rm -rf "$PKG_DIR"

echo ""
echo "✅ Package ready: $OUTPUT_FILE"
echo ""
echo "📤 To send to tester:"
echo "   - Email the zip file"
echo "   - Or upload to Dropbox/Google Drive"
echo "   - Or use WeTransfer for large files"
echo ""
ls -lh "$OUTPUT_FILE"
