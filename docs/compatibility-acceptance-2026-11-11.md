# Agent compatibility acceptance

Validation evidence for the compatibility catch-up against Agent v0.23.1, recorded November 11, 2026. A passed source transport test is distinct from packaged platform or external deployment acceptance.

## Tested baseline

The live backend ran the exact tagged Agent source with isolated dependencies and an otherwise empty temporary Hermes home.

- Agent: `v0.23.1`, commit `3b421578588243f920886e6fe79a6faa87ea026e`, desktop contract 8.
- Host: macOS Apple Silicon, Python 3.14.3, working-tree desktop client and main-process relay bundled from their actual TypeScript.
- Dependencies: Agent core plus `web`, with the upstream `tool.uv.override-dependencies` applied. An ordinary pip resolution without those declared overrides correctly rejects the intentional browser-harness/Pillow pin mismatch; this is not an instruction to bypass the Agent package manager for user installations.
- State and credentials: temporary home, random fixture token, temporary OpenSSH keys and daemon. Existing Agent installs, accounts, sessions and services were not changed.

## Results

Live tests exercised the real Agent web server, request registry and validation with controlled request triggers, without constructing a model agent or calling a provider.

| Path                               | Live source transport result | Verified behavior                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local loopback                     | Passed                       | Contract 8, client capability advertisement, approval correlation/duplicate rejection, multi-question clarification, cancellation, native-only secret handling, native prompt abort and unanswered-request replay. |
| Direct Remote with token, loopback | Passed                       | The same request lifecycle through the actual Agent token-authenticated endpoint and production main-process relay.                                                                                                |
| SSH localhost forwarding           | Passed                       | The same request lifecycle through a real disposable OpenSSH daemon and port-forward, plus exact literal bytes through the production POSIX remote-command wrapper.                                                |

The Local and Remote rows use the same isolated server implementation with separately created sessions and connections. They exercise concrete transport behavior, not the full Electron connection-selection workflow. Mode/profile authority and OAuth cookie/ticket handling are covered by the separate application test suites.

The final smoke also restored a pending native secret prompt after reconnect without forwarding it in the renderer's `open_requests`, and verified that the actual Remote endpoint refuses an invalid token.

## Actual Agent chat and tool loop

A separate acceptance tier ran the real `AIAgent` against a scripted localhost OpenAI-compatible provider, without disabling agent construction or adding test-only RPC methods.

The actual desktop client and main-process relay created a session and submitted a normal prompt. The fixture provider streamed a `clarify` tool call; Agent executed the real tool, asked two questions through the new server-request protocol, accepted the desktop's answer map, and sent the resulting tool output back to the provider. A second streamed completion finished the turn and persisted all four transcript rows.

| Path                               | Actual Agent/tool-loop result | Verified outcome                                                                                                                       |
| ---------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Local loopback                     | Passed                        | `session.create`, `prompt.submit`, two-question clarification, answers `Local` and `Dubai`, final completion, and four persisted rows. |
| Direct Remote with token, loopback | Passed                        | The same actual Agent roundtrip on a separately created authenticated session.                                                         |
| SSH localhost forwarding           | Passed                        | The same actual Agent roundtrip through a disposable OpenSSH daemon and port-forward.                                                  |

The checked-in `scripts/verify-agent-chat.mjs` passed all three paths with Agent v0.23.1 and Python 3.14.3 on November 11. The provider's responses were deterministic fixture data: this proves the Agent/client/tool integration, not real ML inference quality or a paid provider's behavior. The earlier request-only tier remains separate and covers additional cancellation, approvals, secret handling and replay cases.

Reproduce this tier with the same isolated source and dependency environment:

```sh
node scripts/verify-agent-chat.mjs \
  --agent-repo=/path/to/isolated/v0.23.1/source \
  --python=/path/to/isolated/python3.14 \
  --agent-ref=v0.23.1 \
  --ssh \
  --output=/tmp/hermes-agent-chat-result.json
```

