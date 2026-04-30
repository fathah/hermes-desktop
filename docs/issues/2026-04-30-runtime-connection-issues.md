# Runtime issue analysis: remote Hermes connection + Office module

**Status:** Investigation only — not part of `feat/winget-rpm-release` PR
**Date:** 2026-04-30
**Reporter:** local user testing the v0.2.3 .rpm build
**Scope:** Both issues exist in the upstream codebase at `a5b19c7` (independent of the release-pipeline PR)

This document is **untracked** by git. Decide whether to:

- Commit it as a separate PR / issue on `fathah/hermes-desktop`
- Keep it local as a working note
- Discard once the underlying bugs are fixed

---

## Issue 1 — Remote connection to Hermes on Docker (192.168.1.177) doesn't work

### Symptoms

User configures Settings → Connection → Remote, enters the Docker host IP (192.168.1.177). The "Test connection" button reports failure, or chats fail to send.

### Code path traced

**Settings UI** (`src/renderer/src/screens/Settings/Settings.tsx:309-333`):

- `handleSaveConnection()` calls IPC `setConnectionConfig(mode, url, apiKey)` — persists to `~/.hermes/desktop.json` as `{ connectionMode, remoteUrl, remoteApiKey }`.
- `handleTestConnection()` calls IPC `testRemoteConnection(url, apiKey)`.

**Main process** (`src/main/hermes.ts:753-777`):

```typescript
export function testRemoteConnection(url, apiKey?) {
  return new Promise((resolve) => {
    const target = `${url.replace(/\/+$/, "")}/health`;
    const mod = target.startsWith("https") ? https : http;
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const req = mod.request(target, { method: "GET", timeout: 5000, headers }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}
```

**Local-mode default** (for reference — `src/main/hermes.ts:17`): `LOCAL_API_URL = "http://127.0.0.1:8642"`. So the remote URL must follow the same pattern: `http://<host>:<port>`.

**Server-side enablement** (`src/main/hermes.ts:88-108`): the `ensureApiServerConfig()` function only configures the **local** Hermes Agent's `~/.hermes/config.yaml` to expose `api_server` on `127.0.0.1:8642`. It does NOT touch a remote/Docker Hermes — the Docker container's `config.yaml` must be configured separately by the user.

### Likely root causes (most-likely first)

#### 1.1 Wrong URL format entered in the UI ⚑ likely

The desktop app expects a full URL like `http://192.168.1.177:8642`. The user may have entered:

- `192.168.1.177` → `mod.request("/health")` triggers ENOTFOUND or relative-URL error
- `https://192.168.1.177:8642` → if the Docker container only serves HTTP, TLS handshake fails
- `http://192.168.1.177` (no port) → connects to port 80 (which most likely refuses)
- `http://192.168.1.177:8642/` (trailing slash) → handled correctly by `replace(/\/+$/, "")` so this is fine

**Fix on user side:** enter exactly `http://192.168.1.177:8642`.

**Fix on app side (improvement):** validate URL format on save; show helpful error like "URL must start with http:// or https:// and include a port".

#### 1.2 Hermes API server inside Docker is bound to 127.0.0.1, not 0.0.0.0 ⚑ very likely

The default `api_server` config that `ensureApiServerConfig()` writes is:

```yaml
platforms:
  api_server:
    enabled: true
    extra:
      port: 8642
      host: "127.0.0.1"   # ← bound to loopback only
```

When the user runs Hermes Agent inside Docker with this default config, the API server inside the container is bound to `127.0.0.1` of the **container's network namespace**. From the Docker host (192.168.1.177), the port forward `-p 8642:8642` cannot reach a server bound to the container's loopback — Docker only forwards to `0.0.0.0` bindings.

**Fix:** the user must edit `~/.hermes/config.yaml` *inside the Docker container* to bind to `0.0.0.0`:

```yaml
platforms:
  api_server:
    enabled: true
    extra:
      port: 8642
      host: "0.0.0.0"   # ← bind to all interfaces
```

