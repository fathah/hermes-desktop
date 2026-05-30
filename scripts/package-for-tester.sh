#!/bin/bash
#
# Package Hermes Desktop for easy handoff to a tester
# Creates a zip with the installer + testing guide
# Requires bash-compatible tooling: bash, npm, npx, cp, zip, shasum, and uname.
#

set -euo pipefail

PLATFORM=${1:-"current"}
VERSION=$(node -p "require('./package.json').version")
BUILD_DIR="builds-for-testing"
ARTIFACT_DIR="$BUILD_DIR/artifacts"

echo "📦 Packaging Hermes Desktop v$VERSION for testers"
echo ""

# Run the build
./scripts/build-for-tester.sh "$PLATFORM"

# Create package folder
PKG_NAME="hermes-desktop-v$VERSION-for-testing"
PKG_DIR="$BUILD_DIR/$PKG_NAME"

rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"

# Copy files
shopt -s nullglob
ARTIFACTS=(
  "$ARTIFACT_DIR"/*.dmg
  "$ARTIFACT_DIR"/*.exe
  "$ARTIFACT_DIR"/*.AppImage
  "$ARTIFACT_DIR"/*.deb
  "$ARTIFACT_DIR"/*.rpm
)
shopt -u nullglob

if [ "${#ARTIFACTS[@]}" -eq 0 ]; then
  echo "❌ No installer artifacts found in $ARTIFACT_DIR"
  exit 1
fi

cp "${ARTIFACTS[@]}" "$PKG_DIR/"
cp TESTING-GUIDE.md "$PKG_DIR/README.txt"

# Create a simple info file
cat > "$PKG_DIR/INSTALL.txt" << 'EOF'
HERMES DESKTOP - TEST VERSION
==============================

1. Find your installer:
   - Mac: .dmg file (drag to Applications)
   - Windows: .exe file (run installer)
   - Linux: .AppImage (double-click to run)

2. Read README.txt for detailed instructions

3. Verify installer hashes using SHA256SUMS.txt and a trusted source

4. Report issues to: https://github.com/fathah/hermes-desktop/issues

THANK YOU FOR TESTING!
EOF

# Provenance files
(
  cd "$PKG_DIR"
  shopt -s nullglob
  CHECKSUM_FILES=( ./*.dmg ./*.exe ./*.AppImage ./*.deb ./*.rpm )
  shasum -a 256 -- "${CHECKSUM_FILES[@]}"
) > "$PKG_DIR/SHA256SUMS.txt"

ARTIFACT_LIST=$(
  cd "$PKG_DIR"
  shopt -s nullglob
  ls -lh -- ./*.dmg ./*.exe ./*.AppImage ./*.deb ./*.rpm
)

cat > "$PKG_DIR/MANIFEST.txt" << EOF
Hermes Desktop tester build
Version: $VERSION
Platform request: $PLATFORM
Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Git SHA: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)

Artifacts:
$ARTIFACT_LIST
EOF

# Create zip
OUTPUT_FILE="$BUILD_DIR/$PKG_NAME.zip"
rm -f "$OUTPUT_FILE"
cd "$BUILD_DIR"
zip -r "$PKG_NAME.zip" "$PKG_NAME"
cd ..

# Cleanup temp folder
rm -rf "$PKG_DIR"

echo ""
echo "✅ Package ready: $OUTPUT_FILE"
echo ""
echo "📤 To send to tester:"
echo "   - Prefer a trusted release channel or access-controlled drive link"
echo "   - Share SHA256SUMS.txt through a trusted channel before they bypass OS warnings"
echo ""
ls -lh "$OUTPUT_FILE"
