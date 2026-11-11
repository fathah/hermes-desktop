# Scheduled jobs

The Schedules screen presents Hermes cron jobs consistently across local files, the remote API, and named SSH profiles.

Jobs explicitly marked `completed` keep that terminal state even though Hermes also disables them. Other disabled jobs are normalized as paused by [[src/main/cronjobs.ts#listCronJobs]]. Named-profile SSH lists use [[src/main/cronjobs.ts#parseCronListOutput]] and mark completed jobs disabled too, so active-only lists exclude terminal jobs across transports.

## Remote dashboard requests

Direct remote schedules use the shared OAuth or token boundary and the selected profile. Legacy gateway fallback keeps the original connection and credentials, with named profiles routed through the gateway profile prefix.

[[src/main/cronjobs.ts#listCronJobs]] and mutations prefer dashboard cron routes. Explicit default-profile queries avoid the dashboard's all-profile list default. Only unsupported routes or an unconfigured keyless token transport permit a legacy fetch.

[[src/main/dashboard-api-url.ts#dashboardApiUrl]] is the shared, runtime-independent URL builder. Schedule adapters use it without initializing session storage or locale configuration; the session bridge keeps its existing export for callers.

Token dashboard connection tests use public status only for discovery, then verify a protected session-list route with the candidate session-token header. Raw gateway health is public too, so gateway tests verify protected model access with the candidate Bearer token. Existing OAuth discovery remains separate from native sign-in.

A fresh Agent 0.23.1 can return a non-HTML session-list 503 before its first session initializes the database. Only that response permits a read-only protected profiles probe with the same candidate headers. Profiles must succeed; authentication denials, other statuses, HTML and network failures never trigger this fallback.

## Fresh dashboard transport readiness

Remote token, OAuth and SSH chat readiness verifies protected access before probing the chat WebSocket, including when a fresh Agent has not created its session database.

[[src/main/dashboard.ts#verifyDashboardProtectedAccess]] retries only a typed, non-HTML session-list 503 against `/api/profiles` on the identical authenticated transport. Token and SSH retain their session headers; OAuth retains the main-process cookie partition and login-required errors. The fallback never switches credentials, creates a session or uses anonymous HTTP.

HTTP errors carry structured status and HTML classification; response text cannot authorize a fallback. A successful profiles probe still requires [[src/main/dashboard.ts#probeDashboardWebSocket]], with a freshly minted ticket for OAuth. HTML, interrupted responses and authentication failures remain errors.

## Run history

An expanded job shows its newest runs and bounded plain-text output, owned by the selected connection and profile.

[[src/main/cronjobs.ts#listCronRuns]] and [[src/main/cronjobs.ts#getCronRunOutput]] resolve the existing main-issued editor target before reading and after deferred replies. Private settings and OAuth account changes revoke it. Dashboard reads include an explicit default or named profile, support resolved anonymous token dashboards and Basic proxies, and never fall back from OAuth failure to bare fetch.

Remote output requires membership in the job's newest 100-run window before reading session messages. A 500-message page is marked partial; hidden display messages are omitted. The current Agent exposes cron sessions, not script-file output. Servers returning script-preview rows expose only a preview, always marked partial. Local history reads newest regular files without following file symlinks, with bounded previews and a 200,000-character output cap. SSH history is explicitly unsupported.

[[src/renderer/src/screens/Schedules/CronRunHistory.tsx#CronRunHistory]] cancels obsolete reads on configuration, profile, connection and open-run changes. Refresh reloads both the expanded list and open output. The Layout Schedules key follows connection, profile and semantic settings identity; display-label notifications preserve its pane.

## Test specifications

These tests protect state normalization at the boundary between Hermes cron data and the desktop schedule model.

### Completed jobs remain completed

A disabled API job whose source state is `completed` is normalized as completed rather than paused, preserving the terminal-state badge and actions in the renderer.

### Completed SSH jobs stay disabled

Named-profile SSH output retains completed states with `enabled: false`, and active-only requests exclude those terminal jobs.

### Local terminal-state normalization

Reading a real local jobs file preserves completed states, keeps paused and legacy-disabled jobs disabled, and filters active-only results without modifying the stored job data.

An explicit local connection fixture isolates these tests from the desktop connection registry and user configuration.

### Selected remote profile

Dashboard cron reads and every mutation use the selected profile, including an explicit default profile, so one agent cannot operate on another agent's scheduled jobs.

### Fallback retains its target

A delayed unsupported-route reply followed by a connection change still sends the gateway mutation to its original server, credentials, and named profile.

### OAuth failures remain authenticated

Auto-mode OAuth login or probe failures never retry through bare fetch, preventing unauthenticated requests or misleading success after authentication fails.

### Anonymous dashboard profile routing

Anonymous dashboard requests select profiles through a query parameter; the gateway profile prefix is reserved for fallback routes to prevent named-profile requests from hitting a dashboard SPA page.

### Anonymous HTML actions fail

An HTML success response from an anonymous dashboard fails the operation, so the desktop cannot report that a destructive cron mutation completed when only a sign-in or SPA page was returned.

### SSH default profile isolation

SSH dashboard cron requests explicitly select the default profile, including the probed-tunnel fallback, so the dashboard's all-profile default cannot mix another agent's jobs into Schedules.

### Dashboard token validation

A public dashboard status response cannot validate a candidate token; connection tests reject unauthorized session-list requests and accept the candidate only when protected access succeeds.

### Fresh dashboard token validation

A real HTTP fixture simulates a fresh Agent with unavailable sessions and verifies profiles accepts only the valid candidate token. Both protected probes receive the same candidate headers without borrowing another saved server's credentials.

### Session probe refusals

Session authentication denials, other server errors, HTML and network failures cannot trigger a profiles retry, even when that route would succeed.

### Fresh profile probe refusals

A fresh dashboard remains rejected when the fallback profiles probe denies authentication, returns HTML or a server error, or loses its connection. A session-list 503 alone never establishes readiness.

### OAuth discovery remains separate

An existing OAuth connection still discovers the public dashboard status without token probes; native sign-in remains responsible for its authentication.

### Dashboard fresh-store transport

Real HTTP fixtures verify Remote and SSH readiness accepts unavailable fresh sessions only after protected profiles access, keeps candidate credentials on both requests and still probes WebSocket. Existing session stores keep their original path.

### Dashboard session readiness refusals

Remote and SSH session authentication denials, other server errors, HTML, malformed JSON and network failures cannot trigger profiles or WebSocket probes. Error text mentioning 503 has no authority.

### Dashboard profile readiness refusals

Remote and SSH readiness stays false when fallback profiles access fails authentication, returns HTML or malformed JSON, has a server error or loses its connection. No WebSocket attempt follows failed protected access.

### Dashboard WebSocket readiness

Fresh-store protected profiles access cannot report a running dashboard when the actual chat WebSocket refuses its upgrade.

### OAuth fresh-store readiness

Fresh-store OAuth retries profiles through the cookie request client and then probes a freshly minted ticket WebSocket; no token or anonymous HTTP request replaces either cookie-backed read.

### OAuth fresh-store refusal boundary

OAuth authentication denials, other statuses, HTML, interrupted responses and unstructured errors never retry profiles, mint a ticket or switch to token transport.

### OAuth fresh-store login expiry

An expired OAuth session discovered by fallback profiles remains a login-required failure and cannot proceed to WebSocket ticket creation.

### OAuth HTTP response classification

OAuth HTTP errors preserve status and HTML classification from headers or body so fresh-store decisions use trusted response metadata while 401 retains its existing login-required signal.

### Gateway token validation

A gateway public health response cannot validate a token; connection tests require protected model access with the candidate Bearer token before declaring the gateway connection successful.

### History profile and authentication

Default and named history reads use dashboard profile queries and the selected authenticated transport. Resolved anonymous token dashboards normalize URLs and Basic credentials, while OAuth failures and malformed successful responses remain failures.

### History target authority

Stale queued targets, changed credentials, deferred authentication probes, old-server replies and OAuth account changes cannot read or display history under a newer target.

### History output ownership and limits

Output requires membership in the requested job's history, rejects invalid response shapes, respects projected display messages and marks a full bounded message page as partial.

### Local history bounds

Only the newest bounded page of regular local output files is previewed. Full output reads are capped, traversal and file symlinks are refused, and invalid limits cannot request the entire archive.

### Open output refresh

Refreshing jobs reloads an already-open run's output, so a completed run cannot keep showing text from its earlier active state.

### History view lifetime

Late list and output replies cannot overwrite a changed connection, profile, configuration or opened run. A refreshed missing run closes its output and real errors remain visible.

### Schedules parent target changes

The actual Layout preserves the Schedules pane on display-label notifications and replaces it on a connection or private settings change, so old job labels and drafts cannot be reused for a new target.

### Dashboard URL normalization

The shared builder removes legacy API suffixes and saved query or fragment data, retains proxy credentials and ports, and rejects missing or invalid URLs without loading desktop configuration.

### Dashboard URL profile routing

Named profiles are query-scoped without replacing explicit profile choices or other request parameters; default-profile callers retain their existing explicit or omitted query behavior.

### History automatic proxy authentication

Actual discovery and cron requests pass a Basic proxy together for anonymous and token dashboards, preserve default and named profile queries, and keep dashboard tokens out of public discovery.

### History proxy authentication refusal

Proxy 401 or 403 replies stop before history access; auto-selected OAuth failures stay on cookie transport without retrying an anonymous cron request.

### History deferred proxy target

Private settings changed while a real proxy discovery reply is pending revoke the captured history target before any cron request can be admitted.