Or, if the Docker image has the config pre-baked, use an env-var override: `HERMES_API_SERVER_HOST=0.0.0.0` (only works if Hermes Agent supports env-var overrides for nested config — needs verification against upstream Hermes Agent docs).

**Fix on app side (long-term):** the Settings UI could include a "Configure Docker Hermes" wizard that emits a ready-to-paste `config.yaml` snippet plus an example `docker run` command with the right port mapping.

#### 1.3 Docker port not published to host

Independent of 1.2, the user must run the container with `-p 8642:8642` (or `--network host`). Without this, port 8642 inside the container is invisible to the host network.

**How to verify (user side):**

```bash
# from any host on the LAN
curl -v http://192.168.1.177:8642/health

# expected: HTTP/1.1 200 OK with JSON body like {"status":"ok"}
# if "Connection refused": port not exposed → fix Docker port mapping
# if "Connection timed out": firewall or network routing issue
# if HTTP 200 but desktop app still fails: bug in the desktop app — investigate further
```

#### 1.4 Linux firewall on the Docker host blocks 8642

`firewalld` (Fedora/RHEL/Arch default), `ufw` (Ubuntu/Debian), or raw iptables rules may block incoming 8642.

**Fix on user side:**

```bash
# Fedora / RHEL / Arch (firewalld)
sudo firewall-cmd --permanent --add-port=8642/tcp
sudo firewall-cmd --reload

# Ubuntu / Debian (ufw)
sudo ufw allow 8642/tcp
```

#### 1.5 API key mismatch (only relevant if user set one)

If the Docker Hermes is configured with API-key auth and the user enters a different key (or no key) in the desktop app, `/health` may return 401, and `testRemoteConnection` returns `false`. The UI message "Could not reach server" is currently the same for both connection failures and auth failures — misleading.

**Fix on app side:**

```typescript
// In testRemoteConnection, distinguish:
(res) => {
  if (res.statusCode === 200) resolve({ ok: true });
  else if (res.statusCode === 401 || res.statusCode === 403) resolve({ ok: false, reason: "auth" });
  else resolve({ ok: false, reason: `status_${res.statusCode}` });
}
```

And surface the reason in the UI ("Connected, but auth failed" vs "Server unreachable"). This is a separate UX improvement PR.

### Verification protocol for the user

Run, in order, and stop at the first failure:

1. **Network reachability:** `ping -c 3 192.168.1.177` from the desktop machine. If 100% loss → network/routing issue, not the app.
2. **Docker port forward:** `nc -zv 192.168.1.177 8642` (or `curl http://192.168.1.177:8642/health`). Connection refused/timeout → Docker port mapping or firewall (see 1.3 / 1.4).
3. **API server up & bound to 0.0.0.0:** `curl -v http://192.168.1.177:8642/health` should return HTTP 200. If "connection reset by peer", the server is bound to 127.0.0.1 (see 1.2).
4. **API auth:** if `/health` returns 401, you have an API key configured in Docker — verify it matches what's in the desktop Settings.
5. **Desktop app:** click "Test connection" with `http://192.168.1.177:8642` and your key. If steps 1-4 pass and this still fails, the issue is in the app — capture logs (next step).

**Capturing app logs while testing:**

```bash
# Quit any running instance first
pkill -f hermes-desktop

# Launch from terminal so stdout/stderr show
hermes-desktop 2>&1 | tee /tmp/hermes-desktop.log

# Then in the UI: Settings → Connection → Remote → enter URL → Test
# Inspect /tmp/hermes-desktop.log for HTTP errors or stack traces
```

### Proposed fixes (app side, prioritized)

