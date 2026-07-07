# Hermes Desktop — Reliability, Currency, Autonomy, Reach, Console (Roadmap 2026-07-07)

## How This Was Derived

This roadmap is the document-only output of three exploration passes - update/upstream, reliability, and product value - plus one design pass. It is intentionally grounded in current Hermes Desktop source seams rather than a generic product wish list.

The owner request was steelmanned as:

> Make Hermes Desktop truly reliable and useful for one owner, keep its Hermes Agent core current with `NousResearch/hermes-agent`, grant useful autonomy when the desktop app is closed, reach the owner on the phone, and land the owner on an operator cockpit instead of another document.

The important finding is that the "update Hermes core" machinery is not the missing center. The repo already has most of the update loop shape: update checks, `hermes update`, contract verification, rollback support, upstream watch, and SPS What's-New cards across files such as `src/main/installer.ts`, `src/main/hermes-agent-updates.ts`, `src/main/hermes-upstream-watch.ts`, `src/shared/engine-contract.ts`, and `src/main/engine-contract-verify.ts`.

The real roadmap is therefore:

1. Close remaining silent-failure reliability gaps.
2. Harden the update channel around tagged releases and pre-launch verification, while refreshing stale bundled install scripts.
3. Let the agent perform owner-critical routines while the desktop app is closed.
4. Reach the owner's phone through configured channels, with Telegram as the mobile client.
5. Make Cockpit the home surface only after it can act as the owner console.

Ground-truth correction from the exploration notes: the gateway port module is `src/main/gateway-ports.ts`, and the contract manifest is `src/shared/engine-contract.ts`.

## Principles

- Working code only: every roadmap item has a verification surface before it is eligible to ship.
- Keep the desktop app single-owner optimized; avoid SaaS control-plane gravity.
- Use Hermes Agent as the agent runtime. Do not create a second headless desktop runtime.
- Prefer existing seams: SPS vault/tasks, engine cron jobs, launchd scheduler trigger, gateway messaging, update state, and Cockpit widgets.
- Every item should land as a small, reversible PR or commit series.
- Re-audit the exact source before implementation. This document is a roadmap, not permission to copy stale line numbers blindly.

## Phase 0 - Trust the Foundation

Goal: make local data and background work fail loudly or self-heal before adding more autonomy.

All Phase 0 items are parallelizable, but each should land separately.

### 0.1 Note-Index Self-Healing (M)

Problem: `src/main/note-index.ts` opens `.note-index.db` and only rebuilds when `count("notes") === 0`. Corruption can become permanent, and a rejected `getNoteIndexForRoot()` promise can poison the in-memory cache.

Change:

- Wrap `NoteIndex.open()` around the database open and initial scan path.
- On SQLite corruption or unreadable index startup, close the failed handle, delete `.note-index.db`, `.note-index.db-wal`, and `.note-index.db-shm`, then rebuild from markdown.
- Evict rejected promises from the `instances` cache in `getNoteIndexForRoot()` so the next request retries instead of replaying the failure.
- Keep markdown files as source of truth; SQLite remains rebuildable.

Verification:

- Add or extend focused note-index corruption tests where possible.
- Run `npm run verify:note-index`.
- Run `npm run typecheck`.

### 0.2 Atomic Writes Everywhere (S)

Problem: `src/main/utils.ts` has `safeWriteFile()` / `safeWriteFileAsync()`, but several persistence sites still write directly. The helper is atomic by rename, but should also fsync the temp file and parent directory for crash safety.

Change:

- Route persistence in `src/main/self-healing.ts`, `src/main/app-launcher.ts`, `src/main/active-work-runs.ts`, scheduler skip telemetry in `src/main/scheduler.ts`, and upstream-watch state in `src/main/hermes-upstream-watch.ts` through the safe write helpers.
- Add fsync behavior inside `safeWriteFile()` and `safeWriteFileAsync()` rather than duplicating durability code at call sites.
- Keep file permissions behavior intact.

Verification:

- Focused tests for the helper and at least one migrated caller.
- Run the full storage gate when touching SPS storage-adjacent files: `npm run typecheck`, `npx vitest run`, `npm run verify:note-index`, and `npm run build`.

### 0.3 SSH Tunnel Watchdog (M)

