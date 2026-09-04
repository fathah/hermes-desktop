#!/bin/bash

set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${CSC_LINK:?CSC_LINK is required}"
: "${CSC_KEY_PASSWORD:?CSC_KEY_PASSWORD is required}"

signing_dir="$RUNNER_TEMP/hermes-macos-signing"
certificate_path="$signing_dir/developer-id.p12"
keychain_path="$signing_dir/hermes-signing.keychain-db"
keychain_password="${MACOS_KEYCHAIN_PASSWORD:-$(openssl rand -hex 32)}"

mkdir -p "$signing_dir"
chmod 700 "$signing_dir"

cleanup_certificate() {
  rm -f "$certificate_path"
}
trap cleanup_certificate EXIT

echo "::add-mask::$keychain_password"
printf '%s' "$CSC_LINK" | base64 --decode > "$certificate_path"
chmod 600 "$certificate_path"

security create-keychain -p "$keychain_password" "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$CSC_KEY_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/productbuild

# macOS 26.6 requires the keychain password here. Electron Builder 26 passes
# CSC_KEY_PASSWORD (the .p12 password), which leaves the imported key unusable.
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$keychain_password" \
  "$keychain_path"

if ! security find-identity -v -p codesigning "$keychain_path" | grep -q "Developer ID Application"; then
  echo "No Developer ID Application identity was imported." >&2
  exit 1
fi

echo "CSC_KEYCHAIN=$keychain_path" >> "$GITHUB_ENV"
