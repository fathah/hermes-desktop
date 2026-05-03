# Windows (winget) and Fedora (RPM) Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing GitHub Actions release pipeline to produce a Windows NSIS installer + winget manifests, and a Fedora `.rpm`, alongside the existing macOS/Linux artifacts. End state: open a PR from `Aiacos/hermes-desktop:feat/winget-rpm-release` to `fathah/hermes-desktop:main`.

**Architecture:** Two new jobs added to `.github/workflows/release.yml` (Windows build + winget manifest generator), one existing job extended (Linux gets rpm), one job gated on a new `dry_run` input. Winget manifests are filled from YAML templates by a tested Node ESM script and uploaded as a CI artifact for manual submission to `microsoft/winget-pkgs`.

**Tech Stack:** GitHub Actions, electron-builder 26, Node 22 ESM, vitest, fpm/rpmbuild on Ubuntu runner.

**Spec:** `docs/superpowers/specs/2026-04-30-windows-winget-fedora-rpm-release-design.md`

**Branch:** `feat/winget-rpm-release` (already created locally; see Task 1 to confirm).

---

## Pre-flight: confirm starting state

### Task 0: Confirm we're on the right branch with a clean tree

- [ ] **Step 1: Check branch and status**

Run: `git status && git branch --show-current && git log --oneline -3`

Expected output:
- Current branch: `feat/winget-rpm-release`
- Working tree clean
- Top commit: `docs: add design spec for Windows (winget) and Fedora (RPM) release`

If on a different branch or tree is dirty, stop and resolve before proceeding.

---

## Phase 1: electron-builder configuration

### Task 1: Add RPM target and Linux packaging metadata to electron-builder.yml

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Replace the `linux:` block and add `rpm:` block**

Open `electron-builder.yml`. Replace the existing block:

```yaml
linux:
  target:
    - AppImage
    - snap
    - deb
  maintainer: electronjs.org
  category: Utility
appImage:
  artifactName: ${name}-${version}.${ext}
```

with:

```yaml
linux:
  target:
    - AppImage
    - snap
    - deb
    - rpm
  maintainer: electronjs.org
  vendor: Nous Research
  category: Utility
  synopsis: Self-improving AI assistant desktop app
  description: |
    Hermes Desktop is a native desktop app for installing, configuring, and chatting
    with Hermes Agent — a self-improving AI assistant with tool use, multi-platform
    messaging, and a closed learning loop.
appImage:
  artifactName: ${name}-${version}.${ext}
rpm:
  artifactName: ${name}-${version}.${ext}
```

- [ ] **Step 2: Verify YAML is still valid**

Run: `node -e "console.log(require('js-yaml').load(require('fs').readFileSync('electron-builder.yml','utf-8')).linux.target)" 2>/dev/null || node -e "console.log(JSON.parse(JSON.stringify(require('yaml').parse(require('fs').readFileSync('electron-builder.yml','utf-8')))).linux.target)" 2>/dev/null || python3 -c "import yaml; print(yaml.safe_load(open('electron-builder.yml')).get('linux', {}).get('target'))"`

Expected output: `['AppImage', 'snap', 'deb', 'rpm']` (Python form) or `[ 'AppImage', 'snap', 'deb', 'rpm' ]` (Node form).

If neither `js-yaml`, `yaml`, nor Python yaml is available, just open the file and visually verify the four entries.

### Task 2: Make NSIS settings explicit in electron-builder.yml

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Replace the `nsis:` block**

Replace:

```yaml
nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: ${productName}
  uninstallDisplayName: ${productName}
  createDesktopShortcut: always
```

with:

```yaml
nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: ${productName}
  uninstallDisplayName: ${productName}
  createDesktopShortcut: always
  oneClick: true
  perMachine: false
```

The two new fields make the existing electron-builder defaults explicit so the behavior cannot silently shift across electron-builder versions.

### Task 3: Add `build:rpm` script to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Insert the script next to the existing `build:linux`**

In `package.json` `"scripts"` block, after the line:
```json
"build:linux": "electron-vite build && electron-builder --linux",
```
add:
```json
"build:rpm": "npm run build && electron-builder --linux rpm",
```

Final scripts block excerpt should look like:

```json
"build:mac": "electron-vite build && electron-builder --mac",
"build:linux": "electron-vite build && electron-builder --linux",
"build:rpm": "npm run build && electron-builder --linux rpm",
"test:watch": "vitest"
```

- [ ] **Step 2: Verify package.json still parses**