Problem: `src/main/ssh-tunnel.ts` checks tunnel health after process exit, but does not reconnect with backoff when the tunnel dies. `src/main/hermes/gateway-process.ts` supervises local gateway health but not remote/SSH liveness in the same owner-visible way.

Change:

- Add reconnect-with-backoff behavior when the tunnel process exits and health checks fail.
- Extend gateway supervision so remote/SSH mode has a visible recovery path, not only local subprocess recovery.
- Add first direct behavior tests for `src/main/ssh-tunnel.ts` if coverage is incomplete for the new watchdog path.

Verification:

- Focused `ssh-tunnel` tests.
- Focused gateway supervisor or gateway-process tests.
- Run `npm run typecheck`.

### 0.4 Faster Gateway Hang Detection and Port Conflict Errors (S + S)

Problem: gateway startup and hang failures need faster, more actionable owner-facing messages. Profile port relocation is present in `src/main/gateway-ports.ts`; failure copy and recovery should make conflicts obvious.

Change:

- Tighten local gateway hang detection in `src/main/hermes/gateway-process.ts` without increasing false positives.
- When port relocation or port conflict handling is involved, surface the profile name, old port, new port, and next action.
- Keep the default profile pinned to port `8642`; only relocate named-profile collisions.

Verification:

- Focused tests around gateway timeout and `src/main/gateway-ports.ts`.
- Run `npm run typecheck`.

### 0.5 Aborted Stream Fires Terminal Callback (S)

Problem: `src/main/hermes/chat-client/api.ts` aborts the active request but the abort path can skip the same terminal callback used by normal stream completion and errors.

Change:

- Make abort emit a terminal callback exactly once.
- Preserve existing timeout and transport error wording.
- Ensure no double-finalize on normal `end`, `error`, timeout, and abort races.

Verification:

- Add a focused streaming test for abort.
- Run the relevant chat-client Vitest file and `npm run typecheck`.

### 0.6 Scheduled Research Errors Surface as `lastError` (S-M)

Problem: `src/main/scheduled-research.ts` still contains multiple best-effort catches. Some failures only log or skip, which makes persistent failure invisible in the UI.

Change:

- Convert swallowed persistent failures into `lastError` or equivalent state on the run/routine record.
- Keep genuinely optional per-item failures non-fatal, but make repeated routine-level failure visible.
- Add first direct tests for scheduled-research failure surfacing.

Verification:

- Focused scheduled-research tests.
- Run `npm run typecheck`.

### 0.7 CI Runs All Test Tiers (M)

Problem: the hardening plan in `docs/superpowers/plans/2026-07-03-reliability-and-ci-hardening.md` calls out missing CI coverage for Electron-ABI verification and Playwright-Electron smoke. The roadmap should adopt that direction rather than inventing a second CI scheme.

Change:

- Implement Tasks 4 and 5 from `docs/superpowers/plans/2026-07-03-reliability-and-ci-hardening.md`.
- Add scheduled or main-branch CI for build, `verify:note-index`, `verify:external-context`, and `node scripts/sps-smoke.mjs`.
- Remove permanent lint `continue-on-error` only after the lint backlog is settled in its own formatting-only or lint-only change.

Verification:

- CI job has passed at least once.
- Local command set for the changed workflow is documented in the PR.

## Phase 1 - Update-Channel Hardening

Goal: make Hermes Agent currency safe, understandable, and release-oriented.

### 1.0 Reconcile Stale Plan Checkboxes (S)

Problem: `docs/superpowers/plans/2026-07-03-upstream-capture-and-exposure.md` predates some shipped update-channel work. It still describes SHA anchoring and contract verification as future even though current source has `src/shared/engine-contract.ts`, `src/main/engine-contract-verify.ts`, and update orchestration using contract verification.

Change:

- Refresh that plan document or add a small closeout note that marks shipped pieces accurately.
- Preserve still-open work such as release-channel defaults, pre-launch verification, install-script refresh, and local-mode capability gating.

Verification:

- Proofread.
- Check referenced paths exist.

### 1.1 Release-Channel Updates (M, Flagship F3)

Problem: the owner wants engine updates to default to named tagged releases, with `main` available as an explicit faster channel.

Change:

