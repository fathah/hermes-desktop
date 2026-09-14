# Remote Dashboard OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic OAuth browser authentication for direct Remote-mode Hermes dashboards while preserving token Remote mode and SSH behavior.

**Architecture:** A focused Electron main-process module owns the persistent OAuth session, login window, cookie-authenticated REST, and single-use WebSocket tickets. Dashboard resolution selects token or OAuth behavior from `/api/status`; renderer receives only bounded auth state and a fresh connection URL.

**Tech Stack:** Electron 39 (`session`, `net`, `BrowserWindow`), TypeScript 5.9, React 19, Vitest 4, Node HTTP/WebSocket tests, lat.md.

## Global Constraints

- Direct Remote mode only; SSH mode remains unchanged.
- Authentication mode is detected automatically from public `GET /api/status`.
- OAuth cookies and refresh tokens never cross IPC or enter `desktop.json`.
- OAuth WebSocket tickets are freshly minted before every connection attempt.
- OAuth failure never falls back to local gateway or legacy `/v1` transport.
- Existing token Remote mode remains compatible.
- Production code follows failing-test-first TDD.
- Existing untracked `.npmrc` remains untouched.

---

### Task 1: Remote OAuth session boundary

**Files:**

- Create: `src/main/remote-oauth.ts`
- Create: `tests/remote-oauth.test.ts`

**Interfaces:**

- Produces: `REMOTE_OAUTH_PARTITION`, `RemoteOAuthError`, `remoteOAuthSessionState(baseUrl)`, `openRemoteOAuthLogin(baseUrl, parent?)`, `clearRemoteOAuthSession(baseUrl)`, `requestRemoteOAuthJson(url, options?)`, `mintRemoteOAuthWsTicket(baseUrl)`, `buildRemoteOAuthWsUrl(baseUrl, ticket)`.
- Depends on: Electron `app`, `session`, `net`, and `BrowserWindow`; normalized HTTP(S) URL input.

- [ ] **Step 1: Write failing cookie-state and URL tests**

Add tests proving access cookie or refresh cookie means signed in, unrelated cookies do not, HTTPS maps to WSS, HTTP maps to WS, and invalid protocols fail.

```ts
expect(cookiesHaveRemoteOAuthSession([{ name: "hermes_session_rt" }])).toBe(
  true,
);
expect(cookiesHaveRemoteOAuthSession([{ name: "other" }])).toBe(false);
expect(buildRemoteOAuthWsUrl("https://host", "once")).toBe(
  "wss://host/api/ws?ticket=once",
);
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run tests/remote-oauth.test.ts`

Expected: failure because `src/main/remote-oauth.ts` does not exist.

- [ ] **Step 3: Implement session lookup and pure helpers**

Use `persist:hermes-remote-oauth`; recognize bare and host-prefixed `hermes_session_at` / `hermes_session_rt` names; normalize only HTTP(S) URLs; derive ticket WebSocket URL from gateway origin.

- [ ] **Step 4: Write failing authenticated-request and ticket tests**

Inject or mock Electron session/net boundaries. Assert `useSessionCookies: true`, selected persistent session, POST `/api/auth/ws-ticket`, malformed response rejection, and 401 mapping to `RemoteOAuthError` with code `oauth_login_required`.

- [ ] **Step 5: Verify RED, then implement minimal request/ticket behavior**

Run: `npm test -- --run tests/remote-oauth.test.ts`

Implement JSON serialization, timeout/abort, status handling, HTML rejection, ticket validation, and structured errors. Re-run until green.

- [ ] **Step 6: Write failing login lifecycle and scoped sign-out tests**

Assert sandboxed `BrowserWindow` preferences, `/login` navigation, cookie completion, cancellation error `oauth_cancelled`, and removal of only cookies returned for selected gateway URL.

- [ ] **Step 7: Implement login and sign-out; verify Task 1**

Run: `npm test -- --run tests/remote-oauth.test.ts`

Expected: all Task 1 tests pass.

### Task 2: Authentication-mode detection and public IPC

**Files:**