Run: `node -e "console.log(require('./package.json').scripts['build:rpm'])"`

Expected output: `npm run build && electron-builder --linux rpm`

### Task 4: Local sanity-check the RPM build (Fedora host only)

This step verifies that the new electron-builder `rpm` target produces a real RPM on the local Fedora machine before we trust CI to do it. This is a **manual, non-CI** check. Skip if not on a Fedora host.

- [ ] **Step 1: Confirm rpmbuild is present**

Run: `which rpmbuild && rpmbuild --version`

Expected: a path under `/usr/bin/` and a version string. If missing, install with `sudo dnf install rpm-build`.

- [ ] **Step 2: Run the RPM build**

Run: `npm install && npm run build:rpm`

Expected: completes without errors, ~2-5 minutes. Final lines should mention writing an `.rpm` file under `dist/`.

- [ ] **Step 3: Confirm the RPM was produced**

Run: `ls -la dist/*.rpm && rpm -qpi dist/*.rpm | head -20`

Expected:
- A file `dist/hermes-desktop-0.2.3.rpm` (or current version) of non-trivial size (~120-200 MB)
- `rpm -qpi` shows `Name: hermes-desktop`, `Version: 0.2.3`, `Vendor: Nous Research`, `License`, `Summary` matching our `synopsis`.

If the RPM is missing or metadata is wrong, go back to Task 1 and fix.

- [ ] **Step 4: Clean up dist before committing**

Run: `rm -rf dist out node_modules/.cache`

Reason: keeps the working tree clean so the next commit only contains our config changes.

### Task 5: Commit electron-builder + package.json changes

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add electron-builder.yml package.json
git status
git commit -m "build: add rpm target and explicit nsis settings to electron-builder"
```

Expected: 1 commit, 2 files changed. `git status` should show clean working tree afterwards.

---

## Phase 2: Winget manifest infrastructure

### Task 6: Create the three winget manifest templates

**Files:**
- Create: `build/winget/Installer.template.yaml`
- Create: `build/winget/Locale.en-US.template.yaml`
- Create: `build/winget/Version.template.yaml`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p build/winget`

- [ ] **Step 2: Create `build/winget/Installer.template.yaml`**

Contents:

```yaml
# Generated from this template by scripts/generate-winget-manifests.mjs.
# Placeholders ({{...}}) are replaced at build time. Do not edit the generated copy in dist/.
PackageIdentifier: NousResearch.HermesDesktop
PackageVersion: {{VERSION}}
InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
MinimumOSVersion: 10.0.17763.0
ReleaseDate: {{RELEASE_DATE}}
Installers:
  - Architecture: x64
    InstallerUrl: {{INSTALLER_URL}}
    InstallerSha256: {{INSTALLER_SHA256}}
    UpgradeBehavior: install
ManifestType: installer
ManifestVersion: 1.6.0
```

- [ ] **Step 3: Create `build/winget/Locale.en-US.template.yaml`**

Contents:

```yaml
# Generated from this template by scripts/generate-winget-manifests.mjs.
PackageIdentifier: NousResearch.HermesDesktop
PackageVersion: {{VERSION}}
PackageLocale: en-US
Publisher: Nous Research
PublisherUrl: https://github.com/fathah/hermes-desktop
PublisherSupportUrl: https://github.com/fathah/hermes-desktop/issues
PackageName: Hermes Agent
PackageUrl: https://github.com/fathah/hermes-desktop
License: MIT
LicenseUrl: https://github.com/fathah/hermes-desktop/blob/main/LICENSE
ShortDescription: Self-improving AI assistant desktop app
Description: |-
  Hermes Desktop is a native desktop app for installing, configuring, and chatting
  with Hermes Agent — a self-improving AI assistant with tool use, multi-platform
  messaging, and a closed learning loop.
Tags:
  - ai
  - agent
  - desktop
  - electron
  - llm
ReleaseNotesUrl: {{RELEASE_NOTES_URL}}
ManifestType: defaultLocale
ManifestVersion: 1.6.0
```

- [ ] **Step 4: Create `build/winget/Version.template.yaml`**

Contents:

```yaml
# Generated from this template by scripts/generate-winget-manifests.mjs.
PackageIdentifier: NousResearch.HermesDesktop
PackageVersion: {{VERSION}}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
```

- [ ] **Step 5: Verify the three files exist**

Run: `ls -la build/winget/`

Expected: three `.template.yaml` files listed.

### Task 7: Write the failing test for the manifest generator