- Add an `engineUpdateChannel: "release" | "main"` setting, defaulting to `"release"`.
- In release mode, resolve the latest GitHub release tag and its commit SHA, then reuse the existing rollback/update machinery around `rollbackEngineTo(sha)` in `src/main/installer.ts`.
- Keep `hermes update` as the main-channel path.
- Preserve existing orchestration in `src/main/hermes-agent-updates.ts`: clean-repo gate, update, gateway restart, capability refresh, contract verify, rollback option, and notification.

Verification:

- Focused tests for release-vs-main resolution and update decision logic.
- `tests/preload-api-surface.test.ts` if any IPC/preload settings are added.
- Run `npm run typecheck`.

### 1.2 Live Install-Script Refresh (S-M)

Problem: bundled install scripts can drift from upstream. The exploration found the bundled snapshots were stale relative to the then-current upstream release, so fresh install and rollback need a safer refresh path.

Change:

- Fetch the official `install.sh` and PowerShell install script from the Hermes Agent site at install time.
- Apply sanity checks before executing or caching: expected shebang/PowerShell header, reasonable size band, and no empty response.
- Fall back to the bundled snapshot on fetch or sanity-check failure.
- Use the same refreshed script path for fresh installs and rollback reinstall steps.

Verification:

- Unit tests with mocked fetch responses: good script, bad header, huge body, network failure, fallback.
- Run `npm run typecheck`.

### 1.3 Pre-Launch Compatibility Gate (M)

Problem: contract verification currently protects update flow, but a manually changed engine checkout can still be launched before verification.

Change:

- On gateway start, compare `getInstalledEngineSha()` to the last verified SHA.
- If different, run `src/main/engine-contract-verify.ts` before declaring the gateway healthy.
- On failure, keep the error owner-visible and offer rollback to the last verified SHA.
- Degrade to `unknown`, not `broken`, when the engine is unavailable or too old to prove the contract.

Verification:

- Focused gateway/update contract tests.
- Run `npm run typecheck`.

### 1.4 Unify Update-State Stores (M)

Problem: update state is split across upstream watch, update routine results, and contract/capability state. This makes UI truth fragile.

Change:

- Create one engine-update-state module that owns installed SHA, release/main channel, latest release seen, pending update summary, last verified SHA, last contract result, suppression/acknowledgement flags, and last notification state.
- Migrate existing callers incrementally without changing user-facing behavior in the first pass.

Verification:

- Migration tests for old persisted state shapes.
- Focused tests for read/write and state transitions.
- Run `npm run typecheck`.

### 1.5 Surface Shipped Upstream Features (M)

Problem: useful upstream features should become visible when the installed engine supports them, not hardcoded into desktop assumptions.

Change:

- Add a Nous Portal one-click action for `hermes setup --portal` in Settings.
- Show Mixture-of-Agents as a model-picker capability only when `/v1/capabilities` advertises support.
- Surface `/goal`, `/learn`, and `/journey` in What's-New cards keyed to release notes or capability deltas.
- Add Vertex AI to the provider environment-key map if supported by the installed engine.

Verification:

- Capability-gated UI tests.
- Provider map tests.
- `npm run typecheck`.
- `npm run build` for renderer-facing work.

### 1.6 Capability-Gate Local UI Controls (S-M)

Problem: remote chat transport negotiates capabilities, but local mode can still expose controls the current local engine cannot honor.

Change:

- Treat the engine capability snapshot and connection-mode matrix as separate gates.
- For local mode, hide or disable controls unless the snapshot confirms the feature.
- Use clear owner-facing copy when a feature is unavailable because the engine is too old.

Verification:

- Focused renderer tests for available, unavailable, and unknown capabilities.
- `npm run typecheck`.
- `npm run build`.

## Phase 2 - Autonomy While Closed

Goal: keep owner-critical routines running without turning the desktop app into a second agent runtime.

### 2.1 Approvals on SPS Chat (M)

Problem: broader autonomy requires approval UX in the actual SPS chat path. `src/renderer/src/screens/Chat/useChatSignals.ts` already handles approval requests and responses, while `src/renderer/src/screens/SpsAgent/store/slices/assistant.ts` currently only listens to auto-approval signals.

Change:

- Port approval request and response handling from the overlay chat pattern into SPS chat.
- Reuse the approval reducer/card UI instead of inventing a parallel flow.
- Require this before granting more write autonomy.

Verification:

- Focused renderer/store tests for enqueue, approve, deny, timeout, and remembered-safe auto-response.
- `npm run typecheck`.
- `npm run build` if UI behavior changes.

