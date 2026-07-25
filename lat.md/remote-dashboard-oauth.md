# Remote Dashboard OAuth

Direct Remote mode detects browser-authenticated Hermes dashboards and connects without exposing OAuth credentials to renderer code.

## Authentication selection

The public dashboard status endpoint selects token or OAuth behavior automatically for direct Remote connections.

[[src/main/remote-oauth.ts#probeRemoteAuthMode]] reads `/api/status`; `auth_required: true` selects OAuth. The detected mode is persisted as bounded configuration state. Token Remote mode and SSH token transport remain unchanged.

The public startup probe uses `/api/status` without a stored token after OAuth is selected, avoiding the authenticated `/health` redirect and stale-token false negatives.

## Credential boundary

OAuth cookies live only in a dedicated persistent Electron session owned by main process.

[[src/main/remote-oauth.ts#REMOTE_OAUTH_PARTITION]] identifies `persist:hermes-remote-oauth`. [[src/main/remote-oauth.ts#openRemoteOAuthLogin]] opens sandboxed `/login`; preload exposes only login, logout, probe, and signed-in state.

[[src/main/remote-oauth.ts#requestRemoteOAuthJson]] uses Electron `net` with that session and `useSessionCookies: true`. Cookies, refresh tokens, and WebSocket tickets never enter renderer state or desktop configuration.

After the browser flow returns, [[src/main/remote-oauth.ts#connectionConfigAfterRemoteOAuthLogin]] re-reads the current configuration. It commits OAuth mode only when Remote mode and the normalized gateway URL still match, preserving newer settings.

[[src/main/hermes.ts#getRemoteAuthHeader]] suppresses stored Remote bearer keys whenever OAuth is selected. The key may remain saved for later token mode, but OAuth chat and auxiliary requests cannot reuse it.

## WebSocket ticket lifecycle

Every OAuth WebSocket attempt receives a new single-use ticket immediately before connection.

[[src/main/dashboard.ts#freshDashboardWebSocketUrl]] calls [[src/main/remote-oauth.ts#mintRemoteOAuthWsTicket]] for OAuth connections. Readiness probing consumes its own ticket; renderer reconnects request another through bounded IPC.

For non-loopback HTTP gateways, [[src/main/dashboard-websocket-relay.ts#createLoopbackWebSocketRelay]] proxies one WebSocket through a random-capability loopback URL. The renderer CSP permits loopback WebSockets, never arbitrary `ws:` origins.

## Session data routing

Remote session history uses the same selected authentication transport as management APIs.

[[src/main/remote-sessions.ts#remoteRequestJson]] routes direct OAuth session lists, search, messages, media, titles, and deletion through the persistent cookie partition. Token and SSH session requests retain the session-token header.

## Authenticated management request boundary

Direct Remote management features share one main-process request client that selects cookie or token authentication without exposing reusable credentials through IPC.

[[src/main/remote-api.ts#remoteDashboardRequestJson]] resolves `auto` through the public status probe, routes OAuth through the persistent Electron partition, and routes token mode through `X-Hermes-Session-Token`. Probe failures never guess another transport or fall back to local state.

[[src/main/remote-api.ts#RemoteDashboardApiError]] normalizes HTTP status for feature adapters. A `404` marks only that feature unsupported; OAuth login-required errors retain their original reauthentication signal.

## Failure behavior

Missing or expired OAuth sessions stop Remote chat and request browser sign-in without falling back to local state or legacy `/v1`.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] marks OAuth login-required errors as dashboard-reachable failures. Settings hides Legacy transport for OAuth and provides Sign in and Sign out actions.

## Test specifications

Focused tests protect credential isolation, automatic routing, ticket freshness, no-fallback behavior, and Settings presentation.

### Cookie session boundary

Session recognition accepts only Hermes access or refresh cookie names and keeps cookie-backed requests inside the selected Electron partition.

### OAuth dashboard readiness

OAuth status requires a signed-in cookie session, authenticates REST without token headers, and probes WebSocket with a disposable ticket.

### Fresh ticket per connection

Every initial or reconnect attempt requests a new ticket URL, while token dashboards retain their stable token URL.

### OAuth no-fallback

Login-required Remote chat errors reach user-visible failure handling and never enter legacy `/v1` fallback.

### Settings authentication state

Settings probes auth automatically, shows browser sign-in for OAuth, preserves token input for token gateways, and handles cancellation without false connected state.

### Post-login config revalidation

OAuth login preserves settings changed while the browser is open and rejects completion when the selected gateway or connection mode changed.

### Loopback WebSocket confinement

Insecure remote WebSockets use a one-shot loopback relay with an unguessable path, while renderer CSP excludes the wildcard `ws:` source.

### OAuth bearer suppression

Once a Remote connection resolves to OAuth, shared request headers omit any stored token while token and SSH authentication remain unchanged.

### Management authentication routing

Management requests resolve `auto` before selecting token or OAuth transport, preserve profile scoping, skip probing for explicit modes, reject non-Remote callers, and retain OAuth login-required errors for reauthentication.

### Management failure classification

Token and OAuth HTTP failures expose the same structured status, with `404` identified as an unsupported feature instead of an application-wide connection failure.
