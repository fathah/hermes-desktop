# Windows (winget) and Fedora (RPM) release automation

**Status:** Approved (brainstorming) — pending implementation plan
**Date:** 2026-04-30
**Branch target:** `Aiacos/hermes-desktop:feat/winget-rpm-release` → PR upstream `fathah/hermes-desktop:main`

## Goal

Extend the existing release pipeline so it produces:

1. **Windows artifacts** — an NSIS installer (`.exe`) published in each GitHub Release, plus winget manifests (`Installer.yaml`, `Locale.en-US.yaml`, `Version.yaml`) generated as a CI artifact for manual submission to `microsoft/winget-pkgs`.
2. **Fedora artifacts** — an unsigned `.rpm` published in each GitHub Release, alongside the existing `.AppImage` and `.deb`.

No changes to macOS. The existing `.AppImage` / `.deb` artifacts are rebuilt by the same job that now also produces `.rpm`; the only adjacent change touching them is shared `linux.*` metadata (`synopsis`, `description`, `vendor`) which improves their packaging metadata too. No code-signing introduced (none available). No COPR repository, no auto-submission to `microsoft/winget-pkgs`.

## Non-goals

- Code signing for Windows (no certificate available; SmartScreen warning persists).
- macOS notarization changes.
- GPG-signing the RPM (no signing key available; users install with `sudo dnf install ./file.rpm` or `--nogpgcheck`).
- A Fedora COPR repository.
- Automated PR submission to `microsoft/winget-pkgs` (would require a GitHub PAT in upstream secrets, which the PR author does not control).
- Auto-update support for `.rpm` (limitation of `electron-updater`).
- Windows ARM64 build (requires extra toolchain; nobody is testing it).

## Architecture

The existing `release.yml` workflow is extended in place. Two new jobs are added; one existing job is extended; a `dry_run` input is added to the manual-dispatch trigger.

```
release.yml (extended)
├─ prepare              [ubuntu]   unchanged + new is_dry_run output
├─ release_mac          [macos]    unchanged
├─ release_linux        [ubuntu]   ADD: rpm to electron-builder targets, install rpm apt package
├─ release_windows      [windows]  NEW: NSIS .exe + .blockmap + latest.yml
├─ generate_winget      [ubuntu]   NEW: SHA256 the .exe, fill manifest templates, upload as artifact
└─ publish              [ubuntu]   gated: skip if is_dry_run == 'true'
```

### Triggers

- `push` to branch `release` — unchanged. Behaves as a real release: builds run, publish runs.
- `workflow_dispatch` — adds `inputs.dry_run` (boolean, default `true`). When `dry_run=true`, all build jobs run; `publish` is skipped.

The default-true on dispatch is a safety net: a stray click in the Actions UI cannot trigger a real release.

### Identifiers and naming

- **Winget `PackageIdentifier`:** `NousResearch.HermesDesktop` (stable, never renamed)
- **Winget `Publisher`:** `Nous Research` (free-text; binaries hosted under `fathah/hermes-desktop`, which the moderation review will verify against the `InstallerUrl`)
- **Winget `PackageName`:** `Hermes Agent` (matches `productName` in `electron-builder.yml`)
- **NSIS scope:** `oneClick: true`, `perMachine: false` — installs into `%LOCALAPPDATA%`, no UAC prompt, aligns with `winget install` default user scope and with the app's existing `~/.hermes` user-state model.
- **RPM artifact name:** `hermes-desktop-<version>.rpm` (no spaces, no arch suffix — consistent with the existing `.deb` and `.AppImage` naming. The default `${productName}` would produce `Hermes Agent-...rpm` which breaks `dnf install ./file.rpm`. We explicitly only build `x86_64`, so the missing arch suffix is unambiguous in practice.).

## File changes

### Modified

#### `.github/workflows/release.yml` (~+120 / -10 lines)

