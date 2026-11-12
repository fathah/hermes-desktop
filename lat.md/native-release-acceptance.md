# Native release acceptance

Disposable native CI runners verify actual shipping installers, packaged UI startup and SQLite, followed by a separate real updater transaction from the previous published version.

## Disposable native installation

The native installer runner refuses non-CI execution and paths outside the runner's temporary directory, then installs the exact candidate target and launches its packaged executable.

`scripts/verify-native-install.mjs` verifies a DMG-copied app and Gatekeeper on macOS, executes the real per-user NSIS installer on Windows, installs the DEB through the package manager on Linux x64, and places the arm64 AppImage in its user-owned executable location. Each run records installer identity, runtime architecture and version, a UI screenshot, and a native SQLite query from inside packaged Electron. It never installs Agent or calls a model.

An `--install-only` pass prepares the published baseline for the separate updater runner. Installation roots carry a native fixture marker; the updater requires its own explicit ownership marker before modifying that disposable baseline. AppImage baselines use a versionless filename so replacement is observed at the same path.

## Native CI matrix

The manually dispatched workflow verifies the candidate artifact's source commit and executes Windows x64, Linux x64 and arm64, and Intel macOS jobs on matching native runners.

Each job uses the candidate's actual release artifact and the previous published baseline. Linux UI runs use Xvfb. The workflow retains JSON reports and screenshots and has no release-publishing permissions. Build success alone cannot satisfy these jobs.

Candidate ZIP archives and published baseline installers are checked against their GitHub SHA-256 digests before extraction or execution. The candidate source SHA must match a successful Release run from this repository. Acceptance tooling is checked out at the separate exact workflow-dispatch commit, so a previously built candidate need not already contain its later validation scripts; both SHAs are recorded. No app is rebuilt from the tooling checkout.

Current macOS acceptance requires its known Developer ID team and stapled application ticket; a DMG ticket is not inferred. AppImage runs use the actual runtime's extract-and-run mode.

## Test specifications

Focused contract checks prevent installer execution outside its disposable boundary and keep native execution and upgrade gates in every platform job.

### Non-CI execution is refused

The actual CLI exits before any installation when the caller is not a disposable GitHub Actions runner.

### Installation cannot escape its runner root

Real CLI invocations reject lexical and symlink escapes from RUNNER_TEMP before writing a report, marker or installation payload outside the owned directory.

### Native jobs require installed launch and real update

The workflow checks out exact acceptance tooling, verifies candidate provenance separately, and requires native installer/SQLite checks, baseline provisioning and actual updater on all four targets with read-only repository permissions.
