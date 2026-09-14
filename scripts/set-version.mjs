#!/usr/bin/env node
// Rewrite package.json's "version" field in place. Used by the beta-release
// workflow to stamp a `-beta.N` prerelease version before building, so the
// artifacts and electron-builder's channel update file (`beta.yml`) carry the
// beta version without a committed version bump. Not for stable releases —
// those read the version straight from package.json.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/set-version.mjs <version>");
  process.exit(1);
}

// Guard against a malformed value corrupting package.json. Accepts semver with
// an optional prerelease/build suffix, e.g. 0.7.4 or 0.7.4-beta.3.
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Refusing to set an invalid version: "${version}"`);
  process.exit(1);
}

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Set package.json version to ${version}`);