**Files:**
- Create: `tests/winget-generator.test.ts`

- [ ] **Step 1: Create `tests/winget-generator.test.ts`**

Contents:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
} from "fs";
import { tmpdir } from "os";
// @ts-expect-error - .mjs has no type declarations; we test it as JS.
import { generateWingetManifests } from "../scripts/generate-winget-manifests.mjs";

let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), "winget-test-"));
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function setupTemplates(rootDir: string) {
  const buildDir = join(rootDir, "build", "winget");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(
    join(buildDir, "Installer.template.yaml"),
    "Version: {{VERSION}}\nUrl: {{INSTALLER_URL}}\nSha: {{INSTALLER_SHA256}}\nDate: {{RELEASE_DATE}}\n",
  );
  writeFileSync(
    join(buildDir, "Locale.en-US.template.yaml"),
    "Version: {{VERSION}}\nNotes: {{RELEASE_NOTES_URL}}\n",
  );
  writeFileSync(join(buildDir, "Version.template.yaml"), "Version: {{VERSION}}\n");
}

describe("generateWingetManifests", () => {
  it("produces three YAML files under the winget-pkgs directory layout", () => {
    setupTemplates(TEST_DIR);
    const distDir = join(TEST_DIR, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, "hermes-desktop-9.9.9-setup.exe"),
      "fake-installer-bytes",
    );

    generateWingetManifests({
      rootDir: TEST_DIR,
      version: "9.9.9",
      name: "hermes-desktop",
      publishOwner: "fathah",
    });

    const outDir = join(
      distDir,
      "winget",
      "manifests",
      "n",
      "NousResearch",
      "HermesDesktop",
      "9.9.9",
    );
    expect(existsSync(join(outDir, "NousResearch.HermesDesktop.installer.yaml"))).toBe(true);
    expect(existsSync(join(outDir, "NousResearch.HermesDesktop.locale.en-US.yaml"))).toBe(true);
    expect(existsSync(join(outDir, "NousResearch.HermesDesktop.yaml"))).toBe(true);
  });

  it("replaces all placeholders in the installer manifest", () => {
    setupTemplates(TEST_DIR);
    const distDir = join(TEST_DIR, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, "hermes-desktop-9.9.9-setup.exe"),
      "fake-installer-bytes",
    );

    generateWingetManifests({
      rootDir: TEST_DIR,
      version: "9.9.9",
      name: "hermes-desktop",
      publishOwner: "fathah",
    });

    const outFile = join(
      distDir,
      "winget",
      "manifests",
      "n",
      "NousResearch",
      "HermesDesktop",
      "9.9.9",
      "NousResearch.HermesDesktop.installer.yaml",
    );
    const content = readFileSync(outFile, "utf-8");
    expect(content).toContain("Version: 9.9.9");
    expect(content).toContain(
      "Url: https://github.com/fathah/hermes-desktop/releases/download/v9.9.9/hermes-desktop-9.9.9-setup.exe",
    );
    expect(content).toMatch(/Sha: [A-F0-9]{64}/);
    expect(content).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    expect(content).not.toContain("{{");
  });

  it("replaces ReleaseNotesUrl in the locale manifest", () => {
    setupTemplates(TEST_DIR);
    const distDir = join(TEST_DIR, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, "hermes-desktop-9.9.9-setup.exe"),
      "fake-installer-bytes",
    );

    generateWingetManifests({
      rootDir: TEST_DIR,
      version: "9.9.9",
      name: "hermes-desktop",
      publishOwner: "fathah",
    });

    const outFile = join(
      distDir,
      "winget",
      "manifests",
      "n",
      "NousResearch",
      "HermesDesktop",
      "9.9.9",
      "NousResearch.HermesDesktop.locale.en-US.yaml",
    );
    const content = readFileSync(outFile, "utf-8");
    expect(content).toContain(
      "Notes: https://github.com/fathah/hermes-desktop/releases/tag/v9.9.9",
    );
    expect(content).not.toContain("{{");
  });

  it("throws a clear error when the installer .exe is missing", () => {
    setupTemplates(TEST_DIR);
    mkdirSync(join(TEST_DIR, "dist"), { recursive: true });

    expect(() =>
      generateWingetManifests({
        rootDir: TEST_DIR,
        version: "9.9.9",
        name: "hermes-desktop",
        publishOwner: "fathah",
      }),
    ).toThrow(/installer not found/i);
  });
});
```

### Task 8: Verify the test fails

- [ ] **Step 1: Run vitest**

Run: `npm run test`

Expected: `tests/winget-generator.test.ts` fails with an import resolution error like `Failed to resolve import "../scripts/generate-winget-manifests.mjs"` or similar. **The other existing tests must still pass.** Total: 4 new tests failing, all existing tests passing.

If existing tests fail, stop — that's an unrelated breakage we caused. Investigate before proceeding.

### Task 9: Implement the manifest generator

**Files:**
- Create: `scripts/generate-winget-manifests.mjs`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p scripts`