### 2.2 Gateway Keepalive When App Is Closed (M)

Problem: the existing launchd runner can trigger scheduled work, but it does not yet guarantee the gateway is alive while the app is closed.

Existing seam:

- `src/main/control-server.ts` renders `~/.hermes/bin/hermes-cron.js`.
- `manageLaunchAgent()` installs `com.nousresearch.hermes-scheduler.plist`.
- The launch agent runs on a `StartInterval`.

Change:

- Extend the launchd-triggered script with a gateway health check and restart block.
- Guard double-management so the open desktop app and launchd never fight over the same gateway.
- On relaunch, surface "gateway was down for N hours" or equivalent state when a closed-app outage was detected.

Verification:

- Unit tests for generated launchd script content.
- Focused process-management tests with mocked health checks.
- Manual local launch-agent check before shipping.

### 2.3 Owner-Critical Routines as Engine Cron Jobs (M, Flagship F1)

Problem: morning brief and overnight triage should run when the desktop app is closed, but the app should not grow a second headless runtime.

Change:

- Create morning-brief compile-and-deliver and overnight triage summary as Hermes engine cron jobs through `createCronJob()` in `src/main/cronjobs.ts`.
- Use `firstRunManual: true`.
- Mirror prompt discipline from `src/main/dream-cycle.ts`.
- Make output idempotent per day, such as one brief filename per date, so app-open and app-closed paths never double-produce.
- Use `deliver` from `src/shared/cronjobs.ts` for delivery targets.
- Keep `hermes-cron.js` as a dumb trigger only.

Verification:

- Focused cron job creation tests.
- Idempotency tests for same-day brief generation.
- Delivery routing tests with mocked channels.
- `npm run typecheck`.

### 2.4 Routines Status Panel (S-M)

Problem: scheduler skips, routine failures, app-closed cron outcomes, and update routine status are scattered.

Change:

- Add one status panel that surfaces scheduler skip telemetry, routine `lastError`, app-closed cron outcomes, pending approvals, and last owner-delivery result.
- Keep it read-only in the first pass.

Verification:

- Renderer tests for healthy, warning, and failure states.
- `npm run typecheck`.
- `npm run build`.

### 2.5 Move Renderer Intervals Into Main Scheduler (S)

Problem: `src/renderer/src/screens/SpsAgent/App.tsx` still owns open-app ingest and deep-lint intervals. These should be scheduler-owned if app-open and app-closed paths are meant to converge.

Change:

- Move ingest and deep-lint intervals into `tickScheduler()` in `src/main/scheduler.ts`.
- Keep renderer controls as preferences only.
- Prevent double-runs when the renderer is open.

Verification:

- Scheduler tests for enabled, disabled, throttled, and app-open/app-closed paths.
- Renderer tests for preference wiring only.
- `npm run typecheck`.

## Phase 3 - Reach: the Owner's Pocket

Goal: let Hermes reach the owner through selected channels and let the owner use Telegram as the mobile surface.

### 3.1 Owner Notification Preferences (M, Flagship F2)

Problem: proactive reach should be powerful but explicitly owner-controlled.

Change:

- Add Settings preferences for channels:
  - macOS notifications: default on.
  - Telegram DM: default off until configured.
  - Email: default off until configured.
  - WhatsApp: default off and behind the same interface, implemented when a reliable provider path exists.
- Optionally scope toggles by event type: brief, nag, alert, update.
- Create one owner-delivery module that fans out to all enabled channels with shared rate limits and quiet hours.
- Reuse existing pieces where possible:
  - `src/main/contact-messaging.ts` has `sendTelegramViaGateway()`.
  - Gateway email delivery can be used for email.
  - macOS notification plumbing already exists elsewhere in the app.
  - WhatsApp should stay behind the interface until configured.

Verification:

- Unit tests for preference resolution, rate limit, quiet hours, and fanout.
- Channel tests with mocked Telegram/email/macOS notification senders.
- `tests/preload-api-surface.test.ts` if settings IPC/preload changes.
- `npm run typecheck`.

### 3.2 Morning-Brief Delivery (S-M)

Problem: creating a brief is not enough; the owner needs it on the channels they enabled.

Change:

