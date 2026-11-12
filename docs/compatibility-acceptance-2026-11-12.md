# v0.7.8 final compatibility acceptance

This record follows the [November 11 investigation](compatibility-acceptance-2026-11-11.md) and records merged-source and packaged-application checks. The corrected replacement build, four-platform native matrix and signed ARM Local, Remote and SSH chat acceptance passed before publication.

## Candidate identity

The initial candidate exercised the merged compatibility stack; native acceptance then identified a Windows interpreter mismatch, requiring a replacement candidate before publication.

- Desktop: `0.7.8`, Electron `44.9.1`.
- Agent: `v0.23.1`, commit `3b421578588243f920886e6fe79a6faa87ea026e`, desktop contract 8.
- Corrected application source: `02f1a1b1b1f6bd58f97615e6a0a05d51014220cd`, including the native Windows runtime fix in [#1084](https://github.com/fathah/hermes-desktop/pull/1084).
- Merged main: `de6a272f211afd66235af6096a6153919079e8e4`; application source, dependency lockfile, runtime assets and packaging inputs match the built corrected source. Acceptance tooling and documentation retain their own recorded commit identities.
- [Replacement five-platform dry run 43216734359](https://github.com/fathah/hermes-desktop/actions/runs/43216734359): completed successfully at `2026-11-12T12:43:46Z`. All five builds and winget generation passed; release publishing and the landing-page rebuild were explicitly skipped.
- Replacement signed macOS arm64 ASAR SHA256: `7b6880eaef3c7683efa11836d4d2a756c98d9c39b34cffc40b33e41528258653`. Deep strict signature verification, Gatekeeper and the stapled application ticket passed for team `WM6645CA5X`; archive verification covered 21,424 packed and 67 unpacked files, including the two strictly verified post-signing SQLite exceptions.
- Initial application source: `ce3894def090e58edcf03d6da68660c53befffbb`; [dry run 43207699530](https://github.com/fathah/hermes-desktop/actions/runs/43207699530) passed all five builds and winget generation without publishing.
- Initial macOS arm64 artifact ID: `13939757627`; ZIP SHA256 `1f38ca11c4c7fabe12d8e4f0f53d0970b94854bb5e0c019e2e726432e13b9331`, matching GitHub's artifact digest.
- Initial signed application ASAR SHA256: `4b6c302a6e59d8b8e221f5bff9d0fc5511c960aa55a8268e6f257890daafc815`.
- Developer ID team: `WM6645CA5X`; strict signatures, Gatekeeper and the stapled application ticket passed.

The replacement run's exact outer artifact ZIP identities are recorded below. Each artifact's source SHA matches the corrected application commit; these hashes identify GitHub Actions archives, not the individual installers inside them.

| Artifact | ID | SHA256 |
| --- | --- | --- |
| macOS x64 | `13946455354` | `316467ea687cbdc8f75d69601d3e07a52dd4bc8deb93ba2ea5362f4243ff9f95` |
| macOS arm64 | `13944549493` | `fffd8464d910b862c5211b34873f137c824b6fbaefcef9389d495a0b67bfb2f8` |
| Linux x64 | `13944062456` | `e6555f86687ecff8facc7b705b75bcf21499de7fc45c3a31b1e7e52a45b10dd4` |
| Linux arm64 | `13944301545` | `073836c293d7a0741918fdaab222ceac876a64987726a4940950399235fbe6b2` |
| Windows x64 | `13943888281` | `620d7e916f68f975e67057154cd3cee2385158516de3677edb56abf633de04a2` |
| winget manifests | `13943084817` | `aed9b524d7cefa87cbce2ed4922211d4064cb83c1809ea88249962c7922012b8` |

Both replacement Mac jobs signed with Developer ID `WM6645CA5X` and completed notarization: arm64 at `12:41:58Z`, x64 at `12:42:19Z`. Each job verified its matching SQLite Mach-O architecture before upload. The full build ledger is `/private/tmp/hermes-release-dry-run-43216734359-evidence.json`.

## Merged-source quality

The integrated application source passed its full regression suite, build and quality gates before the native release matrix.

| Check | Result |
| --- | --- |
| Corrected-source full local suite | 3,609 passed, 13 skipped |
| Node and renderer typechecks; production build | Passed |
| Zero-warning lint | Passed |
| Production dependency audit | Zero vulnerabilities |
| Focused acceptance-tool regressions | Passed in the separately reviewed acceptance PRs |
| Documentation links and code references | `lat check` passed |
| Actual Agent request transport | Local 9, Remote token 10, real SSH 9 checks passed |
| Actual Agent chat and tool loop | All three modes passed, with four persisted transcript rows each |

The local machine uses Node 22.12, which requires `NODE_OPTIONS=--experimental-sqlite` for the suite's real SQLite adapter. Restricted-sandbox and missing-flag attempts were discarded as incomplete environment checks. The initial merged application suite passed 3,579 tests; corrected source `02f1a1b1` passed 3,609 tests in 88.82 seconds, with 13 skips.

An initial corrected-source run passed 3,608 tests but failed the unchanged About progress test's old-phase assertion once. Its 11-test file then passed in isolation and the identical full suite passed without changing assertions, product code or test timeouts. Both full-run logs are retained rather than counting the failing attempt as acceptance.

Source transport reports are `/private/tmp/hermes-v0.7.8-final-transport.json` and `/private/tmp/hermes-v0.7.8-final-chat.json`. Corrected-source full-suite logs are `/private/tmp/hermes-v0.7.8-runtime-final-tests.log` and `/private/tmp/hermes-v0.7.8-runtime-final-tests-rerun.log`. Corrected-source [CI 43216730003](https://github.com/fathah/hermes-desktop/actions/runs/43216730003) also passed; native acceptance tooling has separate green CI runs.

## Signed macOS arm64 application

The corrected signed app from `02f1a1b1` was copied from its read-only DMG and tested serially against the real Agent with a scripted localhost provider. Local, Remote and SSH each passed all nine checks.

| Corrected UI mode | Result | Evidence |
| --- | --- | --- |
| Local managed installation | Passed, 9 checks | `/private/tmp/hermes-v078-final02-local/{result,cleanup}.json` |
| Direct Remote token | Passed, 9 checks | `/private/tmp/hermes-v078-final02-remote/{result,cleanup-audit}.json` |
| SSH | Passed, 9 checks | `/private/tmp/hermes-v078-final02-ssh/{result,cleanup-audit}.json` |

The corrected runs required the matching contract-8 batch reply, three scripted provider calls, all four restored transcript items, About `0.7.8`, native SQLite `3.53.4` and clean renderer/fatal diagnostics. The Local fixture's configuration and environment were restored byte-for-byte with their original modes, and its app/backend processes exited. Independent Remote and SSH audits found no surviving recorded processes or temporary state; SSH checked all 16 recorded PIDs and removed its isolated trust/control state. These results use the exact replacement ASAR identified above.

All five screenshots per corrected mode were independently inspected. Remote and SSH's first Welcome snapshots capture the intro before controls reveal; their completed setup is established by the actual successful UI interactions. Clarification, completion, restored tool history and About version are visible in the later screenshots. Each evidence directory retains `visual-review.json`.

The initial signed CI app from `ce3894` separately passed all three modes, as retained below. The later source change preserves the Windows interpreter and adds a hidden-process option; chat protocol and renderer code are unchanged.

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

The published macOS arm64 v0.7.7 app applied the signed initial candidate through its real installed updater and launched successfully afterward.

The runner pointed the existing updater singleton to a loopback generic feed, verified the downloaded candidate hash, called `quitAndInstall`, observed replacement at the same owned location and launched the updated app. Version `0.7.8`, native SQLite, existing user data, a marker and the automatic-upgrade preference survived. Both baseline and updated UI startup diagnostics passed. The final installed app retained strict signature and Gatekeeper acceptance; no update-test app or helper remained running.

The successful report is `/private/tmp/hermes-final-updater/evidence-retry/result.json`. Silent installation followed by an explicit launch is intentional; automatic relaunch, public GitHub feed delivery and differential downloads are separate properties.

## Native CI and managed provisioning

The read-only native workflow consumes the exact candidate artifacts and genuinely installs or provisions each tested target on a disposable host.

| Target | Status |
| --- | --- |
| Windows x64 NSIS install/UI/SQLite and v0.7.7 upgrade | Corrected candidate passed, 5 fresh-install and 4 real-update checks |
| Linux x64 DEB install/UI/SQLite and AppImage upgrade | Corrected candidate passed, 5 fresh-install and 4 real-update checks |
| Linux arm64 AppImage install/UI/SQLite and upgrade | Corrected candidate passed, 5 fresh-install and 4 real-update checks |
| Intel macOS DMG install/Gatekeeper/UI/SQLite and upgrade | Corrected candidate passed, 5 fresh-install and 4 real-update checks |
| Linux x64 actual pinned Agent fresh installation and managed runtime | Corrected source passed all four checks |
| Windows x64 actual pinned Agent fresh installation and native runtime | Corrected source passed all four checks |

The final [native run 43221018650](https://github.com/fathah/hermes-desktop/actions/runs/43221018650) consumed replacement build `43216734359` at source `02f1a1b1`, with tooling at merged main `de6a272f`. All four retained evidence ZIP digests and per-target candidate/baseline provenance were independently verified. Each actual updater replaced v0.7.7 with v0.7.8, loaded native SQLite before and afterward, and preserved the same user-data path, marker file and `autoUpgrade: false` preference. All native runtimes reported Electron `44.9.1`, SQLite `3.53.4` and the intended architecture.

| Final native target | Evidence artifact | Quit to updated launch |
| --- | --- | --- |
| Windows x64 | `13945238989` | 184.630 seconds, within the Windows 300-second budget |
| Linux x64 | `13944677749` | 3.394 seconds |
| Linux arm64 | `13945778454` | 2.688 seconds |
| Intel macOS | `13946436712` | 27.681 seconds; candidate and baseline stapler validation passed first try |

The final ledger and extracted JSON reports, logs and screenshots are under `/private/tmp/hermes-native-run43221018650/`. Windows, Intel and Linux x64 screenshots show the completed Welcome controls. The Linux arm64 headless capture shows the heading and connection cards but omits the Get Started label amid Skia/GPU diagnostics; its DOM reveal, runtime, native SQLite and updater gates passed. Physical-GPU rendering is not established by that capture.

The [first run 43212349432](https://github.com/fathah/hermes-desktop/actions/runs/43212349432) reached actual managed provisioning; its four Desktop jobs stopped before installation because the Actions script loader did not expose Node's `require.resolve`. [#1081](https://github.com/fathah/hermes-desktop/pull/1081) corrected the actual locked ZIP dependency and workspace loading. [Run 43213431505](https://github.com/fathah/hermes-desktop/actions/runs/43213431505) then passed actual Desktop install/launch/SQLite/update checks on all four targets, although its screenshots preceded the completed Welcome reveal.

The strengthened [run 43214912948](https://github.com/fathah/hermes-desktop/actions/runs/43214912948) passed fully revealed Welcome and native SQLite on all four targets. Its Windows updater exceeded the old 180-second close-event budget, while an Intel baseline ticket check hit Apple CloudKit network loss. [#1083](https://github.com/fathah/hermes-desktop/pull/1083) applied the Windows budget to shutdown as well as replacement and added strictly bounded retry for that exact transient Apple error. [Control run 43217303143](https://github.com/fathah/hermes-desktop/actions/runs/43217303143) passed all four complete native jobs. Windows took 188.4 seconds from quit to replacement launch. Signature and trust failures remain blocking; data/version assertions were not relaxed.

Managed provisioning uses Desktop's exact reviewed installer helper, commit and digest. It skips browser/computer-use setup, credentials and services, then checks genuine PM facts, committed dependencies, CLI version, raw imports and arguments. Windows must publish and execute native `hermes.exe`. Windows installer PATH registry changes and any Linux system prerequisites occur only on disposable CI hosts.

Actual Windows acceptance exposed a product defect: Desktop substituted `pythonw.exe` for the launcher's canonical `python.exe`. Version checks passed, but the ordinary raw helper returned empty stdout/stderr. Splitting the probe in [#1082](https://github.com/fathah/hermes-desktop/pull/1082) ruled out web-import redirection. The exact same installer, Agent commit, canonical command and raw probe passed after [#1084](https://github.com/fathah/hermes-desktop/pull/1084) preserved interpreter identity. Agent's bootstrap otherwise detected a different executable and relaunched it across a Windows stream boundary.

Corrected-source [managed run 43216728928](https://github.com/fathah/hermes-desktop/actions/runs/43216728928) passed on Windows and Linux: native launcher, full canonical argv equality, CLI `v0.23.1`, Python `3.14.9`, native architecture, FastAPI `0.133.1` and OpenAI `2.54.0` from genuine PM generations, raw stdout, full web import, selected home and quoted arguments. Before/after proof is `/private/tmp/hermes-managed-windows-canonical-before-after.json`; both result artifact digests were independently checked.

## Review and remaining boundaries

The compatibility work was reviewed and merged in separate PRs, with Greptile findings verified and corrected before publication.

PRs #1073–#1084 are merged. Each latest Greptile summary scored 5/5 and references that PR's exact final head, independently checked through GitHub. Reported findings were verified against merged source and corrected; all review threads are resolved, including the #1079 Windows temporary-directory test finding fixed in #1080.

| PR | Scope | Reviewed head | Greptile |
| --- | --- | --- | --- |
| [#1073](https://github.com/fathah/hermes-desktop/pull/1073) | Security dependencies and audit | `daa061b8` | [5/5](https://github.com/fathah/hermes-desktop/pull/1073#issuecomment-6803838915) |
| [#1074](https://github.com/fathah/hermes-desktop/pull/1074) | Correlated Agent requests and native prompts | `20a6761e` | [5/5](https://github.com/fathah/hermes-desktop/pull/1074#issuecomment-6803886285) |
| [#1075](https://github.com/fathah/hermes-desktop/pull/1075) | Managed installers and launchers | `7f04f91c` | [5/5](https://github.com/fathah/hermes-desktop/pull/1075#issuecomment-6803854891) |
| [#1076](https://github.com/fathah/hermes-desktop/pull/1076) | Fresh Remote and SSH readiness | `3ee306fc` | [5/5](https://github.com/fathah/hermes-desktop/pull/1076#issuecomment-6803858005) |
| [#1077](https://github.com/fathah/hermes-desktop/pull/1077) | Guarded request ownership | `2ba28341` | [5/5](https://github.com/fathah/hermes-desktop/pull/1077#issuecomment-6803840502) |
| [#1078](https://github.com/fathah/hermes-desktop/pull/1078) | REST tool history | `3e668f01` | [5/5](https://github.com/fathah/hermes-desktop/pull/1078#issuecomment-6803832616) |
| [#1079](https://github.com/fathah/hermes-desktop/pull/1079) | Release packaging and evidence | `a702b472` | [5/5](https://github.com/fathah/hermes-desktop/pull/1079#issuecomment-6804445908) |
| [#1080](https://github.com/fathah/hermes-desktop/pull/1080) | Native install, runtime and updater acceptance | `86dc0f63` | [5/5](https://github.com/fathah/hermes-desktop/pull/1080#issuecomment-6822356642) |
| [#1081](https://github.com/fathah/hermes-desktop/pull/1081) | Actions workspace module loading | `b11984b5` | [5/5](https://github.com/fathah/hermes-desktop/pull/1081#issuecomment-6822925574) |
| [#1082](https://github.com/fathah/hermes-desktop/pull/1082) | Independent managed output probes | `5cd3ab3b` | [5/5](https://github.com/fathah/hermes-desktop/pull/1082#issuecomment-6823132944) |
| [#1083](https://github.com/fathah/hermes-desktop/pull/1083) | Settled Welcome and bounded updater/ticket checks | `38d378e2` | [5/5](https://github.com/fathah/hermes-desktop/pull/1083#issuecomment-6823203633) |
| [#1084](https://github.com/fathah/hermes-desktop/pull/1084) | Canonical Windows interpreter and hidden calls | `02f1a1b1` | [5/5](https://github.com/fathah/hermes-desktop/pull/1084#issuecomment-6823450465) |

At acceptance sign-off, no tag or GitHub Release had been published. All corrected native installer/updater and signed ARM chat checks had completed. Publication rebuilds these same application inputs from merged main and is followed by public asset/feed verification.

The provider is scripted fixture data, not paid inference. External OAuth identities, real external-host/container provisioning, browser/computer-use tools and system-service configuration were not exercised. Native RPM installation, Windows portable execution and automatic relaunch are not covered by the currently executed matrix; the standard shipping targets still build. Live public updater metadata must be checked after publication.
