<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# build

## Purpose

Packaging assets consumed by `electron-builder` and the release workflow. Holds platform icons, mac entitlements, the `afterPack` hook, and winget manifest templates.

## Key Files

| File | Description |
|------|-------------|
| `afterPack.js` | electron-builder `afterPack` hook — runs after each platform package is assembled |
| `icon.icns` | macOS app icon (815 KB) |
| `icon.ico` | Windows app icon (68 KB) |
| `icon.png` | Linux app icon (180 KB) |
| `entitlements.mac.plist` | macOS hardened-runtime entitlements |
| `entitlements.mac.inherit.plist` | Entitlements inherited by helper processes |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `winget/` | Microsoft winget manifest templates (Installer / Locale / Version YAML) used by `scripts/generate-winget-manifests.mjs` |

## For AI Agents

### Working In This Directory

- Icons here are the **shipped** assets. Source icons live elsewhere; do not edit `.icns` / `.ico` / `.png` directly without regenerating from a master.
- `afterPack.js` runs once per platform per build — keep it idempotent and fast. It is a Node CommonJS module.
- macOS entitlements changes require re-notarization. Do not weaken these without explicit approval — they gate the hardened runtime build.
- The winget templates are interpolated by `scripts/generate-winget-manifests.mjs`; placeholder format must stay in sync with that script.

### Testing Requirements

- `tests/winget-generator.test.ts` validates that template substitution still produces valid manifests.
- No unit tests for `afterPack.js` itself — manually verify by running `npm run build:unpack` and inspecting the output.

### Common Patterns

- electron-builder reads `electron-builder.yml` at the repo root, which references this directory via `directories.buildResources: build`.

## Dependencies

### Internal

- `electron-builder.yml` (repo root) — declares `buildResources: build`
- `scripts/generate-winget-manifests.mjs` — consumes `winget/*.template.yaml`
- `package.json` — version field is interpolated into winget manifests

### External

- electron-builder

<!-- MANUAL: -->
