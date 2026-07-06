# Main Process

The Electron main process keeps the entrypoint small and separates app lifecycle from IPC registration.

## Entrypoint

`src/main/index.ts` performs only pre-ready setup and delegates startup.

[[src/main/index.ts]] applies GPU crash preferences, enables the optional CDP testing port, and calls [[src/main/app/start.ts#startMainProcess]]. This keeps one-off process boot concerns separate from windows, menus, updater wiring, and IPC.

## GPU Fallback

Hardware acceleration is disabled and persisted after a GPU-process crash so machines without a usable GPU avoid an infinite crash → relaunch loop — but only temporarily, so a transient crash can't strand a working GPU on SwiftShader.

[[src/main/gpu-fallback.ts#applyGpuPreferences]] disables hardware acceleration when a crash flag, relaunch sentinel, or `HERMES_DISABLE_GPU` says so, while keeping SwiftShader WebGL available. Persistent GPU-off fallback is honored by default on Windows/Linux, but macOS clears stale flags unless `HERMES_GPU_FALLBACK=1` forces it, protecting the Office tab from permanent software-rendering lag. [[src/main/gpu-fallback.ts#installGpuCrashGuard]] watches fatal GPU-process exits and relaunches with software rendering where the persistent fallback is enabled.

### Flag expiry

The persisted `disable-gpu.flag` is only honored for 24 hours after the crash that wrote it; a stale or unparseable flag is cleared at launch and hardware acceleration is retried.

GPU crashes are often transient (driver update mid-session, a since-removed virtual display adapter, a Chromium blocklist gap for a brand-new GPU), and before the TTL a single crash silently pinned Windows/Linux machines to software rendering forever — a user with an RTX 5060 Ti ran the Office 3D tab at 1 fps on 10+ CPU cores for over a week. If the GPU genuinely still crashes, the re-armed crash guard re-persists a fresh flag, so a broken machine pays at most one crash+relaunch per 24-hour window.

### User preference

Settings → Appearance offers a tri-state hardware-acceleration preference — Auto (crash-guard driven, the default), Always on, Always off — persisted in `gpu-preference.json` beside the crash flag.

The preference lives in `userData`, not renderer settings storage, because [[src/main/gpu-fallback.ts#getGpuPreference]] must read it synchronously before app-ready — the only point where hardware acceleration can still be disabled. Precedence is `HERMES_DISABLE_GPU` env (support escape hatch) > relaunch sentinel (a crash still rescues the current session even under "Always on") > preference > crash flag. Under "Always on" the crash guard relaunches with the sentinel but skips persisting the flag, so every subsequent launch retries hardware acceleration; "Always off" suppresses the crash guard and the Office banner's re-enable button (the banner points at Settings instead). [[src/main/gpu-fallback.ts#setGpuPreference]] writes the file (IPC `set-gpu-preference`, validated in the main process); changes apply after a relaunch via [[src/main/gpu-fallback.ts#relaunchApp]] (IPC `relaunch-app`). The Appearance pane (`src/renderer/src/components/settings/AppearancePane.tsx`) compares the saved preference against the `bootPreference` captured by [[src/main/gpu-fallback.ts#applyGpuPreferences]] so its "restart to apply" prompt survives closing and reopening Settings.

### Renderer visibility and recovery

Software rendering is no longer silent: the Office tab shows a warning banner with a one-click recovery when hardware acceleration is off.

[[src/main/gpu-fallback.ts#getGpuStatus]] reports whether the GPU is disabled, why (`env` / `preference` / `sentinel` / `flag`), and whether the app can recover; [[src/main/gpu-fallback.ts#reenableGpuAndRelaunch]] deletes the flag and relaunches without the GPU-off sentinel (refused when `HERMES_DISABLE_GPU=1` forces software rendering, since a relaunch would inherit it). Both are exposed over IPC (`get-gpu-status`, `reenable-gpu`) via the preload bridge, and the Office screen (`src/renderer/src/screens/Office/Office.tsx`) renders the banner over the 3D view — the one surface where SwiftShader is painfully visible. The one-click re-enable applies only to crash fallbacks: env- and preference-forced software rendering render an informational banner without the button.

## App Lifecycle

Lifecycle code owns Electron windows, global app events, and shutdown cleanup.

[[src/main/app/start.ts#startMainProcess]] registers crash logging, IPC handlers, updater handlers, Electron ready/activate/window-all-closed/before-quit events, CSP headers, security hardening, and the main BrowserWindow.

[[src/main/app/start.ts]] also supports the `HERMES_OPEN_DEVTOOLS=1` diagnostic launch path so packaged builds can expose renderer console errors when startup fails before the UI paints.

The packaged renderer keeps its meta CSP aligned with the production response CSP so file-backed startup assets load consistently from `file://` before the main-process header can help.

Because electron-vite emits a bundled main file at `out/main/index.js`, packaged renderer loading resolves `../renderer/index.html` from `__dirname` to reach `out/renderer/index.html`.

## App Chrome Helpers

Menu, updater, and context-menu behavior live in focused modules.

[[src/main/app/menu.ts#buildMenu]] owns the application menu, [[src/main/app/updater.ts#setupUpdater]] owns update IPC and electron-updater events, and [[src/main/app/context-menu.ts#showChatContextMenu]] owns the chat right-click menu.

Release builds keep a Help-menu Developer Tools toggle as a production diagnostics escape hatch without changing renderer sandbox or Node isolation.

## IPC Registry

Renderer IPC handlers are isolated from app bootstrap so the registry can be split by domain.

[[src/main/ipc/register.ts#registerIpcHandlers]] currently preserves the existing handler behavior behind one registration function. It receives app-level callbacks for the main window, model-library notifications, connection-config notifications, external URL opening, and active chat abort handles.

Wallet and token-balance handlers sit in the same registry: `list-wallets`, `create-wallet`, `import-wallet`, `rename-wallet`, `delete-wallet` (backed by [[wallet-token-balances#Wallet Store]]) and `get-token-balances` (backed by [[wallet-token-balances#Token Balances]]).

## Voice transcription IPC

Speech-to-text IPC sends recorded desktop audio through the Hermes API server, not through the active chat model endpoint.

[[src/main/ipc/register.ts#registerIpcHandlers]] exposes `transcribe-audio` for the preload bridge, and [[src/main/hermes.ts#transcribeAudio]] posts a base64 data URL to `/api/audio/transcribe`. If the local gateway lacks that desktop route, it falls back to the Python `tools.transcription_tools.transcribe_audio` dispatcher, so local Whisper, Groq, OpenAI, ElevenLabs, and command/plugin STT providers remain independent from the selected chat model.

## SSH dashboard transport

SSH mode has two chat transports because the remote serves chat from **two different servers**, and the desktop must reach the right one.

The dashboard is **not** a `/v1` superset (a long-standing misconception in earlier comments): `hermes_cli/web_server.py` has no `/v1/chat`, `/v1/responses`, or `/v1/runs` routes and does not proxy `/v1` to the gateway.

- **Gateway api_server** (port 8642, `API_SERVER_KEY` auth) serves `/v1` chat (`/v1/chat/completions`, `/v1/responses`, `/v1/runs`) + `/health`. This is the **no-build** transport — no Node, no web dist — used by `remote` mode and the SSH gateway fallback. See [[main-process#SSH api_server provisioning]].
- **Dashboard** (`hermes dashboard`, port 9119, session-token auth) serves the model library, session list (`/api/*`), and the chat **WebSocket** (`/api/ws`) — surfaces the gateway api_server does not. Local chat uses `/api/ws`; over SSH the renderer's dashboard transport uses it too, when a dashboard is available.

[[src/main/ssh-remote.ts#sshEnsureDashboard]] ensures the gateway is up, builds the web dist if missing ([[src/main/ssh-remote.ts#sshEnsureDashboardDist]] resolves the real install root via [[src/main/ssh-remote.ts#sshResolveDashboardRoot]] — a system-wide install lives at `/usr/local/lib/hermes-agent`, NOT under `$HOME`, so a hardcoded `~/.hermes/hermes-agent` path wrongly reported "no web dist" and forced every connection into basic chat; it now detects an already-built dist wherever hermes lives, or builds it with the vendored Node at `~/.hermes/node`, single shared in-flight build), then starts the **unified machine** `hermes dashboard --host 127.0.0.1 --port <port> --no-open --skip-build` ([[src/main/ssh-remote.ts#sshStartDashboard]]) with the session token in its env. **One dashboard serves every profile** (no `--profile`, no `--isolated`): `ensureDashboardInner` is machine-scoped (profile=undefined → default port + default token), and per-profile data is selected per-request via `?profile=` ([[src/main/remote-sessions.ts#RemoteSessionConfig]]`.profile`, applied in `dashboardApiUrl`). This is REQUIRED because the desktop has a single global SSH tunnel that can only point at one remote port: the desktop queries multiple profiles at once (e.g. `default` for the machine view + the active named profile), so per-profile dashboard ports (an earlier `--isolated` attempt) made those concurrent queries resolve different ports and thrash the one tunnel ("SSH tunnel is not active"). Readiness requires both the public `/api/status` probe ([[src/main/ssh-remote.ts#sshWaitDashboardReady]], [[src/main/ssh-remote.ts#sshDashboardRunning]]) and an authenticated `/api/sessions` probe ([[src/main/ssh-remote.ts#sshDashboardAuthenticated]]). If the preferred port belongs to a stale dashboard with another token or an unrelated HTTP service, the desktop leaves that process alone, allocates a free loopback port, and persists it as `HERMES_DESKTOP_DASHBOARD_PORT` (one canonical line, deduped) in the **default** `.env`. [[src/main/dashboard.ts#sshDashboardConnectionFromConfig]] and [[src/main/ipc/register.ts#getSshDashboardSessionConfig]] then `ensureSshTunnel` to that single dashboard port and build the connection (model library, sessions, and the `/api/ws` chat WS), carrying the requested `profile`.

Because the dashboard is machine-unified, an **unscoped** request silently answers with the **default** profile's data — a named-profile user would get the default session list and open the wrong transcript. Session and metadata IPC handlers (`list-sessions`, `get-session-messages`, delete/title/search/cache ops, hermes version/home, model config) therefore default the dashboard profile to the locally persisted active profile via [[src/main/ipc/register.ts#activeSshProfile]] (explicit renderer-passed profiles win; `"default"` and already-explicit params like the session list's `profile=all` are handled in `dashboardApiUrl`). [[src/main/remote-metadata.ts]]'s `/api/status` probe shares [[src/main/remote-sessions.ts#dashboardApiUrl]] rather than building its own URL, so status-derived surfaces (Hermes home/version) are scoped the same way.

**Every** SSH tunnel entry point that prepares chat — the `send-message` preamble and the `start-ssh-tunnel` IPC handler — routes through [[src/main/ipc/register.ts#prepareSshTunnel]]. When an authenticated dashboard is available it tunnels to the dashboard port and caches the dashboard token; otherwise (gateway-only installs with no web dist, or `legacy` transport) it provisions and tunnels to the gateway `/v1` port. This single funnel matters because the tunnel is one global resource: a path tunnelling to 8642 while another used 9119 would thrash it (each `startSshTunnel` first `stopSshTunnel`s), surfacing as "SSH tunnel is not active". The `before-quit` handler in [[src/main/app/start.ts#startMainProcess]] calls `stopSshTunnel()` on exit — without it the `ssh -N -L` child is orphaned (reparented to PID 1) and keeps holding its local port, so each relaunch leaks another tunnel and the port drifts (18642 → 61799 → …). When the dashboard can't run, `sshEnsureDashboard` returns `null`: `auto` degrades quietly to the gateway `/v1` path for chat and legacy CLI/SSH-exec ops for `withSshDashboardModelLibrary`/`withSshDashboardSessions`, while a forced `dashboard` transport surfaces the error.

The dashboard is "ensured" on every chat/model-library/session op, so `sshEnsureDashboard` is guarded against a spawn spiral: an in-flight promise collapses a connect storm into one probe, and a ~60s negative cache (`dashboardUnavailableUntil`, cleared by [[src/main/ssh-remote.ts#resetSshDashboardAvailability]] on connection-config change) short-circuits to the gateway path. The negative cache latches **only for the permanent case** — the remote has no buildable web dist — never for a transient (dashboard still starting, a readiness/auth blip): caching a transient would force chat's `prepareSshTunnel` onto the gateway `/v1` tunnel (8642) while model-library still targets the dashboard port, thrashing the single global tunnel ("SSH tunnel is not active" / 405). [[src/main/ssh-remote.ts#sshStartGateway]] carries the same in-flight dedup (and re-checks status inside the guard). Without these, concurrent ops each found "no gateway/dashboard", launched their own, and on a small remote the duplicates OOM-killed each other — the desktop then saw "not running" and respawned, wedging the box. The dashboard cache/in-flight keys are **machine-scoped** (host:port:user, not per-profile, since one dashboard serves all profiles), so the whole connect storm collapses to a single probe and a single tunnel.

Because the launch-time SSH connect (the splash "Starting SSH tunnel…" step in [[src/renderer/src/App.tsx#App]]'s `runInstallCheck`) can be slow on first connect or stall on an unreachable host, [[src/renderer/src/screens/SplashScreen/SplashScreen.tsx]] shows a "Switch to local mode" escape hatch after a delay so the user is never trapped. It reuses `handleSwitchToLocal`, which stops any in-flight tunnel, persists `local` mode, and re-runs the check; `runInstallCheck` carries a generation guard (`runIdRef`) so the abandoned SSH run can't clobber the local run's screen transition.

## SSH api_server provisioning

The gateway `/v1` chat path is the no-build SSH transport (and the only one on gateway-only installs that lack the dashboard web dist), but it requires the remote api_server to be configured — which SSH mode, unlike local mode, never did.

The gateway only loads the api_server platform when `API_SERVER_ENABLED` is truthy (`gateway/config.py`), and the api_server refuses to bind without `API_SERVER_KEY`. Local mode writes both via `startGateway`; SSH mode previously only **read** the key, so a fresh server had no `/v1` endpoint at all and every chat failed. [[src/main/ssh-remote.ts#sshEnsureApiServerKey]] now ensures both on the remote `.env` (per profile): it generates + writes `API_SERVER_KEY` when missing/invalid ([[src/main/ssh-remote.ts#isUsableApiServerKey]] rejects empty, <16-char, and placeholder keys) and sets `API_SERVER_ENABLED=true`, returning whether anything was written. [[src/main/ipc/register.ts#prepareSshTunnel]]'s gateway branch calls it, then starts the gateway if down — or stops+starts it when the env was just written so the running gateway picks up the new api_server config — and waits for the api_server `/health` ([[src/main/ssh-remote.ts#sshWaitGatewayApiReady]]) before opening the tunnel, so the first chat doesn't race "tunnel health check failed". A `false` readiness result (health never bound within the timeout — fresh or slow remotes) makes `prepareSshTunnel` **throw** instead of opening the tunnel and caching the key: reporting success with an unbound `/v1` just deferred the failure to the first chat with a less actionable connection error. Chat then POSTs `/v1` over the tunnel with that key cached via `setSshRemoteApiKey`.

These `.env` writes go through [[src/main/ssh-remote.ts#upsertEnvLine]], which rewrites the first matching line and **drops any later duplicates**. Both `sshReadEnv` and the remote gateway's dotenv are last-wins, and pre-dedup desktops left `.env` files with several `API_SERVER_KEY` lines — replacing only the first while a stale later line survived meant the gateway kept the old key while the desktop cached the new one, a permanent 401. Writes self-heal that corruption, matching the canonical-line writers used for the dashboard token and port.

## SSH credential resolution

The credential depends on which transport is active. Over the **dashboard** the **session token** is used; over the **gateway `/v1`** path the remote **`API_SERVER_KEY`** is used.

The dashboard's `/api/*` routes (and its `/api/ws` chat WS) reject the api_server key (401) and accept only `HERMES_DASHBOARD_SESSION_TOKEN`. [[src/main/ssh-remote.ts#sshEnsureDashboardToken]] reads the token from the remote `.env` (per profile), generating + persisting one when absent so it stays stable across reconnects and is shared by the remote dashboard process and the desktop. It writes exactly one canonical line (stripping any duplicates) under an in-flight guard — the dashboard is ensured on every chat/model-library/session op, and the old unguarded `printf >>` let concurrent first-connect callers append divergent tokens (observed as 9 conflicting lines in one `.env`, where dotenv's last-wins value drifted from a caller's cached token → 401). [[src/main/ssh-remote.ts#sshEnsureApiServerKey]] carries the same guard for the gateway `/v1` key. The desktop caches it via `setSshRemoteApiKey`. The SSH form has no API-key field (only **remote** mode does, [[src/renderer/src/components/settings/ConnectionPane.tsx]]), so the shared `conn.apiKey` is never used for SSH — avoiding the stale-key 401s the old `conn.apiKey || …` precedence caused. On the gateway `/v1` path the credential is the remote `API_SERVER_KEY`, provisioned by [[src/main/ssh-remote.ts#sshEnsureApiServerKey]] and read via [[src/main/ssh-remote.ts#sshReadRemoteApiKey]].