| # | Fix | Effort | Value |
|---|---|---|---|
| F-1.1 | URL validation on save (strip whitespace, require scheme + port, regex check) | XS (1 file, ~10 lines) | High — prevents silent fail |
| F-1.2 | Distinguish auth failure (HTTP 401/403) from connection failure in `testRemoteConnection` and surface in UI | S (2 files, ~20 lines) | High — debugging clarity |
| F-1.3 | Add a "Help me set up Docker" link/wizard that emits the correct `config.yaml` + `docker run` command | M (new component, ~80 lines) | Medium — reduces support burden |
| F-1.4 | When in remote mode, suppress local "API server starting…" / "Hermes installer" UI prompts that don't apply | S (UI guard) | Medium — confusing UX today |

---

## Issue 2 — Office module (Claw3d) doesn't connect properly

### Symptoms

The Office tab opens but doesn't load the 3D interface, shows an error, or hangs. May be related to remote mode being enabled at the same time.

### Code path traced

**Office UI** (`src/renderer/src/screens/Office/Office.tsx`):

- On mount, calls `claw3dStatus()` which returns `{ cloned, installed, devServerRunning, adapterRunning, running, port, portInUse, wsUrl, error }`.
- WebSocket URL state defaults to `"ws://localhost:18789"` (Office.tsx:28). User can override in Settings panel.
- A `<webview>` element loads `http://localhost:<port>` (typically 3000) which is the Next.js dev server cloned from `fathah/hermes-office`.

**Main process** (`src/main/claw3d.ts`):

- `HERMES_OFFICE_REPO = "https://github.com/fathah/hermes-office"` (claw3d.ts:15) — cloned to `~/.hermes/hermes-office`.
- `setupClaw3d()` does `git clone` + `npm install` (claw3d.ts:295-419).
- `startDevServer()` spawns `npm run dev` in `~/.hermes/hermes-office` with `PORT=<configured>` (claw3d.ts:443-496).
- `startAdapter()` spawns `npm run hermes-adapter` (claw3d.ts:519-568).
- The adapter listens on a WebSocket port (default 18789) and bridges Claw3D ↔ Hermes Agent.

**Critical architectural fact:** the `hermes-adapter` script in `hermes-office` connects to a **local** Hermes Agent process. It does NOT know about the desktop app's remote-mode setting.

### Likely root causes (most-likely first)

#### 2.1 Office is local-only by design; conflicts with remote mode ⚑ likely