- Modify: `src/main/config.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `tests/connection-config-security.test.ts`
- Modify: `tests/preload-api-surface.test.ts`
- Create: `tests/remote-auth-mode.test.ts`

**Interfaces:**

- Produces: `RemoteAuthMode = "auto" | "token" | "oauth"`; public `remoteAuthMode`; preload operations `probeRemoteAuthMode`, `remoteOAuthLogin`, `remoteOAuthLogout`, `remoteOAuthSessionState`, `freshDashboardWsUrl`.
- Consumes: Task 1 remote OAuth functions and existing connection-config normalization.

- [ ] **Step 1: Write failing config normalization tests**

Assert missing/unknown values normalize to `auto`; `token` and `oauth` survive; public config exposes mode and boolean state only, never secrets.

- [ ] **Step 2: Verify RED, then add minimal config types**

Run: `npm test -- --run tests/connection-config-security.test.ts tests/remote-auth-mode.test.ts`

Add normalized config field without changing existing configuration semantics.

- [ ] **Step 3: Write failing IPC/preload surface tests**

Assert bounded methods exist, arbitrary partitions/cookie reads do not, URLs are validated in main process, and OAuth endpoints operate only for configured direct Remote URL.

- [ ] **Step 4: Implement IPC/preload bridge and verify Task 2**

Run: `npm test -- --run tests/connection-config-security.test.ts tests/preload-api-surface.test.ts tests/remote-auth-mode.test.ts`

Expected: all Task 2 tests pass.

### Task 3: OAuth-aware dashboard transport

**Files:**

- Modify: `src/main/dashboard.ts`
- Modify: `tests/dashboard-remote.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Interfaces:**

- Produces: OAuth-capable `DashboardConnection` with `authMode`; `freshDashboardWebSocketUrl(profile?)` that returns static token URL or newly minted OAuth ticket URL.
- Consumes: Task 1 OAuth requests/ticket minting; Task 2 configured/detected auth mode.

- [ ] **Step 1: Write failing OAuth dashboard-status tests**

Test public status `{ auth_required: true }`, signed-out result with `needsOAuthLogin`, cookie-authenticated `/api/sessions`, ticket-based WebSocket probe, and no token header/query use.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run tests/dashboard-remote.test.ts`

Expected: current hard-coded “not wired” result fails OAuth expectations.

- [ ] **Step 3: Implement OAuth connection resolution**

Retain token branch. OAuth branch checks session, requests authenticated sessions, mints one ticket for probe, and returns structured status. SSH branch remains token-only and unchanged.

- [ ] **Step 4: Write failing fresh-ticket tests**

Call `freshDashboardWebSocketUrl()` twice and assert two ticket endpoint calls/two URLs. Token mode returns existing URL without minting.

- [ ] **Step 5: Implement fresh URL function and verify Task 3**

Run: `npm test -- --run tests/dashboard-remote.test.ts tests/dashboard-gateway-client.test.ts`

Expected: all Task 3 tests pass.

### Task 4: Renderer reconnect path and Settings UX

**Files:**

- Modify: `src/renderer/src/screens/Chat/dashboardGatewayClient.ts`
- Modify: `src/renderer/src/screens/Chat/dashboardGatewayClient.test.ts`
- Modify: `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts`
- Modify: `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx`
- Modify: `src/renderer/src/components/settings/useSettingsData.ts`
- Modify: `src/renderer/src/components/settings/ConnectionPane.tsx`
- Modify: `src/shared/i18n/locales/en/settings.ts`
- Modify corresponding non-English settings locale files with English fallback copy where project convention requires key parity.
- Add or modify focused Settings tests under `src/renderer/src/components/settings/`.

**Interfaces:**

- Consumes: Task 2 OAuth IPC and Task 3 `freshDashboardWsUrl`.
- Produces: automatic token/OAuth Settings states and fresh URL before every renderer WebSocket connection.

- [ ] **Step 1: Write failing reconnect test**

Assert each initial/reconnect client creation asks preload for a fresh URL; OAuth login-required error stops fallback and reaches UI callback; token URL behavior remains valid.

- [ ] **Step 2: Verify RED, implement minimal reconnect change, verify GREEN**

Run: `npm test -- --run src/renderer/src/screens/Chat/dashboardGatewayClient.test.ts src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx`

- [ ] **Step 3: Write failing Settings UX tests**

Test automatic probing, hidden API-key input for OAuth, Sign in, Sign out, connected state, cancellation, expiry, URL-change reprobe, and token input for non-OAuth gateway.

- [ ] **Step 4: Implement Settings state and copy**

Keep OAuth logic in `useSettingsData`; keep `ConnectionPane` presentational. Never store ticket/cookie values in React state.

- [ ] **Step 5: Verify Task 4**

Run focused Chat and Settings tests. Expected: all pass.

### Task 5: Architecture/test documentation and integrated verification

**Files:**

- Modify: `lat.md/main-process.md`
- Create or modify: `lat.md/remote-dashboard-oauth.md`
- Add `@lat:` references beside focused source tests.

**Interfaces:**

- Documents: auth split, cookie boundary, ticket lifecycle, no-fallback invariant, and test specifications.

- [ ] **Step 1: Add lat.md architecture and test sections**

Every heading receives a leading paragraph no longer than 250 characters. Test leaf sections map one-to-one to focused tests through `@lat:` comments.

- [ ] **Step 2: Run focused verification**

Run:

```bash
npm test -- --run tests/remote-oauth.test.ts tests/remote-auth-mode.test.ts tests/connection-config-security.test.ts tests/preload-api-surface.test.ts tests/dashboard-remote.test.ts tests/dashboard-gateway-client.test.ts src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx
npm run typecheck
```

Expected: zero failures and zero type errors.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
npm exec --yes --package=lat.md -- lat check
git diff --check
```