- Add `workflow_dispatch.inputs.dry_run` (boolean, default `true`).
- Add `prepare.outputs.is_dry_run` computed as `${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}` (string `'true'`/`'false'`).
- Add new job `release_windows`:
  - `runs-on: windows-latest`
  - `needs: prepare`
  - `if: needs.prepare.outputs.tag_exists == 'false'`
  - Steps: checkout, setup-node 22 with `cache: npm`, `npm ci`, `npm run build`, `npx electron-builder --win nsis --x64 --publish never`, upload `dist/*.exe`, `dist/*.exe.blockmap`, `dist/latest.yml` as artifact `windows-artifacts`.
- Modify existing `release_linux`:
  - Add `sudo apt-get update && sudo apt-get install -y rpm` step before packaging.
  - Change packaging command to `npx electron-builder --linux AppImage deb rpm --publish never`.
  - Extend artifact upload paths to include `dist/*.rpm`.
- Add new job `generate_winget`:
  - `runs-on: ubuntu-latest`
  - `needs: [prepare, release_windows]`
  - `if: needs.prepare.outputs.tag_exists == 'false'`
  - Steps: checkout, download `windows-artifacts` to `dist/`, run `node scripts/generate-winget-manifests.mjs` with env `VERSION` and `PUBLISH_OWNER=fathah`, upload `dist/winget/` as artifact `winget-manifests-${{ needs.prepare.outputs.version }}`.
- Modify `publish`:
  - `needs: [prepare, release_mac, release_linux, release_windows, generate_winget]`
  - `if: needs.prepare.outputs.is_dry_run == 'false' && needs.prepare.outputs.tag_exists == 'false'`
  - `download-artifact` step keeps `merge-multiple: true` and downloads into `artifacts/`. The winget manifests artifact ends up under `artifacts/winget/manifests/...` and is **deliberately excluded** from the GitHub Release files (manifests are operator-facing, not user-facing).
  - The `softprops/action-gh-release` `files` input is changed from the existing `artifacts/*` glob to an **explicit list of patterns** that names each user-facing artifact: `artifacts/*.dmg`, `artifacts/*.zip`, `artifacts/*.AppImage`, `artifacts/*.deb`, `artifacts/*.rpm`, `artifacts/*.exe`, `artifacts/*.blockmap`, `artifacts/latest*.yml`. This is deterministic regardless of how `merge-multiple` lays out subdirectories, and prevents future artifacts from leaking into releases by accident.

Concurrency block (`group: release`, `cancel-in-progress: true`) remains unchanged. **Caveat (pre-existing, not introduced by this change):** with `cancel-in-progress: true`, a *new* run cancels the *currently running* one in the same group. So a stray `workflow_dispatch` triggered during a real release would cancel the release. This risk is low (dispatches are manual; the dispatch defaults to `dry_run=true` which would not produce a tag anyway, but the cancellation of the in-flight real release is the actual hazard). Not addressed here to keep scope focused; flagged for a follow-up that scopes the concurrency group by `github.event_name`.

#### `electron-builder.yml` (~+15 lines)

- `linux.target`: add `rpm` (existing `AppImage`, `snap`, `deb` retained).
- `linux.synopsis`: short one-line description (required by fpm/rpmbuild for valid RPM metadata).
- `linux.description`: longer description.
- `linux.vendor`: `Nous Research` (or repo owner of upstream; finalized during implementation).
- New `rpm:` block with `artifactName: ${name}-${version}.${ext}`.
- `nsis:` block extended with explicit `oneClick: true` and `perMachine: false` (currently relies on electron-builder defaults; making them explicit prevents silent behavior change across electron-builder versions).

### New

#### `build/winget/Installer.template.yaml`

YAML manifest with placeholders: `{{VERSION}}`, `{{INSTALLER_URL}}`, `{{INSTALLER_SHA256}}`, `{{RELEASE_DATE}}`. Format follows winget v1.6 schema, `InstallerType: nullsoft`, `Scope: user`, `MinimumOSVersion: 10.0.17763.0` (Windows 10 1809 — minimum supported by Electron 39).