If the user has set Settings → Connection → Remote (Issue 1's setup), the desktop app routes chat requests to the remote Docker Hermes. **But the Office module unconditionally clones, installs, and runs `hermes-office` locally** — and the `hermes-adapter` inside `hermes-office` tries to connect to a local Hermes process that isn't running (because the user is in remote mode).

There is no code path in `claw3d.ts` that consults `getConnectionConfig()` or `isRemoteMode()`. Search:

```bash
$ grep -n "isRemoteMode\|getConnectionConfig" src/main/claw3d.ts
# (no output)
```

**Fix (proper):** in remote mode, either:

- **(a) Disable Office tab** entirely and show a message "Office requires a local Hermes Agent. Switch to Local mode to use it." This is the safest short-term fix.
- **(b) Point the local `hermes-adapter` at the remote Hermes API URL** by injecting `HERMES_API_URL=<remote_url>` into the adapter's spawn env, and ensure the upstream `hermes-office` adapter actually supports remote backends. Requires upstream-side changes.

**Quick patch sketch (option a):**

```typescript
// In Office.tsx, near checkStatus():
const isRemote = await window.hermesAPI.isRemoteMode();
if (isRemote) {
  setState("error");
  setError("Office is only available in Local connection mode.");
  return;
}
```

Plus a UI message + a "Switch to Local" button.

#### 2.2 `npm` not found on the host

`findNpm()` (claw3d.ts:234-293) walks: `~/.volta/bin/npm`, `~/.asdf/shims/npm`, fnm dirs, `~/.nvm/versions/node/*/bin/npm`, `/usr/local/bin/npm`, `/opt/homebrew/bin/npm`, then `which npm`. On a Fedora system where Node isn't installed at all (and Hermes Agent uses Python via `uv`), all candidates fail and `findNpm()` returns the literal string `"npm"` (claw3d.ts:291), causing `spawn("npm", ...)` to fail with ENOENT.

**Detection:** capture from app log:

```
Failed to run npm: spawn npm ENOENT
# or
Dev server exited with code 127
```

**Fix on user side:** install Node.js. On Fedora:

```bash
sudo dnf install nodejs npm
```

**Fix on app side (improvement):** if `findNpm()` returns the bare `"npm"` string fallback (line 291), surface a clear "Node.js / npm not found. Office requires Node.js." error in the UI, with an install command for the user's platform. Currently the failure is buried inside a `spawn` error message.

#### 2.3 `hermes-office` repo's `package.json` lacks `hermes-adapter` script

If the upstream `fathah/hermes-office` repo has been refactored and the `hermes-adapter` script has been renamed or removed, `startAdapter()` (claw3d.ts:519-568) calls `npm run hermes-adapter` and gets exit code 1 with `npm ERR! Missing script: "hermes-adapter"`. The error message is captured in `adapterError` (claw3d.ts:550-554) and visible via `claw3dStatus()`.

**Detection:** in the Office UI, the error banner would show `npm ERR! Missing script: "hermes-adapter"`. Or run:

```bash
cd ~/.hermes/hermes-office
cat package.json | jq .scripts
```

If `hermes-adapter` is missing, the upstream repo has drifted from what `claw3d.ts` expects. This is a **maintenance gap** — the desktop app's claw3d.ts assumes a contract that the upstream office repo can break.

**Fix on user side:** `cd ~/.hermes/hermes-office && git pull && npm install` to get the latest. If `hermes-adapter` is still missing, this is upstream-Office's regression.

**Fix on app side (long-term):** pin the `hermes-office` clone to a known-compatible tag / commit, or version-detect and adapt; ideally publish `hermes-office` as an npm package or a release artifact rather than `git clone`-ing main.

#### 2.4 Port 3000 already in use

Common scenario: another dev server on port 3000. `getClaw3dStatus()` returns `portInUse: true` and `startDevServer()` exits with EADDRINUSE.

**Fix on user side:** Settings inside the Office tab → change port to e.g. 3030.

**Fix on app side (improvement):** auto-pick a free port on first install if 3000 is in use.

#### 2.5 First-time setup is heavy and silent

`setupClaw3d()` (claw3d.ts:295-419) does `git clone` + `npm install`. On a slow connection or an old machine, this can take 5+ minutes. The UI shows progress, but if the user clicks elsewhere and back, the polling logic (`Office.tsx:74-93`) only runs while the tab is `visible`, so progress can appear stalled.

**Fix on app side:** keep polling regardless of tab visibility while in `installing` state.

### Verification protocol for the user

1. **Mode check:** Settings → Connection. If "Remote" is selected: this is likely Issue 2.1 — switch to Local for Office, or accept that Office doesn't work in Remote mode.
2. **Node.js installed?** `command -v node && command -v npm`. If either missing → `sudo dnf install nodejs npm`.
3. **Office cloned & installed?** `ls ~/.hermes/hermes-office/node_modules | head` — if directory missing or empty, click "Install" in the Office tab and watch the log pane.
4. **Adapter script present?** `cd ~/.hermes/hermes-office && jq .scripts package.json` — confirm `hermes-adapter` exists.
5. **Port 3000 free?** `ss -ltn 'sport = :3000'` — should be empty.
6. **Manual smoke test:**
   ```bash
   cd ~/.hermes/hermes-office
   npm run dev   # in one terminal
   # in another: open http://localhost:3000 in a browser, see if it loads
   ```
   If the browser-direct test works but the in-app webview doesn't, the issue is webview integration (CSP, sandbox flags, etc.) — different investigation.

### Proposed fixes (app side, prioritized)

| # | Fix | Effort | Value |
|---|---|---|---|
| F-2.1 | Gate Office tab on `isRemoteMode() === false`; show explanatory message + "Switch to Local" CTA | XS (1 file, ~15 lines) | **High** — prevents Issue 2.1 |
| F-2.2 | Detect missing `npm` in `findNpm()` and surface a typed error like `{ kind: "npm-missing" }` to the UI | S (2 files, ~25 lines) | High — actionable error |
| F-2.3 | Detect missing `hermes-adapter` script during status check and surface a typed error | S (1 file, ~15 lines) | High — actionable error |
| F-2.4 | Auto-pick free port on first setup (try 3000, 3001, … 3010) | S (1 file, ~20 lines) | Medium |
| F-2.5 | Pin `hermes-office` clone to a known commit or release tag | M (architectural) | Medium |
| F-2.6 | Keep setup-progress polling alive even when tab not visible | XS | Low |

---

## Cross-cutting observations

1. **Both modules suffer from generic error messages.** "Could not reach server" / "Failed to run npm: ..." flatten distinct failure modes into the same surface, making support harder. A typed-error pattern (`{ kind: 'auth-failed' | 'unreachable' | 'no-npm' | 'missing-script' | ... }`) plumbed from main → renderer would dramatically improve diagnosability.

2. **Remote mode is a partial feature.** Issue 1 shows the chat path is wired (`isRemoteMode()` is checked in `sendMessage` at hermes.ts:588). Issue 2 shows Office isn't. A consistent "remote-mode capability matrix" — which features work, which don't, with explicit UI gating — would be valuable. Likely future PR.

3. **Both issues could be flagged by an integration smoke test.** A `tests/integration/` suite that boots the app, switches to remote mode pointing at a mock HTTP 200 `/health`, and asserts that (a) the remote chat path is taken, (b) Office shows the gating message — would catch regressions on both fronts.

---

## Recommended next steps

If the user is debugging right now:

- **Issue 1:** run the verification protocol top-to-bottom. Most likely culprit is 1.2 (Hermes inside Docker bound to 127.0.0.1).
- **Issue 2:** confirm whether you're in remote mode. If yes, that's the cause — Office doesn't support remote mode today. Switch to local for Office. If still failing in local mode, run the Issue 2 verification protocol; most likely culprit is 2.2 (npm not installed) on a fresh Fedora system.

If the user wants to **fix** these in the desktop app (a separate PR from `feat/winget-rpm-release`):

- **Smallest impactful PR:** F-2.1 (gate Office on local mode) + F-1.1 (URL validation) + F-1.2 (typed connection-test errors). Roughly 80 lines across 3 files. High UX win, no architectural change.
- **Medium PR:** add F-2.2 / F-2.3 (typed errors for `npm` and missing scripts). Closes the most common silent-failure modes.
- **Long-term:** F-2.5 (pin `hermes-office` version) and an integration smoke test. Architectural — needs upstream coordination.

---

## Appendix: relevant file paths

- `src/main/config.ts:8-52` — `ConnectionConfig` interface and persistence
- `src/main/hermes.ts:17-37` — `LOCAL_API_URL`, `getApiUrl()`, `isRemoteMode()`, `getRemoteAuthHeader()`
- `src/main/hermes.ts:88-108` — `ensureApiServerConfig()` (local config writer)
- `src/main/hermes.ts:585-602` — `sendMessage()` remote-vs-local routing
- `src/main/hermes.ts:753-777` — `testRemoteConnection()`
- `src/main/claw3d.ts:15-22` — Office repo URL, dirs, default port, default WS URL
- `src/main/claw3d.ts:74-122` — `writeClaw3dSettings()` config emitter
- `src/main/claw3d.ts:234-293` — `findNpm()` cross-platform npm discovery
- `src/main/claw3d.ts:443-496` — `startDevServer()`
- `src/main/claw3d.ts:519-568` — `startAdapter()`
- `src/renderer/src/screens/Settings/Settings.tsx:309-342` — Connection UI handlers
- `src/renderer/src/screens/Office/Office.tsx:1-100` — Office state machine