Expected: all tests pass, build exits zero, LAT reports all checks passed, diff check exits zero.

- [ ] **Step 4: Inspect final scope**

Confirm `git status --short` contains only intended feature/docs files plus pre-existing untracked `.npmrc`; inspect `git diff --stat` and secret scans for cookie/ticket logging or persistence.

- [ ] **Step 5: Commit implementation**

Stage only intended files and commit with `feat: support OAuth remote dashboards`.

### Task 6: P1 review remediation

**Files:**

- Modify: `src/main/remote-oauth.ts`
- Modify: `src/main/ipc/register.ts`
- Create: `src/main/dashboard-websocket-relay.ts`
- Modify: `src/main/dashboard.ts`
- Modify: `src/main/ws.d.ts`
- Modify: `src/main/app/start.ts`
- Modify: `src/main/hermes.ts`
- Modify: `src/renderer/index.html`
- Modify: `tests/remote-oauth.test.ts`
- Create: `tests/dashboard-websocket-relay.test.ts`
- Modify: `tests/dashboard-csp.test.ts`
- Modify: `src/main/hermes.test.ts`
- Modify: `lat.md/remote-dashboard-oauth.md`

**Interfaces:**

- Produces: post-login config revalidation and a capability-protected, one-shot loopback relay for insecure non-loopback dashboard WebSockets.
- Preserves: current connection changes, direct `wss:` transport, and loopback local/SSH transport.

- [ ] **Step 1: Add failing config-race and CSP/relay tests**

Prove login completion preserves current settings, rejects a changed gateway or mode, suppresses stale bearer headers in OAuth mode, forwards one WebSocket through loopback, rejects an invalid capability, and removes wildcard `ws:` from both CSP layers.

- [ ] **Step 2: Verify RED**

Run focused Vitest files. Expected: missing helper/relay exports and wildcard CSP assertions fail.

- [ ] **Step 3: Implement config revalidation and loopback relay**

Re-read connection configuration after interactive login. Suppress stored bearer keys while OAuth is active. Proxy only non-loopback `ws:` targets; wait for the target handshake before accepting the renderer connection, then bridge frames and close the listener.

- [ ] **Step 4: Verify focused behavior and security invariants**

Run focused tests, Node typecheck, `lat check`, and `git diff --check`. Confirm target URL and ticket never appear in the relay URL.

- [ ] **Step 5: Run integrated verification and restack dependent branches**

Run the full suite and build, commit the review fixes, push PR 853, rebase/push descendant branches with exact leases, then reply to and resolve the two review threads.
