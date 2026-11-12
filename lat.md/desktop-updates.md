# Desktop Updates

Desktop updates use GitHub releases and expose both a startup upgrade action and a Settings auto-upgrade preference.

The Electron main process configures `electron-updater` against the repository publisher metadata from `electron-builder.yml`, which points at `fathah/hermes-desktop`. [[src/main/app/updater.ts#setupUpdater]] registers update IPC handlers, persists the auto-upgrade preference under Electron `userData`, and applies that preference to `autoUpdater.autoDownload`.

When GitHub reports a newer release, [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] shows an upgrade button in the sidebar footer as soon as the app reaches the main layout. The button downloads the update when needed, shows download progress, and changes into a restart action after the update is ready.

[[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] (the About & Updates pane of the settings modal) presents the desktop app as its own card, separate from the Hermes Agent engine card — the two update on independent channels. The card shows the app version, the auto-upgrade toggle, and an explicit update action: [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]] subscribes to the same `onUpdateAvailable`/`onUpdateDownloadProgress`/`onUpdateDownloaded`/`onUpdateError` events as the footer button and adds a manual `checkDesktopUpdate` (via `checkForUpdates`) plus a `handleDesktopUpdate` that downloads, then restarts via `installUpdate`. When auto-upgrade is enabled the startup release check downloads automatically; when disabled, downloading waits for the user's click (footer button or this card's action).

## Desktop installation channel

Desktop users install release downloads. npm commands apply to source dependencies and development, rather than a supported desktop app package installed from the registry.

[README](../README.md) directs users to the project download site or GitHub Releases and distinguishes them from the source-checkout commands in the [Contributing Guide](../CONTRIBUTING.md). The README promises the guide's existing dependency and development commands (`npm install`, `npm run dev`), without implying the guide also documents source builds. The package name in `package.json` is build metadata, not an app installation command. Release workflows and `electron-builder.yml` remain the distribution source of truth.

## Progress evidence

Desktop downloads preserve measured bytes, speed and fractional percent. Unknown totals and inactive progress remain explicit rather than appearing as a frozen zero-percent download.

[[src/main/app/updater.ts#setupUpdater]] forwards finite nonnegative metrics through [[src/shared/update-progress.ts#measuredDownloadProgress]]. Percent requires a known positive total; unknown totals omit it. About and the sidebar share [[src/renderer/src/components/common/useUpdateDownloadText.ts#useUpdateDownloadText]], with localized percent and byte formatting. Only `update-downloaded` enables the restart action.

A one-shot 15-second deadline is active only while downloading and resets when byte/percent/total measurements change. If no new measurement arrives, the display retains known bytes, hides stale speed and explicitly waits for progress. Completion, error and unmount clear the deadline; there is no idle polling.

This display does not prove differential downloads are used or reduce artifact size. Existing updater packaging and dependency strategies require separate release/runtime evidence before efficiency claims can be resolved.

### Measured download events

The actual updater registration receives synthetic download events and forwards fractional percent, bytes and speed without executing downloads or installations.

### Unknown totals do not imply completion

Invalid or unknown totals cannot produce measured percentages. Finite transferred bytes remain useful even when total size and speed are unavailable.

### Invalid percent remains unknown

A percentage outside the measured zero-to-one-hundred range remains unknown instead of being clamped into an apparently completed download.

### About download measurements

Actual About and Settings state retain byte totals and speed, show fractional progress and wait for the downloaded event before offering restart.

### Unknown and inactive download feedback

Unknown downloads omit fake zero-percent values. An inactive measurement triggers one waiting deadline, hides stale speed, retains bytes and recovers after progress resumes without persistent polling.

## Agent phases

Agent install and update steps describe subprocess phases, not measured work percentages. Running work stays indeterminate; successful IPC completion alone presents a completed result.

[[src/main/installer.ts#runHermesUpdate]] emits update-scoped output with unknown step totals while its command runs. [[src/main/ipc/register.ts#registerIpcHandlers]] announces real SSH update, compatibility, gateway, tunnel and connection-refresh operations before awaiting them. Local updates announce compatibility validation after the command exits.

Progress delivery is best effort. A closed or disappearing window cannot interrupt compatibility validation, gateway startup, tunnel reconnection or credential refresh. Delivery failures are isolated from real operation errors, which still fail the update result.

[[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]] owns an update-only progress subscription correlated with a fresh opaque request ID, rejects late profile or connection reads and releases its listener after completion or unmount. About shows the captured phase and detail. [[src/renderer/src/screens/Install/Install.tsx#Install]] keeps phase labels but presents no running percentage; only its successful result reaches 100 percent.

Phase visibility does not claim that upstream dependency work is incremental or optimized. Installer output remains diagnostic evidence, and the original efficiency reports need separate verification.

### About phase lifetime

About displays only the currently admitted Agent update phase, ignores migration events and clears its listener and phase after the result settles.

### Changed profile rejects old progress

Changing the About profile invalidates deferred update phases and results, so old success or failure cannot appear under the new profile.

### Changed connection rejects old progress

A same-ID connection reload clears the old phase and refuses its delayed callbacks and failure result without borrowing another target's progress.

### Unmount releases the progress listener

Closing About releases an active update listener immediately. A later subprocess result cannot register or release that listener a second time.

### Reopened pane rejects another update job

Reopening About settles its initial React/config commit before admitting a new update with a distinct real request ID. Old phases and results cannot replace the new job or release its listener.

The fixture awaits actual IPC admissions and listener registration instead of fabricating fallback IDs. An enabled version-cache button alone does not establish that React has committed its initial target-lifetime effect.

### Initial metadata preserves an admitted update

Deferred metadata from the current initial load preserves a cached-ready update and its listener. A later connection-config notification still revokes the old phase and result by starting a new config epoch.

### IPC echoes the update owner

The actual update handler echoes a caller's bounded request ID on command and validation events; legacy callers remain supported without an ID.

### Running phase is indeterminate

Actual Install fixtures keep both one-step updates and final installer phases indeterminate while pending, and present 100 percent only after successful completion.

### SSH phases follow operations

The actual update IPC handler emits each SSH phase before its operation and keeps the pending command's total unknown without executing remote updates in tests.

### Remote update refusal remains read-only

The direct Remote mode keeps its existing host-side update guidance and never starts a local or SSH update through the desktop.

### Closed windows do not interrupt SSH follow-up

Closing the window during each awaited SSH update stage skips later UI delivery while compatibility, gateway, tunnel and credential work completes normally.

### Progress delivery races are best effort

A sender that disappears between its live check and send cannot abort update follow-up. Only progress delivery exceptions are discarded.

### Closed windows do not interrupt Local validation

Local command output remains safe after its window closes, and the update still validates compatibility and clears capability evidence.

### Operation errors remain failures without a window

The actual update callback still reports a failing SSH operation when no progress receiver remains; it neither hides the error nor runs unsafe later stages.

### Local command is not measured progress

The actual local updater receives synthetic child output and exit events; running and failed commands never turn their phase into measured completion.

## Stable and beta release channels

Two GitHub Actions workflows publish builds; only the stable channel reaches end users' auto-update, so a beta can be tested without risking their devices.

`release.yml` (stable) runs on a push to the `release` branch: it tags `v<version>` from `package.json`, builds all platforms, and publishes a normal GitHub Release carrying the `latest*.yml` update feed. `beta-release.yml` runs on a push to `beta` (or manual dispatch): it stamps a prerelease version `v<version>-beta.<run>` via `scripts/set-version.mjs`, builds the same signed/notarized artifacts, and publishes a **GitHub prerelease** carrying a `beta*.yml` feed.

Linux AppImage names include `${arch}` between version and extension, so x64 and arm64 outputs can coexist without overwriting one another. Stable and beta arm64 jobs also publish their architecture-specific updater feed (`latest-linux-arm64.yml` or `beta-linux-arm64.yml`) beside the installer. [[tests/release-artifacts.test.ts]] locks both invariants.

The isolation is structural: the updater ([[src/main/app/updater.ts#setupUpdater]]) leaves `allowPrerelease` off, so electron-updater's GitHub provider only ever resolves the latest **non-prerelease** release's `latest.yml`. A beta prerelease is therefore invisible to stable clients — testers download the beta installer manually from the prerelease. The beta workflow skips winget + the landing-page rebuild and uses a separate `beta-release` concurrency group so it never cancels a stable release. Cutting a beta for the _next_ version requires bumping `package.json` first (a beta of an already-released version sorts lower than its stable tag).

### Release security and quality gates

Pull requests and main-branch pushes must have no lint warnings and no high-severity production dependency advisories before release work can proceed.

The CI workflow installs the locked dependency tree, runs `npm run audit:prod`, type-checks, tests, and treats lint as blocking. The audit wrapper retries only transient registry/network failures; a reported high-severity vulnerability still fails immediately. The install step fetches the pinned Electron runtime once before tests, and the suite uses four workers so parallel imports never race a lazy binary download or starve short tests. [[tests/audit-production-dependencies.test.ts]] covers retry classification, while [[tests/release-artifacts.test.ts]] protects these controls, the audit threshold, and the zero-warning lint policy from accidental removal.

#### Patched Electron dependency baseline

Electron stays on major 44 with a 44.9.3 minimum. The locked downloader uses undici 7.30.1; the development rebuild chain uses undici 6.29.1, retaining their existing compatible major versions.

The refresh addresses published [Electron certificate-trust](https://github.com/advisories/GHSA-jr5w-w6x2-84p9) and [undici parser](https://github.com/advisories/GHSA-4qv8-2p9j-2685) advisories without changing the audit threshold, retry policy or application configuration. Validate a clean locked install, production audit, Electron TLS runtime checks, typechecks, tests, lint and build before submitting dependency updates.

#### Transient audit outages

The production audit retries temporary npm registry and network failures without weakening vulnerability enforcement.

HTTP 5xx responses, DNS failures, resets, timeouts, and unreachable-registry errors receive up to three attempts with short backoff. Audit findings are not classified as transient and fail on the first attempt. `scripts/audit-production-dependencies.mjs` implements the classification boundary.

### macOS signing keychain

Stable and beta release jobs import the Developer ID certificate into a workflow-owned temporary keychain before packaging, making signing reliable across GitHub runner updates.

`scripts/import-macos-certificate.sh` creates a random keychain password, adds the keychain to the user search list, imports the `.p12` with `CSC_KEY_PASSWORD`, and grants `codesign` access with the distinct keychain password required by macOS 26.6. Electron Builder receives only `CSC_KEYCHAIN`, so it cannot recreate the password mix-up. Both architecture jobs run even if one fails, verify that a Developer ID Application identity exists before packaging, and delete the temporary keychain afterward. [[tests/macos-signing.test.ts]] exercises keychain discovery, password separation, and credential cleanup; [[tests/release-artifacts.test.ts]] prevents either release channel from bypassing the staging flow.

#### Identity output consumption

Signing verification consumes the complete identity list before deciding success, so early pipe closure cannot reject a valid Developer ID identity under `pipefail`.

`scripts/import-macos-certificate.sh` retains failure propagation from the identity command and requires a matching identity. [[tests/macos-signing.test.ts]] exercises short output and a list exceeding pipe capacity, alongside password separation and credential cleanup.

### Native module packaging

Stable and beta macOS builds verify the exact architecture-specific `better-sqlite3` prebuild that the packaged runtime loads.

Electron Builder explicitly unpacks `node_modules/better-sqlite3/prebuilds/*.node` from ASAR. After signing and notarization, `scripts/verify-native-module-architecture.sh` locates `darwin-x64.node` or `darwin-arm64.node` inside the packaged app and rejects a missing or mismatched binary. [[tests/release-artifacts.test.ts]] keeps the package rule and both release workflows aligned with the dependency's runtime layout.

### Platform package identity

Linux packages use the space-free `/opt/HermesOne` directory while macOS keeps the existing `Hermes One.app` bundle and executable name. RPM filenames retain the `.rpm` extension expected by release uploads.

The global packaging product name supplies Electron Builder's Linux install-directory component. The explicit macOS `executableName` preserves its bundle path, and platform display labels retain Hermes One. Linux package setup uses the builder's default hooks. [[tests/packaging-identity.test.ts]] validates the configuration with the installed Electron Builder schema and evaluates its real application metadata and artifact macros.

### Linux package sandbox and AppArmor

DEB and RPM packages use Electron Builder's complete default post-install hook so compatible AppArmor policy is installed alongside sandbox permissions and desktop integration.

The builder supplies `resources/apparmor-profile`, validates it against the installed parser, copies compatible policy into `/etc/apparmor.d/hermes-desktop`, and reloads it outside chroots. Disabled AppArmor and unsupported older parsers skip policy installation. Working user namespaces keep `chrome-sandbox` at 0755; other hosts use its SUID mode. The previous custom hook replaced this setup with an unconditional permission change and omitted policy installation.

[[tests/linux-post-install.test.ts]] generates the actual DEB/RPM scripts through the installed builder and executes them with temporary paths and harmless command fixtures. The POSIX execution suite skips Windows, where `/bin/bash` and shell fixtures are unavailable; cross-platform packaging/schema assertions remain active. No system policy, package installation, or native Ubuntu launch is exercised; packaged Ubuntu 24.04 acceptance remains necessary.

#### Compatible profile installation

Both actual generated package hooks copy the exact bundled profile bytes and load the installed policy after parser compatibility succeeds.

#### Unsupported AppArmor

Disabled AppArmor and an incompatible parser skip policy copying and kernel loading without turning a platform compatibility skip into a package failure.

#### Image-building chroot

A compatible profile is copied into an image-building chroot while kernel loading is skipped, preserving the host's policy state.

#### Real load failures remain visible

A compatible policy that fails actual kernel loading retains its nonzero result, rather than being silently treated as an unsupported parser.

#### Conditional sandbox permission

Working user namespaces preserve sandbox mode 0755, while unavailable namespaces select the SUID mode needed by Chromium's alternate sandbox path.