- [ ] **Step 2: Create `scripts/generate-winget-manifests.mjs`**

Contents:

```javascript
// scripts/generate-winget-manifests.mjs
//
// Fills the YAML templates in build/winget/ with the current version,
// installer URL, and SHA256 of the NSIS installer in dist/, and writes
// the result under dist/winget/manifests/n/NousResearch/HermesDesktop/<version>/.
//
// Run from CLI: VERSION=0.2.3 PUBLISH_OWNER=fathah node scripts/generate-winget-manifests.mjs
// Or import as ESM and call generateWingetManifests({ rootDir, version, name, publishOwner }).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function generateWingetManifests({ rootDir, version, name, publishOwner }) {
  const exePath = join(rootDir, "dist", `${name}-${version}-setup.exe`);
  if (!existsSync(exePath)) {
    throw new Error(
      `NSIS installer not found at ${exePath}. ` +
        `Run electron-builder --win nsis first, or download the windows-artifacts CI artifact into dist/.`,
    );
  }

  const sha256 = createHash("sha256")
    .update(readFileSync(exePath))
    .digest("hex")
    .toUpperCase();
  const releaseDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const installerUrl =
    `https://github.com/${publishOwner}/hermes-desktop/releases/download/v${version}/${name}-${version}-setup.exe`;
  const releaseNotesUrl =
    `https://github.com/${publishOwner}/hermes-desktop/releases/tag/v${version}`;

  const replacements = {
    VERSION: version,
    INSTALLER_URL: installerUrl,
    INSTALLER_SHA256: sha256,
    RELEASE_DATE: releaseDate,
    RELEASE_NOTES_URL: releaseNotesUrl,
  };

  const fillTemplate = (str) =>
    Object.entries(replacements).reduce(
      (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
      str,
    );

  const templateDir = join(rootDir, "build", "winget");
  const outDir = join(
    rootDir,
    "dist",
    "winget",
    "manifests",
    "n",
    "NousResearch",
    "HermesDesktop",
    version,
  );
  mkdirSync(outDir, { recursive: true });

  const files = [
    ["Installer.template.yaml", "NousResearch.HermesDesktop.installer.yaml"],
    ["Locale.en-US.template.yaml", "NousResearch.HermesDesktop.locale.en-US.yaml"],
    ["Version.template.yaml", "NousResearch.HermesDesktop.yaml"],
  ];

  for (const [tmplName, outName] of files) {
    const tmpl = readFileSync(join(templateDir, tmplName), "utf-8");
    writeFileSync(join(outDir, outName), fillTemplate(tmpl));
  }

  return { outDir, sha256, installerUrl };
}

// CLI entrypoint
const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const rootDir = process.cwd();
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
  const result = generateWingetManifests({
    rootDir,
    version: process.env.VERSION || pkg.version,
    name: pkg.name,
    publishOwner: process.env.PUBLISH_OWNER || "fathah",
  });
  console.log(`Winget manifests generated in ${result.outDir}`);
  console.log(`InstallerSha256: ${result.sha256}`);
  console.log(`InstallerUrl: ${result.installerUrl}`);
}
```

### Task 10: Verify the test passes

- [ ] **Step 1: Run vitest**

Run: `npm run test`

Expected: all four `winget-generator` tests pass. All previously passing tests still pass. Output should end with `Tests` count incremented by 4.

If failing: read the assertion error and fix the script. Do not modify the test to make it pass — modify the implementation.

### Task 11: Commit winget infrastructure

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add build/winget/ scripts/generate-winget-manifests.mjs tests/winget-generator.test.ts
git status
git commit -m "feat: add winget manifest generator with templates and tests"
```

Expected: 5 files added, 1 commit. Working tree clean.

---

## Phase 3: GitHub Actions workflow

The following four tasks edit `.github/workflows/release.yml` in sequence. Each task ends with the workflow still being a syntactically valid YAML, but only after Task 16 is the workflow logically complete. Commit at the end of Phase 3 (Task 17), not after each individual edit.

