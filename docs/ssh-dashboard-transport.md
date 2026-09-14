# SSH dashboard transport — design for full support (issue #667)

Status: **design / not yet implemented.** A reliable legacy-HTTP fallback shipped first (see
"Shipped now" below). This document captures the design for making the _dashboard_ chat transport
(profile switching, session history, slash commands, background prompts) work over an SSH tunnel.

## Background: why SSH dashboard chat is broken

The desktop's dashboard chat transport speaks WebSocket JSON-RPC at **`/api/ws`**
(`src/renderer/src/screens/Chat/dashboardGatewayClient.ts`, URL built in `src/main/dashboard.ts`).

In `hermes-agent`, `/api/ws` is served **only** by `hermes dashboard`
(`hermes_cli/web_server.py` → `start_server`, gated by `_DASHBOARD_EMBEDDED_CHAT_ENABLED = True`). It is
**never** served by `hermes gateway` (`gateway/...`, the api_server, which serves `/v1/chat/completions`,
`/health`, etc.).

But SSH mode today:

1. Starts `hermes gateway start` on the remote — `buildGatewayStartCommand` in `src/main/ssh-remote.ts`.
2. Tunnels the **gateway** port (`config.remotePort`, default 8642) — `ensureSshTunnel` in
   `src/main/ssh-tunnel.ts`.
3. Connects `ws://127.0.0.1:{tunnelPort}/api/ws` — which 404s on the gateway.

A second, independent blocker: `/api/ws` authenticates with `HERMES_DASHBOARD_SESSION_TOKEN`
(`web_server.py` `_SESSION_TOKEN`; `?token=<…>` on loopback), but the SSH path passes the remote
`API_SERVER_KEY` (`sshReadRemoteApiKey` in `src/main/ssh-remote.ts`). Even a correctly-tunneled
dashboard would reject the WS upgrade.

## Shipped now: reliable legacy fallback

`src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts` now latches a sticky
`dashboardUnavailableRef` on the first failed `ensureClient` for a remote/SSH connection, so subsequent
messages fall back to the working legacy HTTP transport (`/v1/chat/completions` through the tunnel)
_immediately_ instead of re-running the multi-second status+probe each time. It also fires
`onDashboardUnavailable` once, which `Chat.tsx` surfaces as a one-time toast. The flag resets on any
connection change. This makes SSH chat **work** (degraded: no profile switching / session history /
dashboard slash commands).

## Full design: run a remote `hermes dashboard` and tunnel it

Goal: restore the dashboard transport over SSH by talking to a real remote `hermes dashboard`.

### 1. Start the remote dashboard (not the gateway)

Add `sshStartDashboard(config, sessionToken, port)` in `src/main/ssh-remote.ts`, mirroring
`buildGatewayStartCommand`. It should run, detached:

```
HERMES_DASHBOARD_SESSION_TOKEN=<sessionToken> \
  nohup hermes dashboard --no-open --host 127.0.0.1 --port <port> \
  > $HOME/.hermes/dashboard.log 2>&1 &
```

This mirrors the **local** spawn in `src/main/hermes.ts:559` (`dashboard --no-open --host 127.0.0.1
--port <port>`, gated by `HERMES_DASHBOARD_SESSION_TOKEN`) — reuse that flag/arg shape. Add a matching
status/stop command pair (`buildDashboardStatusCommand` / `buildDashboardStopCommand`).

### 2. Tunnel the dashboard port (in addition to / instead of the gateway port)

The legacy fallback still needs the gateway tunnel for `/v1/chat/completions`, while the dashboard
transport needs the dashboard's `/api/ws` + `/api/sessions` + `/api/status`. Options:

- **Second forward**: generalize `ensureSshTunnel` / `getSshTunnelUrl` in `src/main/ssh-tunnel.ts` to
  manage a named set of forwards (gateway + dashboard), each `localPort → 127.0.0.1:remotePort`.
- Remote dashboard port: pick a free remote port over SSH (run a tiny Python one-liner like the
  existing helpers in `ssh-remote.ts`) or document a fixed default; surface it in the SSH config UI.

### 3. Authenticate `/api/ws` with the session token

The desktop generates a `sessionToken` (e.g. `randomUUID()`), exports it to the remote dashboard's env
(step 1), and builds the WS URL as `ws://127.0.0.1:{dashTunnelPort}/api/ws?token=<sessionToken>` —
replacing `API_SERVER_KEY`. Rewrite `sshDashboardConnectionFromConfig` in `src/main/dashboard.ts` to
this flow (it currently calls `sshStartGateway` + `sshReadRemoteApiKey`). Note `web_server.py`'s
`_ws_auth_ok` accepts the `?token=` query only on loopback / `--insecure`; over the SSH tunnel the
endpoint is loopback on the remote, so this should hold — **verify on a real host**.

### 4. Compatibility

`ensureSshDashboardCompatibility` (`src/main/hermes-agent-compat.ts`) already patches `web_server.py`'s
embedded-chat default and `/api/model/set`; keep it. Confirm the remote `hermes` build accepts
`dashboard --no-open --host --port` and the `HERMES_DASHBOARD_SESSION_TOKEN` env (v0.16.0 has
`_DASHBOARD_EMBEDDED_CHAT_ENABLED = True`, so embedded chat is available).

### 5. Lifecycle

- Stop the remote `hermes dashboard` on disconnect / app quit (best-effort, like `sshStopGateway`).
- Health-check the dashboard (`/api/status` through the tunnel) and restart on failure.
- Keep the gateway running too if other features depend on it.

## Testing

- **Unit**: command builders (`sshStartDashboard` / status / stop) and the multi-forward tunnel wiring,
  following the existing `ssh-remote` / `ssh-tunnel` test patterns.
- **Manual E2E (required before merge)**: an SSH host running `hermes-agent` (see
  `docs/SSH-TUNNEL-VPS.md`). Verify: tunnel up → dashboard starts remotely → `/api/ws` connects with the
  session token → a sent message streams back → profile switching and session history work. This step
  cannot be exercised without a real remote host.