#### `build/winget/Locale.en-US.template.yaml`

Locale manifest with placeholders: `{{VERSION}}`, `{{RELEASE_NOTES_URL}}`. Includes `Publisher: Nous Research`, `PublisherUrl: https://github.com/fathah/hermes-desktop`, `PackageName: Hermes Agent`, `License: MIT`, `LicenseUrl: https://github.com/fathah/hermes-desktop/blob/main/LICENSE`, `ShortDescription`, `Tags: [ai, agent, desktop, electron, llm]`.

#### `build/winget/Version.template.yaml`

Root version manifest with placeholders: `{{VERSION}}`. Trivial: `PackageIdentifier`, `PackageVersion`, `DefaultLocale: en-US`, `ManifestType: version`, `ManifestVersion: 1.6.0`.

#### `scripts/generate-winget-manifests.mjs`

Node ESM script (~50 lines, zero external deps). Reads `package.json` to get `version` and `name`. Locates `dist/<name>-<version>-setup.exe`. Computes SHA256 with `node:crypto` `createHash('sha256')` over the file. Reads each `*.template.yaml` from `build/winget/`. Replaces all `{{KEY}}` placeholders by string `replaceAll`. Writes output to `dist/winget/manifests/n/NousResearch/HermesDesktop/<version>/`:

- `NousResearch.HermesDesktop.installer.yaml`
- `NousResearch.HermesDesktop.locale.en-US.yaml`
- `NousResearch.HermesDesktop.yaml`

The path mirrors the directory layout in `microsoft/winget-pkgs`, so the operator submitting the PR can `cp -r` directly.

Exit code 1 with explicit error if the `.exe` is not found.

#### `package.json`

Add script `"build:rpm": "npm run build && electron-builder --linux rpm"` for local Fedora developers. CI does not use this script (it calls `npx electron-builder` directly).

#### `README.md`

Update the Install section's platform table to add Windows (`.exe` and, once accepted into winget-pkgs, `winget install NousResearch.HermesDesktop`) and Fedora (`.rpm`). Add a note that:

- The Windows build is unsigned; Windows SmartScreen will warn on first launch.
- The `.rpm` is unsigned; install with `sudo dnf install ./hermes-desktop-<version>.x86_64.rpm` (or use `--nogpgcheck` if a system policy enforces signature checking).
- Auto-update on Linux is supported only for `.AppImage` builds; `.rpm` and `.deb` users must download new releases manually.

## Data flow

### CI build (Windows)

```
checkout
  → npm ci                  → node_modules + electron-builder install-app-deps
  → npm run build           → out/main + out/preload + out/renderer
  → electron-builder --win nsis --x64
                            → dist/hermes-desktop-<version>-setup.exe
                            → dist/hermes-desktop-<version>-setup.exe.blockmap
                            → dist/latest.yml
  → upload-artifact "windows-artifacts"
```

### CI generate winget manifests

```
download-artifact "windows-artifacts" → dist/
node scripts/generate-winget-manifests.mjs
  → SHA256(dist/hermes-desktop-<version>-setup.exe)
  → fill 3 templates with VERSION, INSTALLER_URL, INSTALLER_SHA256, RELEASE_DATE
  → write dist/winget/manifests/n/NousResearch/HermesDesktop/<version>/*.yaml
upload-artifact "winget-manifests-<version>"
```

### CI build (Linux)

```
checkout
  → npm ci
  → npm run build
  → apt install rpm
  → electron-builder --linux AppImage deb rpm
                            → dist/hermes-desktop-<version>.AppImage
                            → dist/hermes-desktop-<version>.deb
                            → dist/hermes-desktop-<version>.x86_64.rpm
                            → dist/latest-linux.yml
  → upload-artifact "linux-artifacts"
```

### Publish (only on real release)

```
download-artifact merge-multiple=true → artifacts/
  *.dmg, *.zip, *.AppImage, *.deb, *.rpm, *.exe, *.blockmap, latest-*.yml, latest.yml
  + artifacts/winget/manifests/... (excluded from release files glob)
git tag v<version> + push
softprops/action-gh-release files=artifacts/* (excludes winget/ subdir)
```