The runner constructs a temporary config with one localhost provider and only the clarification tool, inherits no provider credentials, and disables lazy dependency installation. Its configured 128K context satisfies Agent's 64K minimum. All spawned processes and temporary keys belong to the runner; success removes the disposable state, while failure retains diagnostic logs and removes private SSH keys. The JSON report records the actual modes, persisted-row checks and scripted provider tool results.

## Upstream-published managed launcher

A supplemental isolated probe exercised Agent's real launcher publisher and Desktop's managed-runtime discovery/bootstrap path without running a fresh installer.

Agent v0.23.1's `hermes_cli._launchers.stage_launcher` published the canonical launcher in a separate temporary source tree and home containing spaces. The fixture explicitly staged PM store/dependency facts and a committed generation around the existing Python 3.14 dependency environment; it did not provision those dependencies through PM.

Desktop's actual `resolveHermesRuntime` returned `managed` and available, matching the upstream launcher's exact `--print-runtime-command` output: store Python followed by `-I`, `-c`, and Agent's own bootstrap. CLI `--version` executed successfully, and `buildHermesPythonArgs` loaded `fastapi` and `openai` from the selected generation while preserving the selected home and an argument containing spaces and quotes. The archive lacks `.git` and release/install stamps, so version output was `Hermes Agent vunknown (2026.9.24)`, Python 3.14.3 and OpenAI SDK 2.54.0; this was bootstrap execution evidence, not release-version-label certification.

The temporary fixture was removed after success. The metadata was fixture-created, so this result does not replace fresh-install, PM provisioning, native Windows launcher or packaged-platform acceptance.

## Actual POSIX fresh installation

The production verified installer command completed a genuine fresh Agent v0.23.1 installation on macOS arm64 in a disposable home, with PM provisioning its own tools and application environment.

The command came from the candidate's `verifiedInstallerCommand()`: download the pinned script, verify SHA-256, then execute `--skip-setup --commit 3b421578588243f920886e6fe79a6faa87ea026e`. This run additionally used upstream's `--skip-browser --skip-computer-use` options. Installer exit was zero after 4 minutes 1 second. The checked-out HEAD and clean `install-stamp.json` both identify the exact pinned commit and release `0.23.1`.

The command supplied to the confined Bash process was constructed from the production helper without changing its verification or commit argument:

```js
const command =
  verifiedInstallerCommand() + " --skip-browser --skip-computer-use";
```

PM downloaded and verified its actual uv, ffmpeg, Node/npm/pnpm, Python and ripgrep tools, synchronized the locked Python dependency environment, published launchers and built the Agent products, including `hermes_cli/web_dist/index.html`. No facts or dependency-generation metadata were staged by the test. Desktop's actual resolver then returned `managed` and available; the resolved CLI reported **Hermes Agent v0.23.1**, **Python 3.14.9** and **OpenAI SDK 2.54.0**. Its managed raw-Python helper imported FastAPI 0.133.1 and OpenAI 2.54.0, preserving an argument containing spaces/quotes and the selected `HERMES_HOME`.

The OS sandbox denied writes outside the owned temporary tree and denied execution of sudo, Homebrew, launchctl, crontab and osascript. `HOME`, Hermes state and all user package/cache directories were temporary; no provider credentials were inherited. Official noninteractive mode skipped account setup and gateway-service installation. Only temporary shell rc files received the installer's PATH line. An initial pre-download attempt was safely denied because bare macOS `mktemp` selects the account's Darwin temp directory despite `TMPDIR`; the successful retry delegated those calls to the real utility with an explicit owned template.

The report is `/private/tmp/hermes-agent-fresh-install-result.json`, including exact verified command, source/digest, runtime argv, version and import results. The retained root is `/private/tmp/hermes-fresh-installer-YPKa06`; its `installer.log` and `home/.hermes` are reserved for the separately owned packaged Local UI smoke. This closes fresh POSIX PM provisioning for this host, while browser/computer-use installation, Windows/Linux fresh installation, system-service setup and signed application installation/update remain separate checks. The GitHub release workflow's platform dry run remains pending.