- Add a post-dream-cycle hook that condenses and delivers the brief through owner-delivery.
- Use the app-closed path from Phase 2.3 for scheduled delivery.
- Keep delivery idempotent per day and per channel.

Verification:

- Focused delivery tests for no channels, one channel, multiple channels, quiet hours, and duplicate suppression.
- `npm run typecheck`.

### 3.3 Owner Nag Escalation (S)

Problem: `src/main/nag-engine.ts` can already send assignee Telegram messages in narrow cases; owner escalation should use the owner-delivery layer and remain opt-in.

Change:

- Fire owner-delivery in addition to macOS notification for owner-relevant nag escalation.
- Keep assignee auto-send opt-in and separate from owner notifications.

Verification:

- Nag-engine tests for owner delivery enabled/disabled, quiet hours, and no assignee leakage.
- `npm run typecheck`.

### 3.4 Telegram Bot as Mobile Client (M-L)

Problem: away-from-Mac access should not become a native mobile app project.

Change:

- Enable the upstream gateway Telegram bot as the owner's mobile client.
- Author a "workspace" engine skill through the existing skills authoring surface, sourced from `docs/ONTOLOGY.md`, teaching the agent the owner's vault/tasks/CRM layout.
- Support phone queries such as "what's overdue?" and phone capture such as "add this as a task".
- Keep all write paths approval-aware from Phase 2.1.

Verification:

- Engine skill content tests or fixture validation.
- Telegram gateway roundtrip test where feasible.
- Manual Telegram smoke with a throwaway profile before owner use.

### 3.5 Email Actions (M)

Problem: the inbox triage surface can monitor and classify mail, but the owner still needs action handoffs.

Change:

- Add "draft reply" using `mailto:` handoff via `buildHandoffUrl()` in `src/main/contact-messaging.ts`.
- Add "turn into task" for selected email captures.
- Keep IMAP as the ingestion path; do not add Gmail/Outlook OAuth in this roadmap.

Verification:

- Inbox renderer tests for draft reply and task capture actions.
- Main-process tests for handoff URL behavior.
- `npm run typecheck`.
- `npm run build`.

## Phase 4 - Cockpit as Home + Relationship Engine

Goal: make the first screen an operator console, then flip the default home surface last.

### 4.3 Operator Widgets First (M)

Problem: Cockpit exists, but `src/renderer/src/screens/SpsAgent/cockpit/CockpitSurface.tsx` needs owner-operational widgets before it deserves to become home.

Change:

- Extend `WIDGET_META` and widget rendering with read-only operator widgets:
  - overdue tasks and nags.
  - inbox triage count.
  - morning brief.
  - pending approvals.
  - engine/update status plus What's-New.
  - equity alerts, if the underlying feed exists and is already local/safe.
- Seed a default layout that shows these widgets without requiring manual cockpit design.

Verification:

- Renderer tests for widget availability, seeded layout, and empty/error states.
- `npm run typecheck`.
- `npm run build`.

### 4.2 Sidebar Reachability for Orphaned Surfaces (S)

Problem: cockpit, journal, active work, and memory timeline should be reachable without knowing hidden commands.

Change:

- Add or expose sidebar entries for the four orphaned surfaces.
- Preserve existing user customization and narrow-layout behavior.

Verification:

- Sidebar renderer tests.
- Keyboard/focus smoke where feasible.
- `npm run typecheck`.

### 4.1 Flip Home Surface Last (S)

Problem: `src/renderer/src/screens/SpsAgent/lib/theme.ts` currently defaults `homeSurface` to `"doc"`. Flipping too early would land the owner on an underpowered cockpit.

Change:

- After 4.3 and 4.2 are shipped, change `TWEAK_DEFAULTS.homeSurface` to `"cockpit"`.
- Respect prior customization; do not overwrite an existing user-selected home surface.

Verification:

- Theme/tweak tests for default new profiles and existing customized profiles.
- `npm run typecheck`.

### 4.4 CRM Relationship Engine V1 (M)

Problem: relationship follow-up should ride the existing contact and nag seams rather than becoming a separate CRM app.

Change:

- Log outreach to contact notes at `openContactChannel()` call sites.
- Add a `followUpAt` property for contacts or contact-note actions.
- Convert `followUpAt` into a nag record using the existing nag ladder.

Verification:

- Contact messaging tests for outreach logging.
- Nag tests for follow-up scheduling.
- Renderer tests if contact UI changes.
- `npm run typecheck`.

