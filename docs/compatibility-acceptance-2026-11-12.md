# v0.7.8 final compatibility acceptance

This record follows the [November 11 investigation](compatibility-acceptance-2026-11-11.md) and records final merged-source and signed-application checks. Native platform acceptance is still in progress; its rows must pass before publication.

## Candidate identity

The candidate was built from the merged compatibility stack without publishing a tag or GitHub release.

- Desktop: `0.7.8`, Electron `44.9.1`.
- Agent: `v0.23.1`, commit `3b421578588243f920886e6fe79a6faa87ea026e`, desktop contract 8.
- Application source: `ce3894def090e58edcf03d6da68660c53befffbb`.
- [Five-platform release dry run 43207699530](https://github.com/fathah/hermes-desktop/actions/runs/43207699530): all builds and winget manifest generation passed; publishing and landing-page jobs were skipped.
- macOS arm64 artifact ID: `13939757627`; ZIP SHA256 `1f38ca11c4c7fabe12d8e4f0f53d0970b94854bb5e0c019e2e726432e13b9331`, matching GitHub's artifact digest.
- Signed application ASAR SHA256: `4b6c302a6e59d8b8e221f5bff9d0fc5511c960aa55a8268e6f257890daafc815`.
- Developer ID team: `WM6645CA5X`; strict signatures, Gatekeeper and the stapled application ticket passed.

## Merged-source quality

The integrated application source passed its full regression suite, build and quality gates before the native release matrix.

| Check | Result |
| --- | --- |
| Full local application suite | 3,579 passed, 13 skipped |
| Node and renderer typechecks; production build | Passed |
| Zero-warning lint | Passed |
| Production dependency audit | Zero vulnerabilities |
| Acceptance-tool regressions | 29 passed |
| Documentation links and code references | `lat check` passed |
| Actual Agent request transport | Local 9, Remote token 10, real SSH 9 checks passed |
| Actual Agent chat and tool loop | All three modes passed, with four persisted transcript rows each |

The local machine uses Node 22.12, which requires `NODE_OPTIONS=--experimental-sqlite` for the suite's real SQLite adapter. A restricted-sandbox attempt could not bind loopback sockets; a later attempt collected five suites unsuccessfully without that Node flag. The complete run with the required environment passed in 102.71 seconds. No product assertion or timeout was relaxed.

Source transport reports are `/private/tmp/hermes-v0.7.8-final-transport.json` and `/private/tmp/hermes-v0.7.8-final-chat.json`; the full local test log is `/private/tmp/hermes-v0.7.8-final-tests-sqlite.log`. Acceptance tooling passed [CI 43211697835](https://github.com/fathah/hermes-desktop/actions/runs/43211697835).

## Signed macOS arm64 application

The actual final CI app was copied from its read-only DMG into a disposable directory and tested against the real Agent with a scripted localhost provider.

| UI mode | Result | Outcome |
| --- | --- | --- |
| Local managed installation | Passed, 9 checks | Actual PM-installed Agent startup, clarification, completion and restored tool history. |
| Direct Remote token | Passed, 9 checks | Actual Welcome setup against a fresh authenticated backend and the same complete chat/history flow. |
| SSH | Passed, 9 checks | Actual Welcome SSH selection, real OpenSSH execution/tunnel, fresh authenticated backend and the same chat/history flow. |

Each mode required contract 8, the two-question correlated request and matching answer, exactly three scripted provider calls, the final completion, all four saved items (`user`, `tool_call`, `tool_result`, `assistant`), renderer reload, About `0.7.8`, native SQLite `3.53.4`, and zero page/console/main fatal errors. No admitted prompt was replayed. Fresh Remote and SSH prerequisites required complete JSON responses with status sequence `200/503/200/401` and no seeded database.

The archive check verified 21,424 packed and 67 unpacked files. Only the two known Developer ID-signed SQLite Mach-O prebuilds used the documented post-signing exception; parent and individual file signatures matched the expected team. All other hashes matched exactly.

The Local fixture's configuration and `.env` bytes and modes were restored. Remote's app/backend exited and its trial was removed. SSH's independent audit found all 17 recorded processes gone, no owned descendants, no residual fixture trust entry and no temporary state. SSH used explicit held-lock web-backend liveness metadata to keep a messaging gateway from preinitializing its fresh store; messaging gateway provisioning was not exercised.

Reports and five screenshots per mode are under `/private/tmp/hermes-final-signed-local-verified/`, `/private/tmp/hermes-final-signed-remote-verified/` and `/private/tmp/hermes-final-signed-ssh-verified/`. Each directory retains its cleanup audit.

Earlier concurrent signed trials failed before reaching the scripted provider. An instrumented Remote run established valid Node HTTP body/end/close handling, followed by unchanged, uninstrumented serial runs that all passed. The earlier failures remain preserved and are not counted as acceptance. No production fix or relaxed timeout was applied to obtain the serial passes.

## Actual installed updater

The published macOS arm64 v0.7.7 app applied the final signed candidate through its real installed updater and launched successfully afterward.

The runner pointed the existing updater singleton to a loopback generic feed, verified the downloaded candidate hash, called `quitAndInstall`, observed replacement at the same owned location and launched the updated app. Version `0.7.8`, native SQLite, existing user data, a marker and the automatic-upgrade preference survived. Both baseline and updated UI startup diagnostics passed. The final installed app retained strict signature and Gatekeeper acceptance; no update-test app or helper remained running.

The successful report is `/private/tmp/hermes-final-updater/evidence-retry/result.json`. Silent installation followed by an explicit launch is intentional; automatic relaunch, public GitHub feed delivery and differential downloads are separate properties.

## Native CI and managed provisioning

The read-only native workflow consumes the exact candidate artifacts and genuinely installs or provisions each tested target on a disposable host.

| Target | Status |
| --- | --- |
| Windows x64 NSIS install/UI/SQLite and v0.7.7 upgrade | Pending native rerun |
| Linux x64 DEB install/UI/SQLite and AppImage upgrade | Pending native rerun |
| Linux arm64 AppImage install/UI/SQLite and upgrade | Pending native rerun |
| Intel macOS DMG install/Gatekeeper/UI/SQLite and upgrade | Pending native rerun |
| Linux x64 actual pinned Agent fresh installation and managed runtime | Passed; report verification in progress |
| Windows x64 actual pinned Agent fresh installation and native runtime | Running |

The [first run 43212349432](https://github.com/fathah/hermes-desktop/actions/runs/43212349432) reached actual managed provisioning. Its four Desktop jobs stopped before any installation because the Actions script loader did not expose Node's `require.resolve`; a separate workflow correction is required. These failures are not application installation or update results.

Managed provisioning uses Desktop's exact reviewed installer helper, commit and digest. It skips browser/computer-use setup, credentials and services, then checks genuine PM facts, committed dependencies, CLI version, raw imports and arguments. Windows must publish and execute native `hermes.exe`. Windows installer PATH registry changes and any Linux system prerequisites occur only on disposable CI hosts.

## Review and remaining boundaries

The compatibility work was reviewed and merged in separate PRs, with Greptile findings verified and corrected before publication.

PRs [#1073](https://github.com/fathah/hermes-desktop/pull/1073), [#1074](https://github.com/fathah/hermes-desktop/pull/1074), [#1075](https://github.com/fathah/hermes-desktop/pull/1075), [#1076](https://github.com/fathah/hermes-desktop/pull/1076), [#1077](https://github.com/fathah/hermes-desktop/pull/1077), [#1078](https://github.com/fathah/hermes-desktop/pull/1078) and [#1079](https://github.com/fathah/hermes-desktop/pull/1079) were merged in order. [#1080](https://github.com/fathah/hermes-desktop/pull/1080) separately added native/managed acceptance and reached a current-head Greptile score of 5/5 with no new findings.

The provider is scripted fixture data, not paid inference. External OAuth identities, real external-host/container provisioning, browser/computer-use tools and system-service configuration were not exercised. Native RPM installation, Windows portable execution and automatic relaunch are not covered by the currently executed matrix; the standard shipping targets still build. Live public updater metadata must be checked after publication.