## Reproduction

The runner accepts an explicit source checkout and Python environment so it cannot silently test the developer's installed Agent or credentials.

```sh
node scripts/verify-agent-compatibility.mjs \
  --agent-repo=/path/to/isolated/v0.23.1/source \
  --python=/path/to/isolated/python3.14 \
  --agent-ref=v0.23.1 \
  --ssh \
  --output=/tmp/hermes-agent-compatibility-result.json
```

The Python environment needs the selected Agent's backend dependencies. This run used a `git archive v0.23.1` export and a dedicated temporary venv. The backend fixture disables eager model construction, adds test-only `compat.*` request triggers and otherwise uses the actual Agent RPC/auth implementation. The Node runner imports the real desktop client, main-process relay and SSH quoting wrapper, injects only a deterministic native secret collector, checks results and cleans up all test processes.

The JSON report lists cases per successful mode and explicit limitations. Failures retain only the disposable fixture logs for inspection. Random fixture credentials are never used with an external host.

## Packaged macOS application

The final unsigned v0.7.8 arm64 bundle was launched as a real Electron application, with separate disposable Local and Remote state, rather than a browser-only renderer or imported client.

Both final runs passed all nine checks: archive contents and hashes, actual composer, contract-8 two-question clarification, exact matching-ID answers, real Agent completion, persisted user/tool-call/tool-result/assistant history, reload/sidebar restoration, About v0.7.8 and native SQLite execution. Both had zero page errors, zero console errors, no main-process fatal errors and no admission retries.

- Local used the genuine PM-provisioned Agent installation from the fresh-installer tier. Desktop launched and stopped its own managed `serve` child; the test restored the fixture config and environment files afterward.
- Remote began with an otherwise empty Agent home and no pre-initialized session database. The actual connection UI authenticated the backend before the first chat created its store.
- The scripted localhost provider received the actual tool answers `Local` and `Dubai`, and returned `COMPAT_ACTUAL_AGENT_OK`. This is Agent/tool/client integration evidence, not model-inference quality.
- Both modes restored four IPC history items, including the current REST API's decoded tool-call arrays, and loaded packaged `better-sqlite3` under Electron with SQLite 3.53.4.

The same archive passed every hash and length check for 21,424 packed files and 67 unpacked files (246,611,186 verified bytes). Its SHA-256 was `3b2891d77b0ce29ff58fa69f3d735ab95a65895cb9d69d6d1af36a380af26c1b`. Screenshots of clarification, completion, restored history and About were visually inspected. All app, provider and backend processes exited after verification.

Local evidence remains under `.sandbox/release-v0.7.8/packaged-local-attempt4/`; Remote evidence is under `.sandbox/release-v0.7.8/packaged-remote-attempt8/`. Each contains `result.json`, logs and five screenshots. Earlier failed iterations are retained separately and are not counted as passes; they identified the fresh-store admission, guarded request-ownership and REST history fixes, plus verifier-only timing/selector issues.

The checked-in `scripts/verify-packaged-app.mjs` reproduces this tier. Remote requires explicit isolated `--agent-repo` and `--python` inputs. Local requires `--mode=local --hermes-home=/absolute/temporary/home` and an ownership marker at that home; it refuses an unmarked installation or a non-temporary path. The explicit marker is `{"purpose":"hermes-desktop-packaged-ui","ownedHome":"/absolute/temporary/home"}` in `.desktop-compat-fixture.json`.

## Remaining acceptance boundaries

These checks establish current wire compatibility but do not certify every installed environment, external identity provider or packaged operating system.

- Remote OAuth account sign-in, external SSH hosts, remote provisioning and container-host launchers need deployment or operator acceptance beyond loopback transport testing.
- No actual ML inference or paid provider call ran. The request-only tier directly opens Agent server requests; the actual Agent tier uses a scripted localhost provider to exercise the full tool loop.
- Windows and Linux packaged fresh installation/update, macOS signed application installation/update, and the complete SSH Electron connection-selection workflow remain separate checks. The macOS Local and Remote compatibility UI flows passed as recorded above.
- Capability regression tests verify that future contracts request a desktop update and retain unknown feature states, rather than being silently certified or suggesting an Agent downgrade.