## Error handling and edge cases

1. **Missing NSIS installer in `generate_winget` job:** The script exits with code 1 and a clear message. Failure is loud, not silent.
2. **`rpm` package missing on Linux runner:** electron-builder fails with a clear "Cannot find rpmbuild" error. We pre-install via apt, so this should not surface.
3. **Tag already exists:** All build jobs gate on `tag_exists == 'false'`; new jobs replicate this guard.
4. **Concurrency cancellation (pre-existing behavior):** With `cancel-in-progress: true`, a new run in the same group cancels the currently running one. A stray dispatch during a real release would cancel the release. Mitigation: dispatches are manual and rare; the safer fix (per-event-type concurrency group) is intentionally out of scope here.
5. **`workflow_dispatch` on a branch other than `release`:** Allowed and intended — that is how E2 verification works. The `prepare` step still reads version from `package.json`, so it builds whatever version is on the branch. Real releases only happen on `release` branch (no `is_dry_run` short-circuit there because `is_dry_run` is `false` for push events by definition).
6. **Operator submits stale manifests:** The CI artifact name includes the version (`winget-manifests-<version>`), so it cannot be confused with a different release's manifests. The operator copies the directory wholesale into their `microsoft/winget-pkgs` clone.
7. **Manifest schema validation:** Validated by the `microsoft/winget-pkgs` moderation bot at PR-submission time. Common failure modes (missing `MinimumOSVersion`, invalid `License`, mismatched `InstallerType`) are addressed up front in the templates.

## Verification plan

### Local

1. Create branch `feat/winget-rpm-release`.
2. Apply all file changes.
3. `npm run lint`
4. `npm run typecheck`
5. `npm run test`
6. `npm run build:rpm` — produces a real `.rpm` on this Fedora host (sanity-checks the new electron-builder rpm target).
7. `node scripts/generate-winget-manifests.mjs` against a placeholder `dist/<name>-<version>-setup.exe` (created via `dd if=/dev/urandom of=dist/... bs=1M count=1` to provide arbitrary content) — verifies that the generator produces three valid YAML files with consistent placeholders replaced.
8. (Optional) `actionlint .github/workflows/release.yml` if installed.

### CI on fork

9. Push `feat/winget-rpm-release` to `Aiacos/hermes-desktop`.
10. Trigger `workflow_dispatch` from the Actions UI on `feat/winget-rpm-release` with `dry_run=true`.
11. Verify all build jobs succeed:
    - `prepare` ✓
    - `release_mac` (x64 + arm64) ✓
    - `release_linux` (with `.rpm`) ✓
    - `release_windows` ✓
    - `generate_winget` ✓
    - `publish` SKIPPED (status: skipped, not failed)
12. Download the `winget-manifests-<version>` artifact and inspect the three YAML files for correctness (URL, SHA256, version, no leftover placeholders).

### PR

13. Open PR `Aiacos:feat/winget-rpm-release` → `fathah:main`. PR description summarizes what was added, the verification done, and the manual steps the maintainer has to take post-merge to actually publish to winget (download manifest artifact from the first real release run, submit to `microsoft/winget-pkgs`).

## Open questions deferred to implementation

- Exact wording of `linux.synopsis` and `linux.description` (will follow `package.json.description` style).
- Final value of `linux.vendor` (`Nous Research` vs `fathah`).
- Whether to include `manifestVersion: 1.10.0` (current latest) or stick with `1.6.0` (more compatible with older `winget` clients). Default to `1.6.0` unless implementation reveals required fields.

## Out-of-scope follow-ups (future PRs, if desired)

- Auto-submit winget PR via `vedantmgoyal2009/winget-releaser` action (requires GitHub PAT in upstream secrets).
- Fedora COPR repository for `dnf install` integration.
- GPG-signing the RPM.
- Windows code signing.
- Windows ARM64 build.