### Task 12: Add `dry_run` input and `is_dry_run` output

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Replace the `on:` block**

Replace:

```yaml
on:
  push:
    branches:
      - release
  workflow_dispatch:
```

with:

```yaml
on:
  push:
    branches:
      - release
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Run all build jobs but skip publish (no tag, no GitHub Release)"
        type: boolean
        default: true
```

- [ ] **Step 2: Add `is_dry_run` to the `prepare` job outputs and add a step to compute it**

In the `prepare` job, replace:

```yaml
    outputs:
      version: ${{ steps.version.outputs.version }}
      tag: ${{ steps.version.outputs.tag }}
      tag_exists: ${{ steps.check.outputs.exists }}
```

with:

```yaml
    outputs:
      version: ${{ steps.version.outputs.version }}
      tag: ${{ steps.version.outputs.tag }}
      tag_exists: ${{ steps.check.outputs.exists }}
      is_dry_run: ${{ steps.mode.outputs.is_dry_run }}
```

Then, after the existing "Check if tag already exists" step inside `prepare.steps`, append:

```yaml
      - name: Compute dry-run flag
        id: mode
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ] && [ "${{ inputs.dry_run }}" = "true" ]; then
            echo "is_dry_run=true" >> "$GITHUB_OUTPUT"
            echo "Dry run: builds will run, publish will be skipped."
          else
            echo "is_dry_run=false" >> "$GITHUB_OUTPUT"
            echo "Real release: publish will run if tag does not exist."
          fi
```

### Task 13: Extend `release_linux` with rpm

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add `rpm` apt install before packaging, and rpm to the electron-builder targets**

In the `release_linux` job, locate the steps after `Install dependencies` and `Build app`. Replace:

```yaml
      - name: Package Linux artifacts
        run: npx electron-builder --linux AppImage deb --publish never

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: linux-artifacts
          path: |
            dist/*.AppImage
            dist/*.deb
            dist/latest-linux.yml
```

with:

```yaml
      - name: Install rpmbuild
        run: sudo apt-get update && sudo apt-get install -y rpm

      - name: Package Linux artifacts
        run: npx electron-builder --linux AppImage deb rpm --publish never

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: linux-artifacts
          path: |
            dist/*.AppImage
            dist/*.deb
            dist/*.rpm
            dist/latest-linux.yml
```

### Task 14: Add `release_windows` job

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Insert a new job after `release_linux`, before `publish`**

Add the following job block:

```yaml
  release_windows:
    name: Build Windows
    needs: prepare
    if: needs.prepare.outputs.tag_exists == 'false'
    runs-on: windows-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build app
        run: npm run build

      - name: Package Windows artifacts
        run: npx electron-builder --win nsis --x64 --publish never

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: windows-artifacts
          path: |
            dist/*.exe
            dist/*.exe.blockmap
            dist/latest.yml
```

### Task 15: Add `generate_winget` job

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Insert the new job after `release_windows`**

Add the following job block:

```yaml
  generate_winget:
    name: Generate winget manifests
    needs: [prepare, release_windows]
    if: needs.prepare.outputs.tag_exists == 'false'
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Download Windows installer artifact
        uses: actions/download-artifact@v4
        with:
          name: windows-artifacts
          path: dist/

      - name: Generate winget manifests
        env:
          VERSION: ${{ needs.prepare.outputs.version }}
          PUBLISH_OWNER: fathah
        run: node scripts/generate-winget-manifests.mjs

      - name: Upload winget manifests artifact
        uses: actions/upload-artifact@v4
        with:
          name: winget-manifests-${{ needs.prepare.outputs.version }}
          path: dist/winget/
```

### Task 16: Update the `publish` job (gate + explicit file list)

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Replace the `publish` job header and the gh-release files glob**

Replace the existing `publish` job:

```yaml
  publish:
    name: Publish Release
    needs: [prepare, release_mac, release_linux]
    if: needs.prepare.outputs.tag_exists == 'false'
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Create tag
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag ${{ needs.prepare.outputs.tag }}
          git push origin ${{ needs.prepare.outputs.tag }}

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Publish GitHub release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ needs.prepare.outputs.tag }}
          name: Hermes Desktop ${{ needs.prepare.outputs.tag }}
          generate_release_notes: true
          files: artifacts/*
```

with:

```yaml
  publish:
    name: Publish Release
    needs: [prepare, release_mac, release_linux, release_windows, generate_winget]
    if: needs.prepare.outputs.is_dry_run == 'false' && needs.prepare.outputs.tag_exists == 'false'
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Create tag
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag ${{ needs.prepare.outputs.tag }}
          git push origin ${{ needs.prepare.outputs.tag }}

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Publish GitHub release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ needs.prepare.outputs.tag }}
          name: Hermes Desktop ${{ needs.prepare.outputs.tag }}
          generate_release_notes: true
          files: |
            artifacts/*.dmg
            artifacts/*.zip
            artifacts/*.AppImage
            artifacts/*.deb
            artifacts/*.rpm
            artifacts/*.exe
            artifacts/*.blockmap
            artifacts/latest.yml
            artifacts/latest-linux.yml
            artifacts/latest-mac.yml
```

### Task 17: Validate workflow syntax and commit

- [ ] **Step 1: Verify YAML parses**

Run: `python3 -c "import yaml; d = yaml.safe_load(open('.github/workflows/release.yml')); print('jobs:', list(d['jobs'].keys()))"`

Expected output: `jobs: ['prepare', 'release_mac', 'release_linux', 'release_windows', 'generate_winget', 'publish']`

If not, the YAML has a structural issue — open it and verify indentation.

- [ ] **Step 2 (optional): Run actionlint if installed**

Run: `command -v actionlint && actionlint .github/workflows/release.yml || echo "actionlint not installed, skipping"`

Expected: either no output (lint clean) or "actionlint not installed, skipping". A real lint error must be fixed before commit.

- [ ] **Step 3: Commit**

Run:
```bash
git add .github/workflows/release.yml
git status
git commit -m "ci: build Windows NSIS, Fedora RPM, and winget manifests in release workflow"
```

Expected: 1 commit, 1 file changed. Working tree clean.

---

## Phase 4: Documentation

### Task 18: Update README install section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the platform table and add notes**

Locate the current Install section (lines ~22-37):

```markdown
## Install

Download the latest build from the [Releases](https://github.com/fathah/hermes-desktop/releases/) page.

| Platform | File                  |
| -------- | --------------------- |
| macOS    | `.dmg`                |
| Linux    | `.AppImage` or `.deb` |

> **macOS users:** The app is not code-signed or notarized. macOS will block it on first launch. To fix this, run the following after installing:
>
> ```bash
> xattr -cr "/Applications/Hermes Agent.app"
> ```
>
> Or right-click the app → **Open** → click **Open** in the confirmation dialog.
```

Replace the table and add a Linux/Windows notes block. The new section:

```markdown
## Install

Download the latest build from the [Releases](https://github.com/fathah/hermes-desktop/releases/) page.

| Platform        | File                              |
| --------------- | --------------------------------- |
| macOS           | `.dmg`                            |
| Linux (any)     | `.AppImage`                       |
| Linux (Debian)  | `.deb`                            |
| Linux (Fedora)  | `.rpm`                            |
| Windows         | `.exe` (NSIS installer)           |

### Windows (winget)

Once the manifest has been accepted into [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs), you can install with:

```powershell
winget install NousResearch.HermesDesktop
```

Until then, download the `.exe` from the Releases page.

> **Windows users:** The installer is not code-signed. Windows SmartScreen will warn on first launch — click "More info" → "Run anyway".

### Fedora (RPM)

```bash
sudo dnf install ./hermes-desktop-<version>.rpm
```

> **Fedora users:** The `.rpm` is not GPG-signed. If your system enforces signature checking, append `--nogpgcheck` to the install command. Auto-update is not supported for `.rpm` builds (limitation of `electron-updater`); reinstall the new `.rpm` to update.

### macOS

> **macOS users:** The app is not code-signed or notarized. macOS will block it on first launch. To fix this, run the following after installing:
>
> ```bash
> xattr -cr "/Applications/Hermes Agent.app"
> ```
>
> Or right-click the app → **Open** → click **Open** in the confirmation dialog.
```

- [ ] **Step 2: Verify the markdown renders sensibly**

Open `README.md` and skim the new Install section. Confirm: table is well-formed, code fences close, no leftover duplicate headings.