## Application checks and candidate

The working tree is prepared as desktop v0.7.8, with no release tag, published package or updater-feed change.

| Check                                             | Result                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Full `npm test` with localhost networking allowed | **327 files passed, 2 skipped; 3,542 tests passed, 13 skipped; 111.16 seconds.**                                                   |
| `npm run build`                                   | Passed, including Node and renderer TypeScript checks and production bundles.                                                      |
| `npm run lint`                                    | Passed with the repository's zero-warning policy.                                                                                  |
| `npm run audit:prod`                              | Passed: **0 vulnerabilities**.                                                                                                     |
| `lat check` and `git diff --check`                | Passed.                                                                                                                            |
| Runtime dependency baseline                       | Electron package and native binary **44.9.1**; `@electron/get` remains **5.1.0**, with only its `undici` overridden to **7.30.2**. |

The final regression rerun began at 18:12 UTC on November 11 on `codex/release-v0.7.8`, after the REST-history fix and macOS ZIP packaging completed and both native UI runs exited. The command was plain `npm test`, using the repository's normal `vitest run --maxWorkers=4`. Its log is `/private/tmp/hermes-release-v0.7.8-historyfinal-tests.log`; audit and refreshed whole-repository lint logs are `/private/tmp/hermes-release-v0.7.8-historyfinal-audit.log` and `/private/tmp/hermes-release-v0.7.8-historyfinal-lint.log`.

Source snapshots and counts are recorded in `/private/tmp/hermes-release-v0.7.8-historyfinal-test-start.json`, `/private/tmp/hermes-release-v0.7.8-historyfinal-test-end.json` and `/private/tmp/hermes-release-v0.7.8-historyfinal-qa-result.json`. All 1,128 source, test, script, workflow and build-configuration files had the same start/end manifest SHA-256: `0beef7a73e903e7d7900f09be05bb801f486ec074fbacc959a88eac112f756d7`. The run started at history-fix commit `3e668f01fbeec36e3273cf53d36b3e03bdb514f9`; the same tested bytes were committed as release candidate `439c8b07d751aefc70c6079ea94a98f9e4e6d511` before it finished. Only documentation evidence changed afterward. This pass supersedes all earlier suite counts.

An immediately preceding run overlapped two native Electron acceptance runs and hit the unchanged five-second ceiling in two Layout usage tests. That file passed unchanged in isolation, then the complete quiet rerun passed with normal four-worker settings. No assertions or test deadlines were relaxed for this load-related retry; its earlier log remains `/private/tmp/hermes-release-v0.7.8-historyfinal-attempt1-tests.log`.

The native Linux package-hook fixtures repeatedly reached their former five-second subprocess ceiling under parallel macOS test load, including a run without a competing build. Their subprocess bound is now 15 seconds with a 20-second test ceiling; output, policy and exit-code assertions are unchanged. The final complete suite passed with the normal four-worker setting. Socket-dependent tests require local networking beyond the filesystem sandbox; a sandbox-denied attempt is not counted as a successful acceptance run.

The current model-library compatibility adapter was also executed as an in-memory overlay of the actual Agent v0.23.1 web-server module using Python 3.14. It registered both library routes, returned distinct root/profile models, and wrote the named profile without changing the root library. The source export was not modified by this probe.

The [v0.7.8 release draft](releases/v0.7.8.md) records the compatibility scope, upgrade notes and seven focused PRs. The [release dry run](https://github.com/fathah/hermes-desktop/actions/runs/43075715283) builds the `439c8b07` candidate without publishing; its prepare job confirmed `dry_run=true`, v0.7.8 tag absence and skipped publication. Later evidence-only documentation updates do not change its production inputs. Signed packaged-platform installation/update and external OAuth/deployment checks above remain separate pre-publication acceptance work.
