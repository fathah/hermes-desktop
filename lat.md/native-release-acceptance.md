# Native release acceptance

Disposable native CI runners verify actual shipping installers, packaged UI startup and SQLite, followed by a separate real updater transaction from the previous published version.

## Disposable native installation

The native installer runner refuses non-CI execution and paths outside the runner's temporary directory, then installs the exact candidate target and launches its packaged executable.

`scripts/verify-native-install.mjs` verifies a DMG-copied app and Gatekeeper on macOS, executes the real per-user NSIS installer on Windows, installs the DEB through the package manager on Linux x64, and places the arm64 AppImage in its user-owned executable location. Each run records installer identity, runtime architecture and version, a UI screenshot, and a native SQLite query from inside packaged Electron. It never installs Agent or calls a model.

Fresh UI acceptance waits for Welcome's exact heading, completed onboarding phase and fully revealed title and controls before querying SQLite or taking its screenshot. Text mounted behind the opening animation cannot satisfy readiness.

An `--install-only` pass prepares the published baseline for the separate updater runner. Installation roots carry a native fixture marker; the updater requires its own explicit ownership marker before modifying that disposable baseline. AppImage baselines use a versionless filename so replacement is observed at the same path.

## Native startup diagnostics

Native installed-app acceptance rejects renderer exceptions, caught console errors and fatal main-process diagnostics before reporting success.

The native installer runner uses the [[compatibility-validation#Startup diagnostics|shared diagnostic collector]] and a bounded retained-message snapshot before its success gate. Startup logs and captured diagnostics remain in the JSON/log evidence on both success and failure. Loading the UI and SQLite cannot mask a caught initialization failure.

## Native CI matrix

The manually dispatched workflow verifies the candidate artifact's source commit and executes Windows x64, Linux x64 and arm64, and Intel macOS jobs on matching native runners.

Each job uses the candidate's actual release artifact and the previous published baseline. Linux UI runs use Xvfb. The workflow retains JSON reports and screenshots and has no release-publishing permissions. Build success alone cannot satisfy these jobs.

Candidate ZIP archives and published baseline installers are checked against their GitHub SHA-256 digests before extraction or execution. The candidate source SHA must match a successful Release run from this repository. Acceptance tooling is checked out at the separate exact workflow-dispatch commit, so a previously built candidate need not already contain its later validation scripts; both SHAs are recorded. No app is rebuilt from the tooling checkout.

Artifact acquisition resolves its ZIP dependency from the checked-out workspace with Node's module loader. It does not depend on `actions/github-script` exposing the full Node `require` API.

Current macOS acceptance requires its known Developer ID team and stapled application ticket; a DMG ticket is not inferred. AppImage runs use the actual runtime's extract-and-run mode.

## Test specifications

Focused contract checks prevent installer execution outside its disposable boundary and keep native execution and upgrade gates in every platform job.

### Non-CI execution is refused

The actual CLI exits before any installation when the caller is not a disposable GitHub Actions runner.

### Installation cannot escape its runner root

Real CLI invocations reject lexical and symlink escapes from RUNNER_TEMP before writing a report, marker or installation payload outside the owned directory.

### Native jobs require installed launch and real update

The workflow checks out exact acceptance tooling, verifies candidate provenance separately, and requires native installer/SQLite checks, baseline provisioning and actual updater on all four targets with read-only repository permissions.

### Updater files use actual builder names

The installed Linux packager expands shipping artifact configuration for x64 and arm64, and both results must match the workflow's updater filenames. AppImage maps x64 to x86_64, independently of the native runtime's architecture label.

### Acquisition loads workspace dependencies under github-script

The actual workflow acquisition script runs with a wrapped `require` lacking `resolve`, loads the workspace ZIP dependency and reaches mocked GitHub metadata before any download or installation.

## Managed Agent provisioning

Separate disposable Windows and Linux jobs run Desktop's verified pinned Agent installer, then exercise its genuinely provisioned managed launcher and dependencies.

`scripts/verify-managed-install.mjs` uses the production installer-command helpers and adds only upstream's browser and computer-use opt-outs. Noninteractive setup skips credentials and gateway services. An empty RUNNER_TEMP-owned tree supplies home, Hermes state, Python downloads and caches; inherited CI credentials are removed before installation and runtime discovery.

Windows installation may update the disposable runner's user PATH registry; Linux PM may install missing system prerequisites. These jobs do not claim that every installer write is temporary. The exact reviewed commit, installer digests and normal PM provisioning remain unchanged.

Acceptance requires the installer completion marker and source stamp, native Windows `hermes.exe`, its runtime-command query, Desktop's managed resolver and CLI version. A raw helper must load core/web dependencies from the recorded PM generation, preserve a quoted argument and keep the selected home. Reports and installer logs are retained without uploading the generated home.

### Managed installation requires CI

The real runner refuses non-CI execution before creating an installation, ensuring that its system-side effects belong only to disposable CI machines.

### Managed installation stays in a fresh owned tree

Real CLI invocations reject lexical or symlink escapes, outside reports and populated roots before provisioning, so genuine fresh installation cannot reuse or modify unrelated state.

### Managed CI requires production provisioning

Windows x64 and Linux x64 jobs require validated candidate provenance, exact tooling checkout, the managed installer runner and retained failure evidence under read-only GitHub permissions.

### Timed-out installer descendants are stopped

An actual POSIX child ignores SIGTERM after its parent exits. Timeout handling awaits bounded process-group cleanup, escalates to SIGKILL and checks for survivors before returning the original timeout failure.
