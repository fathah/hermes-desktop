# Desktop Updates

Desktop updates use GitHub releases and expose both a startup upgrade action and a Settings auto-upgrade preference.

The Electron main process configures `electron-updater` against the repository publisher metadata from `electron-builder.yml`, which points at `fathah/hermes-desktop`. [[src/main/app/updater.ts#setupUpdater]] registers update IPC handlers, persists the auto-upgrade preference under Electron `userData`, and applies that preference to `autoUpdater.autoDownload`.

When GitHub reports a newer release, [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] shows an upgrade button in the sidebar footer as soon as the app reaches the main layout. The button downloads the update when needed, shows download progress, and changes into a restart action after the update is ready.

[[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] (the About & Updates pane of the settings modal) presents the desktop app as its own card, separate from the Hermes Agent engine card — the two update on independent channels. The card shows the app version, the auto-upgrade toggle, and an explicit update action: [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]] subscribes to the same `onUpdateAvailable`/`onUpdateDownloadProgress`/`onUpdateDownloaded`/`onUpdateError` events as the footer button and adds a manual `checkDesktopUpdate` (via `checkForUpdates`) plus a `handleDesktopUpdate` that downloads, then restarts via `installUpdate`. When auto-upgrade is enabled the startup release check downloads automatically; when disabled, downloading waits for the user's click (footer button or this card's action).

## Stable and beta release channels

Two GitHub Actions workflows publish builds; only the stable channel reaches end users' auto-update, so a beta can be tested without risking their devices.

`release.yml` (stable) runs on a push to the `release` branch: it tags `v<version>` from `package.json`, builds all platforms, and publishes a normal GitHub Release carrying the `latest*.yml` update feed. `beta-release.yml` runs on a push to `beta` (or manual dispatch): it stamps a prerelease version `v<version>-beta.<run>` via `scripts/set-version.mjs`, builds the same signed/notarized artifacts, and publishes a **GitHub prerelease** carrying a `beta*.yml` feed.

Linux AppImage names include `${arch}` between version and extension, so x64 and arm64 outputs can coexist without overwriting one another. Stable and beta arm64 jobs also publish their architecture-specific updater feed (`latest-linux-arm64.yml` or `beta-linux-arm64.yml`) beside the installer. [[tests/release-artifacts.test.ts]] locks both invariants.

The isolation is structural: the updater ([[src/main/app/updater.ts#setupUpdater]]) leaves `allowPrerelease` off, so electron-updater's GitHub provider only ever resolves the latest **non-prerelease** release's `latest.yml`. A beta prerelease is therefore invisible to stable clients — testers download the beta installer manually from the prerelease. The beta workflow skips winget + the landing-page rebuild and uses a separate `beta-release` concurrency group so it never cancels a stable release. Cutting a beta for the _next_ version requires bumping `package.json` first (a beta of an already-released version sorts lower than its stable tag).

### Release security and quality gates

Pull requests and main-branch pushes must have no lint warnings and no high-severity production dependency advisories before release work can proceed.

The CI workflow installs the locked dependency tree, runs `npm run audit:prod`, type-checks, tests, and treats lint as blocking. The audit wrapper retries only transient registry/network failures; a reported high-severity vulnerability still fails immediately. The install step fetches the pinned Electron runtime once before tests, and the suite uses four workers so parallel imports never race a lazy binary download or starve short tests. [[tests/audit-production-dependencies.test.ts]] covers retry classification, while [[tests/release-artifacts.test.ts]] protects these controls, the audit threshold, and the zero-warning lint policy from accidental removal.

#### Transient audit outages

The production audit retries temporary npm registry and network failures without weakening vulnerability enforcement.

HTTP 5xx responses, DNS failures, resets, timeouts, and unreachable-registry errors receive up to three attempts with short backoff. Audit findings are not classified as transient and fail on the first attempt. `scripts/audit-production-dependencies.mjs` implements the classification boundary.

### macOS signing keychain

Stable and beta release jobs import the Developer ID certificate into a workflow-owned temporary keychain before packaging, making signing reliable across GitHub runner updates.

`scripts/import-macos-certificate.sh` creates a random keychain password, adds the keychain to the user search list, imports the `.p12` with `CSC_KEY_PASSWORD`, and grants `codesign` access with the distinct keychain password required by macOS 26.6. Electron Builder receives only `CSC_KEYCHAIN`, so it cannot recreate the password mix-up. Both architecture jobs run even if one fails, verify that a Developer ID Application identity exists before packaging, and delete the temporary keychain afterward. [[tests/macos-signing.test.ts]] exercises keychain discovery, password separation, and credential cleanup; [[tests/release-artifacts.test.ts]] prevents either release channel from bypassing the staging flow.

### Native module packaging

Stable and beta macOS builds verify the exact architecture-specific `better-sqlite3` prebuild that the packaged runtime loads.

Electron Builder explicitly unpacks `node_modules/better-sqlite3/prebuilds/*.node` from ASAR. After signing and notarization, `scripts/verify-native-module-architecture.sh` locates `darwin-x64.node` or `darwin-arm64.node` inside the packaged app and rejects a missing or mismatched binary. [[tests/release-artifacts.test.ts]] keeps the package rule and both release workflows aligned with the dependency's runtime layout.
