# Scheduled jobs

The Schedules screen presents Hermes cron jobs consistently across local files, the remote API, and named SSH profiles.

Jobs explicitly marked `completed` keep that terminal state even though Hermes also disables them. Other disabled jobs are normalized as paused by [[src/main/cronjobs.ts#listCronJobs]]. Named-profile SSH lists use [[src/main/cronjobs.ts#parseCronListOutput]] and mark completed jobs disabled too, so active-only lists exclude terminal jobs across transports.

## Remote dashboard requests

Direct remote schedules use the shared OAuth or token boundary and the selected profile. Legacy gateway fallback keeps the original connection and credentials, with named profiles routed through the gateway profile prefix.

[[src/main/cronjobs.ts#listCronJobs]] and mutations prefer dashboard cron routes. Explicit default-profile queries avoid the dashboard's all-profile list default. Only unsupported routes or an unconfigured keyless token transport permit a legacy fetch.

Token dashboard connection tests use public status only for discovery, then verify a protected session-list route with the candidate session-token header. Raw gateway health is public too, so gateway tests verify protected model access with the candidate Bearer token. Existing OAuth discovery remains separate from native sign-in.

## Test specifications

These tests protect state normalization at the boundary between Hermes cron data and the desktop schedule model.

### Completed jobs remain completed

A disabled API job whose source state is `completed` is normalized as completed rather than paused, preserving the terminal-state badge and actions in the renderer.

### Completed SSH jobs stay disabled

Named-profile SSH output retains completed states with `enabled: false`, and active-only requests exclude those terminal jobs.

### Local terminal-state normalization

Reading a real local jobs file preserves completed states, keeps paused and legacy-disabled jobs disabled, and filters active-only results without modifying the stored job data.

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

### Gateway token validation

A gateway public health response cannot validate a token; connection tests require protected model access with the candidate Bearer token before declaring the gateway connection successful.