### Task 19: Commit README

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add README.md
git status
git commit -m "docs: document Windows (winget) and Fedora (RPM) install paths"
```

Expected: 1 commit, 1 file changed.

---

## Phase 5: Local verification gate

### Task 20: Run full local verification

This is the gate before pushing. **All must pass.** If any fails, fix the underlying issue and re-run; do not proceed.

- [ ] **Step 1: Lint**

Run: `npm run lint`

Expected: exits 0 with no errors.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: exits 0 with no errors. Both `tsconfig.node.json` and `tsconfig.web.json` checks succeed.

- [ ] **Step 3: Tests**

Run: `npm run test`

Expected: all tests pass, including the four new `winget-generator` tests. Total count = previous total + 4.

- [ ] **Step 4: Confirm working tree clean**

Run: `git status`

Expected: `nothing to commit, working tree clean`.

---

## Phase 6: CI verification on the fork

### Task 21: Push branch to Aiacos fork

This step requires push access to `Aiacos/hermes-desktop` (the user's fork). If pushing requires interactive auth, the human operator runs the command.

- [ ] **Step 1: Push**

Run: `git push -u origin feat/winget-rpm-release`

Expected: branch created on `origin` (which is `Aiacos/hermes-desktop` per `git remote -v`), tracking set up.

If push is rejected, resolve auth (e.g., `gh auth login` or SSH key) before retrying. Do not force-push.

### Task 22: Trigger workflow_dispatch with dry_run=true and observe CI

- [ ] **Step 1: Trigger via gh CLI**

Run: `gh workflow run release.yml --ref feat/winget-rpm-release -f dry_run=true`

Expected: `gh` confirms the workflow was queued. (Alternative: trigger from the GitHub Actions UI on the `Release` workflow → Run workflow → branch `feat/winget-rpm-release` → leave dry_run checked.)

- [ ] **Step 2: Watch the run**

Run: `gh run watch` (or `gh run list --workflow=release.yml --branch=feat/winget-rpm-release --limit 1` then `gh run view <id> --log-failed` if it fails)

Expected progression:
- `prepare` ✓ (~30s)
- `release_mac` x64 + arm64 ✓ (~10-15min in parallel)
- `release_linux` ✓ (~5-8min)
- `release_windows` ✓ (~8-12min)
- `generate_winget` ✓ (~30s, depends on `release_windows`)
- `publish` is **skipped** (status: `skipped`, not `failed`)

Total wall-clock: ~15-20min (mac arm64 is usually the longest pole).

- [ ] **Step 3: If any job fails**

Read the failure with `gh run view <id> --log-failed`. Most likely failure modes:
- Windows job: `npm ci` fails on a native dep (better-sqlite3 needing windows-build-tools). Solution: add `npm config set msvs_version 2022` step or rely on electron-builder's own `install-app-deps`.
- Linux rpm job: `rpmbuild` missing a dep. Solution: ensure `rpm` and possibly `rpm-build` are both apt-installed.
- generate_winget: script error. Most likely a path mismatch — confirm artifact downloaded to `dist/`.

Fix the issue, commit on the branch, push, and re-trigger. Do not proceed to PR until the dispatch succeeds end-to-end with `publish` skipped.

### Task 23: Inspect the winget manifests artifact

- [ ] **Step 1: Download the artifact**

Run: `gh run download <run-id> -n winget-manifests-0.2.3 -D /tmp/winget-check && ls -la /tmp/winget-check/manifests/n/NousResearch/HermesDesktop/0.2.3/`

(Replace `0.2.3` with the actual `version` from `package.json` if it changed.)

Expected: three `.yaml` files listed.

- [ ] **Step 2: Visually inspect**

Run: `cat /tmp/winget-check/manifests/n/NousResearch/HermesDesktop/0.2.3/*.yaml`

Expected:
- No `{{...}}` placeholders left.
- `InstallerSha256` is a 64-character uppercase hex string.
- `InstallerUrl` points to the `fathah/hermes-desktop` releases path with the correct version.
- `ReleaseDate` is today's date (UTC) in `YYYY-MM-DD`.
- `PackageVersion` matches `package.json`.

If any field looks wrong, fix the generator or templates, commit, re-push, re-trigger.

- [ ] **Step 3: Cleanup**

Run: `rm -rf /tmp/winget-check`

---

## Phase 7: Open PR upstream

### Task 24: Open PR to `fathah/hermes-desktop:main`

This is a "shared state" action visible to others. The human operator confirms before running.

- [ ] **Step 1: Confirm PR target with the user**

Ask the user: "Ready to open the PR from `Aiacos:feat/winget-rpm-release` to `fathah/hermes-desktop:main`? Or do you want to review the diff one more time first?"

Wait for explicit confirmation.

- [ ] **Step 2: Create the PR via gh**

Run:
```bash
gh pr create \
  --repo fathah/hermes-desktop \
  --base main \
  --head Aiacos:feat/winget-rpm-release \
  --title "ci: add Windows (winget) and Fedora (RPM) release artifacts" \
  --body "$(cat <<'EOF'
## Summary

- Adds a `release_windows` job that builds an NSIS installer (`hermes-desktop-<version>-setup.exe`) on `windows-latest`.
- Adds a `generate_winget` job that fills YAML manifest templates (`build/winget/*.template.yaml`) with the installer SHA256 and uploads them as the `winget-manifests-<version>` CI artifact, ready for manual submission to [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs).
- Extends the existing `release_linux` job to also build an `.rpm` for Fedora alongside the existing `.AppImage` and `.deb`.
- Adds explicit `oneClick: true` / `perMachine: false` to NSIS (matches electron-builder defaults; pinning prevents future drift) and Linux packaging metadata (`vendor`, `synopsis`, `description`).
- Adds a `dry_run` boolean input to `workflow_dispatch` (default `true`) so the workflow can be tested on a branch without creating tags or releases. Real releases (push to `release` branch) are unaffected.

The winget manifests are deliberately **not** included in the GitHub Release files (operator-facing, not user-facing). To publish to winget, download the `winget-manifests-<version>` artifact from the release run and submit a PR to `microsoft/winget-pkgs`.

Spec: `docs/superpowers/specs/2026-04-30-windows-winget-fedora-rpm-release-design.md`
Plan: `docs/superpowers/plans/2026-04-30-windows-winget-fedora-rpm-release.md`

## Verification

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test` (4 new tests for the manifest generator)
- [x] `npm run build:rpm` produces a valid `.rpm` on Fedora
- [x] `workflow_dispatch` with `dry_run=true` on the fork: all build jobs succeed, `publish` skipped as expected
- [x] Generated winget manifests inspected: no leftover placeholders, valid SHA256, correct URLs

## Notes for the maintainer

- **No code-signing introduced.** Windows SmartScreen will warn on first install; Fedora `dnf` will warn on unsigned RPM. Adding signing is out of scope for this PR (would require certificates / GPG keys in repo secrets).
- **No auto-submit to winget-pkgs.** That would need a GitHub PAT in upstream secrets; the manual submit flow is one `cp -r` from the artifact directory.
- **Fedora `.rpm` does not auto-update** (electron-updater limitation). Documented in README.

## Test plan

- [ ] Maintainer pushes a real release (push to `release` branch); confirms all six jobs run and `publish` produces a GitHub Release with `.exe`, `.rpm`, `.deb`, `.AppImage`, `.dmg`, `.zip`.
- [ ] Maintainer downloads `winget-manifests-<version>` artifact and (optionally) submits to `microsoft/winget-pkgs`.
EOF
)"
```

Expected: `gh` returns the PR URL. Print it back to the user.

- [ ] **Step 3: Print the PR URL**

Done.

---

## Self-review checklist (executed before saving)

**Spec coverage:**
- ✅ Windows NSIS build → Tasks 14, 17
- ✅ Winget manifest generation → Tasks 6, 7, 9, 11, 15
- ✅ Fedora RPM in CI → Task 13
- ✅ Local rpm sanity-check → Task 4
- ✅ `dry_run` workflow_dispatch input → Task 12
- ✅ `publish` gated on `is_dry_run` → Task 16
- ✅ Explicit gh-release files list (replaces `artifacts/*` glob) → Task 16
- ✅ Linux metadata (vendor/synopsis/description) → Task 1
- ✅ Explicit NSIS oneClick/perMachine → Task 2
- ✅ README updates for Windows + Fedora install → Task 18
- ✅ Local verification (lint/typecheck/test) → Task 20
- ✅ CI verification on fork → Tasks 21–23
- ✅ Open PR upstream → Task 24

**Placeholder scan:** No "TBD" or "fill in details" left. The generated PR body in Task 24 has a "Test plan" with unchecked boxes — that is intentional, those are TODOs for the *maintainer*, not for the implementer.

**Type/name consistency:**
- `generateWingetManifests({ rootDir, version, name, publishOwner })` — same signature in test (Task 7), implementation (Task 9), and CLI entrypoint.
- `winget-manifests-${{ needs.prepare.outputs.version }}` — same artifact name in `generate_winget` job (Task 15) and in the CI inspection step (Task 23).
- `is_dry_run` output — defined in Task 12, consumed in Task 16.
- `publishOwner: "fathah"` — same in workflow env (Task 15) and CLI default (Task 9).
