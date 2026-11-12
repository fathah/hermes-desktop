# Agent compatibility validation

Compatibility validation combines focused app tests, isolated live transport smoke and a scripted actual-Agent chat loop, keeping each tier distinct from packaged or external-host acceptance.

## Isolated live transport

The live smoke uses the actual desktop WebSocket client and main-process relay against the selected Agent source, with disposable state and no model inference.

`scripts/verify-agent-compatibility.mjs` bundles [[src/renderer/src/screens/Chat/dashboardGatewayClient.ts#DashboardGatewayClient]], [[src/main/dashboard-websocket-relay.ts#createLoopbackWebSocketRelay]] and [[src/main/ssh-command.ts#buildSshRemoteCommand]] from the working tree. `scripts/agent-compatibility-backend.py` runs the real Agent web server and request registry with test-only request triggers; eager agent construction is disabled so no provider is contacted.

Approval correlation, batched clarification, cancellation, main-only secrets and unanswered-request replay run over loopback Local and token Remote endpoints. Optional SSH validation creates its own temporary keys and localhost daemon, checks literal command bytes through the production wrapper, and forwards the same actual backend through OpenSSH. Every process and temporary home belongs to the runner.

The smoke also verifies explicit refusal of unsupported window interactions, native-only secret restoration after reconnect and rejection of an invalid Remote token. It keeps sensitive replay entries out of the renderer's `open_requests`; matching-ID replies still settle the original Agent request.

## Acceptance failure handling

Acceptance runners report startup and observed renderer failures as failed evidence and preserve their normal fixture teardown.

Spawn errors are captured immediately and surfaced through the runner's bounded waits, so the normal failure report and child cleanup still run. Packaged UI completion requires empty page-error and console-error collections alongside its main-process fatal-error check.

### Missing child executable

The actual transport-runner CLI returns a failed JSON report for a missing Python executable, with an ENOENT explanation and no uncaught process error. Its logs stay inside the fixture's OS temporary directory on Windows and POSIX systems.

### Existing children after startup failure

Real disposable children exercise the runner's process helpers and teardown: a later missing executable is surfaced by startup waiting and an already running child is terminated.

### Caught renderer console errors

The actual packaged completion gate rejects a caught console error even when there is no page exception or main-process fatal error; clean diagnostics still pass.

## Evidence boundaries

An isolated live transport result proves wire behavior through those concrete paths; it does not prove OAuth sign-in, external provisioning, model inference or a packaged platform's installation.

Each runner's report lists successful modes and explicit limitations. Source and fixture tests cover legacy fallback and connection/profile ownership, while installer/runtime fixtures cover launcher selection. Release preparation must retain pending platform or deployment checks instead of relabelling them as live successes.

## Actual Agent chat loop

A second acceptance tier builds the real Agent and exercises its model/tool loop through deterministic localhost responses, without claiming actual ML inference.

The [chat runner](../scripts/verify-agent-chat.mjs) uses the production desktop client and main-process relay for `session.create` and `prompt.submit`. A scripted OpenAI-compatible provider streams a clarification tool call, verifies the real tool's two answers, and returns a final completion. The runner requires four persisted transcript rows and runs separate Local and token Remote sessions, optionally through a disposable OpenSSH tunnel.

The source checkout and Python interpreter are explicit inputs. The temporary home has no inherited provider credentials and only the clarification tool enabled. Agent construction and tool execution remain unmodified; the provider supplies deterministic data. Process, token, key and state ownership stays with the runner. The [acceptance record](../docs/compatibility-acceptance-2026-11-11.md) keeps this evidence distinct from the request-only smoke and packaged-platform acceptance.

A supplemental managed-runtime probe used Agent's actual launcher publisher and Desktop's resolver, CLI prefix and raw helper. PM facts and the committed generation were explicitly staged around existing isolated dependencies; this demonstrates launcher/bootstrap integration rather than fresh-installer or PM provisioning acceptance.

## Fresh POSIX provisioning

A separate macOS arm64 acceptance run executes the production verified installer in a confined temporary home, then checks Desktop's resolver against the genuinely provisioned managed runtime.

[[src/main/installer-download.ts#verifiedInstallerCommand]] supplied the downloaded/hash-verified script and pinned Agent commit. The run used its noninteractive setup skip plus upstream's browser/computer-use opt-outs. PM genuinely installed tools and locked application dependencies, published launchers and built products; no runtime facts or generations were fixture-created. Desktop's resolver, CLI version and [[src/main/installer.ts#hermesPythonArgs|raw helper]] then succeeded against that installation.

An OS sandbox allowed writes only inside the disposable tree and blocked system package/service commands. Package caches, home and Hermes state were isolated, including the installer's temporary shell rc edits. The [acceptance record](../docs/compatibility-acceptance-2026-11-11.md) retains the exact flags and evidence boundaries. Native Windows/Linux provisioning, optional browser/computer-use tools, services and signed app installation remain separate checks.

## Installed updater acceptance

The installed-updater runner applies an unpublished candidate to an owned copy of the published baseline through the actual packaged updater.

`scripts/verify-installed-update.mjs` requires an explicit installation root with a matching `.desktop-update-fixture.json` ownership marker. A loopback generic feed supplies the candidate bytes and SHA512 to the existing updater singleton; production source and feed configuration stay unchanged.

Acceptance requires baseline launch and native SQLite, update discovery, real download, `quitAndInstall`, replacement of the installed payload, and a new launch at the candidate version. The same isolated user data, marker and automatic-upgrade preference must survive. The test uses full downloads and a controlled local feed; it does not certify public GitHub feed delivery or differential downloads.

## Packaged application acceptance

The packaged-app runner verifies archive bytes and drives the actual Electron UI against a disposable Agent backend with a scripted localhost provider.

`scripts/verify-packaged-app.mjs` first checks packed and unpacked ASAR file hashes, candidate metadata, the runtime payload allowlist and absence of environment files. It launches an explicit packaged executable with isolated home, Hermes state and Electron user data. The UI path covers Welcome, Remote token setup, composer submission, real multi-question clarification, completion, saved-history restoration and About version. A native in-memory SQLite query runs inside packaged Electron, and renderer errors and main-process fatal errors fail acceptance.

Developer ID signing changes unpacked Mach-O binaries after ASAR header creation. `--expected-team-id` allows only the known better-sqlite3 Darwin prebuilds to differ after strict parent and file signature checks match that team; actual and header hashes remain recorded. All other files require exact header hashes.

The runner retains screenshots, hash counts and a JSON report, with diagnostic logs on failure. `--preflight-only` runs only archive validation. This tier does not certify a signed installer, auto-update, external OAuth or external-host deployment; Local and SSH wire behavior remains covered by their separate live runners.

Diagnostic WebSocket traces retain method, correlation, session and result-key metadata without frame bodies or credentials. Acceptance requires contract 8, one batched clarification answered with its matching request ID and one new conversation with restored final content; existing fixture conversations remain intact.

Streamed final text is not persistence proof: a bounded read requires all four history items and the final content before renderer reload. This also checks that Remote normalization preserves tool calls returned as arrays by the current Agent API.

The backend starts with a fresh home and no seeded database schema or conversations. The runner records protected HTTP probe statuses before connecting, detects connection errors immediately, and dismisses the optional follow prompt through the UI even when it appears after the composer.

Fresh UI startup waits for the follow prompt, whose mount requires committed connection settings and successful chat readiness. A single retry is allowed only for the exact pre-send connection-authority error, with zero provider requests, user bubbles and saved sessions; admitted prompts are never replayed.

Optional `--mode=local --hermes-home=/absolute/temporary/home` uses an actual managed installation and lets the application own backend startup. The home must be under a system temporary directory and contain `.desktop-compat-fixture.json` with matching `ownedHome` and purpose `hermes-desktop-packaged-ui`. Local mode preserves the installation, restores the configuration and environment files it changes, and isolates Electron user data. Both UI modes use only the scripted localhost provider.

Local fixture configuration includes dummy custom-provider keys and a generated `API_SERVER_KEY`, matching normal Desktop setup without any user credentials. The required batched WebSocket request and matching response prevent a legacy fallback from satisfying acceptance.

The 2026-11-11 macOS arm64 candidate passed both native UI modes against Agent v0.23.1, including native SQLite 3.53.4 and complete restored tool activity. The [acceptance record](../docs/compatibility-acceptance-2026-11-11.md) retains archive identity, per-mode reports and screenshot evidence.

## Signed CI application acceptance

A CI-built macOS arm64 app is verified against its public Developer ID and tested from an owned copy extracted from a read-only disk image.

Release dry run `43075715283` at `439c8b07` produced artifact `13881213648`. Its downloaded ZIP matched GitHub's SHA-256 digest before extraction. The DMG checksum passed, then the image was mounted read-only without browsing, its app copied into the verification folder, and the image detached.

The copied app passed deep strict code-signature verification, Gatekeeper assessment as `Notarized Developer ID`, and stapled-ticket validation for team `WM6645CA5X`. Both Local and Remote UI runs passed the same nine checks, including real batched clarification, matching request IDs, complete restored tool activity, desktop version 0.7.8 and native SQLite 3.53.4.

The verifier requires `--expected-team-id=WM6645CA5X` for this signed candidate. A wrong team and a modified resource in the owned copy were each rejected before launch; exact resource bytes were restored and the parent signature reverified. Unsigned default preflight still requires every header hash without signed exceptions.

This evidence covers the notarized CI app and read-only DMG extraction. Installation into an existing system, account migration and in-place updater application remain operator acceptance. CI publishing was explicitly skipped.

## SSH packaged application acceptance

SSH mode drives the packaged Welcome connection form through a disposable localhost OpenSSH daemon to an explicit actual Agent source backend.

`--mode=ssh` requires the source checkout and Python inputs used by Remote mode. The daemon owns temporary host and client keys, restricts forwarding to the fixture backend, and fixes HOME, HERMES_HOME and shell initialization paths to its temporary tree. A real SSH command verifies those environment values before Electron starts. Host service commands are disabled in the fixture PATH.

An owned client wrapper invokes the real OpenSSH binary with explicit temporary known-hosts and control-socket paths and no user SSH configuration. This isolates client state even when OpenSSH resolves its default paths from the account database instead of HOME.

The recorded gateway PID is the real source backend owned by the runner; it avoids starting an unrelated messaging gateway. No database schema or conversation is seeded. Production SSH discovery, authentication, tunnelling, protocol handling and history reads remain active, followed by the same batch clarification, restored-history, About and native SQLite checks.

The report identifies localhost and the fixture boundary explicitly. This tier does not certify an external host, SSH provisioning or an installed-system upgrade. Daemon, backend, app and fixture state belong only to the runner and are cleaned up after success.