## Phase 5 - Continuous Deepening

Goal: keep a backlog of high-leverage improvements that should not block the game-changer path.

These are non-blocking unless measurement proves they are the current bottleneck.

- Transport migration to `/api/sessions/{id}/chat/stream`: the real fix for swallowed post-stream reconcile; capability-gated and covered by streaming tests.
- Direct tests for large main-process modules such as `src/main/installer.ts`, `src/main/sps-agent.ts`, and skills management.
- KB recall work only if the measured gap survives the existing `docs/BACKLOG.md` trigger.
- Import worker offload only if jank is measured.
- Blob-mode out-of-band write guard if real user flows still rely on blob mode.

## Sequencing Rationale

1. Atomic writes and note-index self-healing come before app-closed autonomy. More background work makes corruption and silent persistence failure more expensive.
2. SPS approvals come before expanded write autonomy. The agent should not gain new closed-app write paths before the owner can approve or deny risky actions in the main workspace.
3. Release-channel hardening and pre-launch compatibility gates come before increasing update cadence. Currency without rollback and verification is just faster breakage.
4. Gateway keepalive comes before phone reach. Telegram and owner-delivery are not useful if the gateway is down while the app is closed.
5. Cockpit widgets come before the home-surface flip. The owner should land on a console only after it has the needed feeds.
6. CRM follow-up rides the nag ladder; it should not introduce a second reminder system.

## Explicit Cut List

Do not build these unless the owner explicitly reopens the scope:

- Native or paired mobile app.
- Gmail or Outlook OAuth.
- Local embeddings before a measured retrieval gap justifies them.
- A second headless desktop runtime.
- A Mixture-of-Agents orchestration UI.
- A generic coach-tour or onboarding theater.
- A SaaS-style admin control plane.
- A separate CRM database when contact notes and nag records are enough.

## Definition of Game-Changer

Hermes Desktop becomes meaningfully different when these observable outcomes are true:

1. The owner closes the laptop at night and a 7:00 brief arrives through the enabled channels, generated while the desktop app was closed.
2. The owner replies to the Telegram bot from a guard site and the task appears in the SPS workspace with the right approval/write boundary.
3. Engine updates arrive as named releases by default, with one-click update, contract verification, and rollback to the last verified SHA.
4. Nothing corrupts silently: the note index self-heals, atomic writes cover critical state, and routine failures show `lastError`.
5. Gateway downtime is detected and visible; relaunch tells the owner when closed-app autonomy was unavailable.
6. Cockpit opens as the first useful operator surface, showing tasks, nags, inbox triage, approvals, brief status, and engine health.
7. Owner notifications respect channel preferences, quiet hours, and rate limits, instead of spraying every possible channel.
8. Relationship follow-ups become nag records from real outreach, so the system remembers the next human action.

## Verification Tiers

Use the Hermes Desktop workflow ladder per item:

| Change type | Required verification before claiming success |
| --- | --- |
| Docs only | Proofread and check cited paths exist. |
| Pure renderer logic or IPC-mocked components | Focused `npx vitest run <file>` plus `npm run typecheck`. |
| Main process or preload | `npm run typecheck` plus focused or full `npx vitest run`; include `tests/preload-api-surface.test.ts` for preload changes. |
| Anything opening the note index | `npm run verify:note-index`; do not rely on Vitest for Electron ABI proof. |
| External-context bridge | `npm run verify:external-context`. |
| Renderer UI behavior | `npm run build` then `node scripts/sps-smoke.mjs` where feasible. |
| Storage substrate | Full storage gate from `docs/STORAGE.md`: both typechecks, touched-file lint, `npx vitest run`, `npm run verify:note-index`, and `npm run build`. |

## House Rules for Execution

- One dedicated `codex/` worktree per non-trivial item.
- Run `bash scripts/setup-worktree.sh` or `npm ci` in each worktree; never symlink `node_modules`.
- Use test-first bug fixes where a bug is being fixed.
- Keep PRs small and single-purpose.
- Rebase and integrate serially; no merge commits into `main`.
- For each item, cite exact source files and verification output in the closeout.
- If an item touches auth, secrets, production resources, billing, or irreversible data, stop and ask before changing behavior.
- If a source path or claim in this roadmap has drifted, correct the plan before coding.
