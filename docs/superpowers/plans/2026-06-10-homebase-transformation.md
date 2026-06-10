# Hermes Desktop → "The Home Base": Phased Transformation Plan

> Owner-approved plan (2026-06-10). This is the canonical reference for the
> multi-phase transformation. Live progress + gotchas are tracked in project
> memory (`homebase-transformation.md`), which points here. When executing an
> item, **reality-check its premise against current `main` first** — the audit
> already found several stale premises; more will appear.

## Context

**Vision (owner's words):** "A home from where I can undertake all of my work — a
unifier of all my scattered conversations and code with various LLMs, notes etc.
Simple yet profound and transformative."

**Shape of the plan:** harden the platform → ruthlessly simplify → widen the intake
(all LLM conversations) → make one search hit everything → close the capture loop.
Not "add more features." The documented #1 killer of second-brain tools is friction

- feature sprawl + the system doing nothing with your inputs.

**Owner decisions (locked):** Ruthless consolidation · Stability first · New sources:
ChatGPT, Claude.ai, Grok (x.ai), Gemini (Takeout), Perplexity-if-possible exports +
Telegram quick-capture (WhatsApp via "forward to Telegram bot" — no WhatsApp API).

**Executor:** Claude Opus 4.8. One worktree-isolated, single-purpose branch per
numbered item (`git worktree add … && bash scripts/setup-worktree.sh` — never symlink
node_modules). Sizing: S < ½ day, M = ½–2 days, L = 2–5 days.

---

## Non-negotiable operating constraints (every item obeys these)

1. **Reality-check gate on every item.** Before executing, verify the item's premise
   against current `main` with file/commit citations. Already-done or inverted ⇒ close
   the item with a note, never build it.
2. **Data-inventory + deprecate-before-delete.** Every Phase 2 deletion starts with a
   short committed inventory: what the surface reads/writes on disk, which IPC handlers
   mutate state, which background processes write through it. No surface is deleted while
   a background writer still depends on it — port the management UI first. Deletions hide
   behind the existing Developer-mode flag for a one-week owner trial before the removal
   commit. IPC/file formats outlive their UI by one release.
3. **Phase 2 is serialized** (one worktree at a time — all deletions converge on
   Layout.tsx, preload index.ts/index.d.ts, ipc/\*, i18n trees). Parallel worktrees
   allowed only in Phase 3 (disjoint adapter modules). A deletion commit removes renderer
   callsites + preload method + index.d.ts entry + main handler + i18n keys in one commit,
   verified by grepping the IPC channel name to zero.
4. **All ingestion is worker-threaded, single-writer, idempotent, redaction-proven.**
   Imports parse in a worker_thread with progress/cancel; DB writes only via `applyFragments`
   (`src/main/external-context/db.ts` — structural invariant); double-import ⇒ identical row
   counts; seeded-secret-inside-export-fixture never reaches messages/messages_fts
   (verify:external-context extended); save-chat-to-KB and Telegram captures pass
   `src/main/redactor.ts` before any vault write and keep untrusted fencing. Test fixtures
   use structurally invalid fake keys (GitHub push-protection blocked real-looking ones before).
5. **Workspace write-safety (1.5) lands before any new background writer.** Serialized write
   queue + generation check + rolling backups is a prerequisite gate for every Phase 3+
   feature that writes to the workspace.

**Standard verification gate (every PR):** `npm run typecheck` (both projects) →
`npx eslint <touched>` → `npx vitest run` → `npm run verify:note-index` → `npm run build`.
Plus per-phase: `node scripts/sps-smoke.mjs`, `npm run verify:external-context`,
`node scripts/external-context-smoke.mjs` where relevant. Preload changes always land in
BOTH `src/preload/index.ts` and `src/preload/index.d.ts` (parity test enforces). Run the
gate — don't attest it.

---

## Phase 0 — Baseline (S, do first) ✅ DONE

- `git push` main to origin. Fetch/rebase per the standing integration rule if rejected.
- Capture baseline: green test counts, lint warning count, sps-smoke pass.
- **Result:** main was already pushed (stale premise #1). Baseline @ 62331cde: typecheck
  clean, vitest 1628 pass, lint 63err/230warn (pre-existing prettier noise).

---

## Phase 1 — Stability (the platform stops eating data and hanging)

Pure hardening, zero UX change, independently shippable.

### 1.1 Gateway supervision: permanent health loop + auto-recovery (M) ✅ DONE (64a9254d)

**Where:** `src/main/hermes/gateway-process.ts`, `hermes.ts`/`sse-parser.ts`, `chat-orchestrator.ts`.
**What:** Replace the self-cancelling poll with a permanent 30s supervisor (local mode only,
while a profile's gateway is started): re-run the HTTP health probe; on 3 consecutive failures
kill + `startGateway()` with exponential backoff (max 3 attempts, then a persistent visible
"gateway down" state — never silent-restart during an open interactive stream). Emit
`gateway-health-changed` to the renderer (new preload listener). Add a stream-stall timeout:
no bytes for 120s ⇒ abort.
**Accept:** kill -9 the gateway mid-session ⇒ detected ≤60s, restarted, chat works without app
restart; crash-looping gateway surfaces "down" after 3 attempts; stalled stream errors out. No
restart in remote/SSH.
**Outcome:** Done as pure state machine (`gateway-supervisor.ts`, 9 vitest cases) + effects.
Stream-stall half was ALREADY satisfied (req.setTimeout socket-inactivity timer) — not rebuilt.

### 1.2 Scheduler locks: PID-liveness + TTL + visible skip counter (M) ✅ DONE (e90d3c29)

**Where:** `src/main/scheduler.ts` (lock at ~line 186: `/tmp/hermes-routine-<jobId>.lock`,
bare existsSync — a crash mid-job kills that job forever silently).
**What:** Locks move to `<HERMES_HOME>/locks/<jobId>.lock` as JSON `{pid, startedAt}`. Acquisition
steals if PID dead (`process.kill(pid,0)` throws) or `startedAt` exceeds job timeout (default
15 min). Wrap job runs in a timeout race that releases the lock. Every lock-skip increments a
counter; a job that hasn't run within 2× its cadence surfaces a warning in the scheduled-research UI.
**Accept:** vitest units on extracted pure stale-lock logic; dead-PID lock self-heals; never-resolving
job reaped; skip counter visible.
**Outcome:** Done. Pure `scheduler-lock.ts` (9 cases) + reap timer + skip telemetry via
`get-scheduler-skips` IPC. Skip-counter UI surfacing deferred to 2.2.

### 1.3 IPC error envelope + last-resort logging (M, may split into 2–3 PRs) ⏳ NEXT

**Where:** new `src/main/ipc/safe-handle.ts`; mechanical adoption across `src/main/ipc/*.ts`
(16 files) and handlers still in `src/main/index.ts` (~234 sites).
**What:** `safeHandle(channel, fn)` wraps `ipcMain.handle`: catch → structured log
`{channel, message, stack}` (via 1.6 logger — `log.error("ipc", {...})`) → redact via
`src/main/redactor.ts` → rethrow a clean serializable Error. **Do not change return shapes**
(renderer hooks depend on current contracts). Add `process.on('unhandledRejection'|'uncaughtException')`
loggers in `index.ts`.

```ts
export function safeHandle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      const message = redactText(
        err instanceof Error ? err.message : String(err),
      );
      log.error("ipc", {
        channel,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw new Error(message);
    }
  });
}
```

**Accept:** grep shows zero raw `ipcMain.handle(` outside safe-handle.ts; a deliberately-throwing
handler yields a structured log line + clean renderer rejection.
**Note:** Watch `registerDualHandler` (ipc/utility.ts) + `event.sender.send` patterns. 1.6's logger
is live, so the dependency is satisfied.

### 1.4 SSH auth-key cache lifecycle (S) ✅ DONE (0478307b)

`clearSshRemoteApiKey()` (clears key + apiServerAvailable=null) on connection-mode change, new SSH
target, tunnel teardown. vitest unit mocks ../config.

### 1.5 Workspace write-safety (M/L) — prerequisite for all Phase 3+ writers ⏳ AFTER 1.3

**Where:** `src/main/sps-agent.ts` (spsSave ~1086 — already atomic via safeWriteFileAsync, but
swallows every error into `return false`, whole-blob last-write-wins, backups only at migration),
`ipc/sps.ts`, renderer save path (`screens/SpsAgent/lib/persistence.ts`, store).
**What:** (a) Save IPC returns `{ok, error?, bytes}`; persistent save-failure toast + status indicator
in the SPS shell. (b) Single serialized write queue in main with a workspace generation/version number:
a save whose base generation is stale triggers reload-merge, never blind overwrite. (c) Rolling backups
`workspace.json.bak-<stamp>` (first save per session + every 50 saves, prune to 5), reusing the
`spsBackupWorkspace` convention. (d) One-time advisory when the blob exceeds 25 MB pointing at vault
migration. Background writers prefer the file-first vault path over blob rewrites where possible.
**Accept:** simulated EACCES ⇒ visible warning; two writers with interleaved stale bases ⇒ no lost
pages (test via extracted pure merge logic); backups rotate; sps-smoke green.

### 1.6 Structured logging + log rotation (M) ✅ DONE (624c488c)

`src/main/log.ts`: dependency-free JSON-lines logger → `<HERMES_HOME>/logs/desktop.log` (5MB, keep 3);
pure `formatLogLine`/`shouldRotate` (electron-free, 5 vitest cases); `rotateGatewayStderrIfLarge`
(10MB, keep 2) at gateway start; adopted in gateway supervisor + scheduler.

### 1.7 Note-index rebuild event + vault-mirror failure surfacing (S) ✅ DONE (f13e8419) [rebuild half]

`sps-index-rebuilt {profile, status}` broadcast + preload `onSpsIndexRebuilt` + `useIndexRebuildVersion()`
into all 4 useNoteIndex hooks → search/graph/backlinks refetch on rebuild. **Mirror-write-failure COUNT
half deferred to 2.6** (which owns the Storage settings surface that displays it).

**Phase 1 gate:** standard + sps-smoke + verify:external-context + manual kill-the-gateway recovery check.

---

## Phase 2 — Ruthless consolidation (serialized; data-inventory + deprecation flow per item)

**End-state:** the SPS workspace IS the app; the admin overlay is connectivity only (Providers,
Models, Gateway, Settings/Diagnostics); one chat system (SPS Chat) + the page co-author (a distinct
editor capability, NOT a chat).

### 2.1 Port Personalization into SPS You, then delete the admin screen (M) — highest-risk, inventory first

**Inventory (verified):** `src/main/personalization.ts` edits `~/.hermes/agent-hooks/focus.md` —
injected into every chat turn via a `pre_llm_call` hook in config.yaml — plus the hook consent allowlist
(shell-hooks-allowlist.json) and USER.md/MEMORY.md.
**What:** SPS You surface (`screens/SpsAgent/you/YouSurface.tsx`) already covers USER.md/rules/focus.
Port the missing pieces: hook enable/disable + allowlist management UI into You (existing IPC kept).
Then deprecate the admin Personalization screen behind Developer mode for a week; delete after sign-off.
Without the port, the owner gets a permanently stale "Current focus:" string poisoning every conversation
with no UI to fix it.
**Accept:** every capability of the admin screen demonstrably reachable in You before the delete commit;
focus-hook editable + disableable from SPS.

### 2.2 Port Schedules management into the SPS Scheduled modal, then delete the Schedules screen (M)

**Inventory:** the main-process scheduler keeps firing headless (digests, scheduled research, Telegram
sends) regardless of UI. Deleting the management UI without a replacement = app keeps doing invisible
things the owner can't see or stop.
**What:** The SPS Scheduled modal already manages research/digest schedules. Add: an "all scheduled jobs"
view (including cron jobs via existing cronjobs.ts IPC), last-run/next-run/skip-counter (from 1.2),
pause/delete per job. Then deprecate + delete `screens/Schedules/`. Keep `src/main/cronjobs.ts` and
scheduler IPC.
**Accept:** every running job visible + stoppable from SPS; skip warnings surface here.

### 2.3 SPS Chat absorbs session history; delete admin Chat + Sessions screens (L)

**Inventory:** `ipc/sessions.ts` owns search/resume/title-edit (titles in `<profile>/desktop/sessions.json`)
and delete-session (deletes rows in the agent's `state.db`). SPS ChatSurface already wraps the same `<Chat>`
component (chat merge shipped 2026-06-09) — this is history parity, not a chat merge.
**What:** Add a History affordance inside SPS ChatSurface backed by the same hooks (list/search/resume/
rename/delete). Then deprecate + delete `screens/Chat/` and `screens/Sessions/` + Layout wiring + i18n.
Keep all ipc/sessions.ts / ipc/chat.ts handlers. **The doc co-author (`assistant/AgentBody.tsx`) is
explicitly out of scope** — keep its changeset flow and MED-2 key-scrub untouched.
**Accept:** session list/search/resume/rename/delete all work from SPS; old nav gone;
`scripts/verify-admin-overlay.mjs` updated.

### 2.4 Delete Kanban + remaining admin screens with relocations (L, can split)

**Kanban inventory:** boards live in the Python agent (`hermes kanban` CLI) and the agent can create tasks
— the screen is the only oversight window over agent-created work. Default = add a read-only "Agent tasks"
view in SPS via the existing kanban IPC read path, then delete the screen + write-path UI. Inventory decides.
**Other deletions** (each with inventory + grep-to-zero): `screens/Agents/`, `screens/Skills/` (active-skills
toggles move into Workspace Settings 2.6; keep ipc/skills.ts), `screens/Memory/` (read/manage pane added to
You; keep ipc/memory.ts), `screens/Tools/`, `screens/CapabilityReview/` (port its credential/filesystem
capability summary as a card in admin Settings → Diagnostics — we're adding Telegram inbound in Phase 5;
keep the security oversight), `screens/Insights/`, `screens/Soul/`. Main-side modules survive wherever another
consumer exists (e.g., tools.ts feeds chat tool execution). IPC handlers whose only consumer was a deleted
screen are deleted with their preload bridge + d.ts entries in the same commit.
**Accept:** admin overlay shows exactly 4 tabs; parity test green; channel-name greps to zero; i18n keys pruned.

### 2.5 Remove SPS sidebar stubs (S)

`sidebar/SidebarStubs.tsx` + Meetings/Shared/Apps sections in Sidebar.tsx (~267/284/343) deleted. Smoke green.

### 2.6 One Workspace Settings surface (M/L)

Evolve `tweaks/TweaksPanel.tsx` into the single SPS settings surface: Storage (mode/parity/migrate +
mirror-failure count from 1.7 + backup status from 1.5), Inbox/curator settings as real form fields
(replacing raw-JSON editing in InboxSurface — same persisted shape), active-skills toggles, capture
settings (placeholder for 5.1). Command-palette storage toggle now opens this surface.
**Accept:** no raw-JSON settings editing remains; curator settings round-trip; one discoverable entry point.

### 2.7 Modal chrome unification (M)

Extract one `SpsModal` shell (header/close/esc/backdrop/footer slots) in scoped SPS styles (add classes to
`screens/SpsAgent/styles/` and re-run `node scripts/scope-sps-css.mjs` — never hand-edit scoped output);
convert Research/Scheduled/ExternalSessions/Templates/Trash/TaskDrawer mechanically.
**Accept:** identical behavior; smoke screenshots.

### 2.8 First-run seeded workspace + guided first loop (M)

Onboarding ends by seeding a starter workspace ("Start here" page wiki-linked to Tasks + an Inbox explainer,
demonstrating wikilinks/graph/Ask) instead of a blank tree; dismissible 3-step checklist (capture → ingest →
search). `dev:fresh` proves it.

### 2.9 Discoverability pass (S)

⌘K entries + shortcut hints + tooltips for Save-to-wiki, Ask pane, Vault health, Telos audit.

**Phase 2 gate per item:** standard + sps-smoke + verify-admin-overlay + parity test + channel grep-to-zero.
Serialized.

---

## Phase 3 — External conversation imports (the unifier's intake)

**Architecture (one decision for all items):** imports reuse the existing scan pipeline. Import flow copies
the export payload to `<HERMES_HOME>/external-context-imports/<source>/<sha256prefix>-<name>` (content-hash
path ⇒ idempotent re-import); each source is a normal `SourceAdapter`
(`src/main/external-context/adapters/types.ts` — pure node, no electron/sqlite, vitest-testable) whose
`roots()` returns the import dir, `strategy: "replace"` (db.ts already implements DELETE-then-INSERT per
conversation). Parsing of large files runs in a worker_thread with progress IPC + cancel. Unparseable
conversations are quarantined + counted in the UI, never silently dropped. All writes via `applyFragments`.
Adapters can run in parallel worktrees (disjoint files).

### 3.1 Source-type plumbing (M)

Extend `ExternalSource` union in `src/shared/external-context.ts` (~line 11) with
`"chatgpt" | "claude-ai" | "grok-export" | "gemini-takeout"`; labels, default-OFF config, exhaustiveness via
typecheck; `importRootFor(source)` helper + copy-with-hash util. Existing four sources untouched
(verify:external-context green).

### 3.2 ChatGPT export adapter (M)

New `adapters/chatgpt.ts` + fixtures. `conversations.json` is a mapping node graph: walk from `current_node`
via `parent` for the canonical branch; map roles, epoch-seconds timestamps, content.parts; skip tool/system
nodes; seq = branch index. Schema-tolerant (formats drift): unknown shapes ⇒ quarantine, never throw.
**Accept:** branched-mapping fixture test; seeded-secret-in-fixture redaction assertion in verify:external-context.

### 3.3 Claude.ai + Grok export adapters (M)

`adapters/claude-ai.ts`: export conversations.json is linear (`{uuid, name, chat_messages: [{sender, text|content[], created_at}]}`).
`adapters/grok-export.ts` (named to avoid the existing live grok.ts): pin the real export shape from an actual
export at execution time; encode in fixtures; tolerant parsing.

### 3.4 Gemini Takeout adapter (M)

`adapters/gemini-takeout.ts`: Takeout MyActivity.json (JSON format only — the import UI documents "choose JSON
in Takeout"); group records into pseudo-conversations by >30 min time-gap (Takeout has no conversation ids);
provenance label "Gemini (Takeout)".

### 3.5 Perplexity: descoped to paste-capture (S, timeboxed ½ day)

Premortem finding: Perplexity has no official export — an adapter is fiction. Timeboxed feasibility note in
`docs/superpowers/specs/`; supported path is manual paste → Inbox capture (Phase 5 territory). Go/no-go
documented; no adapter built absent a real artifact.

### 3.6 Import IPC + drop-zone UI (M)

New `external-context-import-file` handler beside scan/rebuild in `ipc/external-context.ts`: accepts
`{source, filePath}`; ZIP extraction via adm-zip (main-process-safe, small) feeding the worker_thread parser;
copies payload to import root; runs the standard scan; returns counts; progress events. UI: Import tab/drop-zone
in ExternalSessionsModal with per-source export instructions.
**Accept:** real ChatGPT ZIP end-to-end ⇒ searchable, fenced; same ZIP twice ⇒ identical row counts; UI never
freezes on a large ZIP; external-context-smoke extended.

**Phase 3 gate:** standard + verify:external-context (extended) + external-context-smoke. Dogfood doc per source
— each imported corpus must show up in digests/search (closed loop, not a museum).

---

## Phase 4 — Unified search + chat↔KB linkage (the unifier's payoff)

### 4.1 Federated search IPC (M)

New `src/main/federated-search.ts` + `ipc/search.ts`: fan out to the three existing seams — note-index FTS
(`getSpsNoteIndex(profile).search`), sessions (`sessions.ts searchSessions` ~225), external-context FTS —
normalize to `{kind: page|session|external, id, title, snippet, ts, provenance}`, interleave with
recency-boosted rank. **ABI constraint:** merger/ranker are pure functions in a vitest-tested module; the
index-opening integration is proven by a new `verify:federated-search` electron-node script (pattern:
scripts/verify-note-index).
**Accept:** seeded profile returns merged three-corpus results; ranker unit-tested; parity test green.

### 4.2 Federated search in ⌘K (M)

CommandPalette queries 4.1 debounced; provenance chips (page / chat / ChatGPT / Claude Code …); Enter routes:
page → editor, session → SPS Chat resume, external → fenced viewer (external hits always render through the
existing untrusted-fence components); scope prefixes `pages:` `chats:` `external:`.
**Accept:** smoke — a term seeded in all three corpora returns three provenance-distinct hits; keyboard-only flow.

### 4.3 Save-chat-to-KB (M)

"Save to KB" on a chat session: page built from the transcript (frontmatter `source: chat-session, sessionId`;
body = cleaned transcript or LLM summary, user choice), committed through the same changeset path as ingest
(correct in both storage modes, auto-indexed/mirrored). **Passes redactor.ts before any vault write** (transcripts
contain pasted keys; vault markdown is permanent + indexed). Page links back via sessionId chip.
**Accept:** page in vault + index + graph; parity round-trip; redaction regression test.

### 4.4 Related-pages suggestions in chat (M, optional)

After a turn completes, pure matcher over turn text vs note-index titles/wikilink targets ⇒ "Related pages"
chips. Suggestions only — never auto-injected into the prompt (same invariant as external context).

**Phase 4 gate:** standard + verify:note-index + verify:federated-search + sps-smoke palette scenario +
verify:external-context.

---

## Phase 5 — Live capture + live streaming (close the loop)

### 5.1 Telegram quick-capture → SPS Inbox (L)

**Where:** new `src/main/telegram-capture.ts`; settings in Workspace Settings (2.6); writes via existing Inbox
conventions (`sps-ingest.ts`: `vault/_inbox/`, RawCapture shape); reuses
`getTelegramTarget`/`getTelegramAvailability` (scheduled-research.ts ~92–145, platforms config).
**Constraint discovered:** the gateway's Hermes agent already long-polls the bot when the Telegram platform is
enabled — a second `getUpdates` consumer on the same token conflicts. **Default mode: dedicated capture bot**
(second token configured in settings); main process long-polls with persisted offset; accepts messages only
from the paired chat id; rate/size-capped; each message lands as a raw capture in `_inbox/` (source: "telegram"),
redacted + untrusted-fenced, never auto-injected; "Captured ✓" ack. WhatsApp path = forward to this bot
(documented; no WhatsApp code).
**Accept:** message → Inbox within poll interval; foreign chat ids ignored; poller survives network loss/app
restart; ingest turns captures into pages as today.

### 5.2 WS5 step 1 — streaming spike (S, timeboxed 1 day)

Per `docs/superpowers/specs/ws5-streaming-spike.md`: throwaway `scripts/probe-*` against
`/api/sessions/{id}/chat/stream`; answer the open question (does `tool.completed` carry result
bodies/attachments?); written go/no-go.

### 5.3 WS5 steps 2–4 — live streaming transport, retire the post-stream state.db merge (L, gated on 5.2)

Feature-detect `/api/sessions/*` via `/v1/capabilities` (remote/SSH may lack it — keep OpenAI-compat fallback);
map `assistant.delta`/`tool.*` onto the existing ChatMessage union behind the SAME IPC events; correlate by
message_id; keep state.db for history load only; golden parity check (recorded turn renders identically
old-vs-new) before deleting the `onChatDone → getSessionMessages` merge; 1.1's stall timeout applies to the
new path. Net negative LOC expected.
**Accept:** live reasoning/tool rows during a turn; automatic fallback on incapable gateways; merge code deleted.

**Phase 5 gate:** standard + sps-smoke + manual capture-bot end-to-end + golden parity transcript (5.3).

---

## Explicitly NOT doing (scope discipline — the "museum" antidote)

- No Perplexity adapter (no export exists), no WhatsApp API, no Cursor indexing (owner deselected).
- No multiplayer/Yjs, no published/shared pages, no mobile.
- No merging the doc co-author into Chat (distinct capability; key-scrub is load-bearing).
- No embeddings/vector search (query expansion shipped; embeddings stay gated on measured recall failure per BACKLOG.md).
- No new cockpit widgets, no Equity changes (it works; leave it).
- **A unifier feature the owner hasn't touched during its trial window gets reverted, not kept.**

## Dependency graph

P0 → P1 (1.5 gates all later writers) → P2 (serialized) → P3 (parallel-safe) → P4 → P5.
5.2/5.3 are droppable without affecting anything else. Each phase independently shippable; stop-anywhere is safe.

## End-to-end verification of the whole transformation

1. Full mechanical gate green at every merge (typecheck×2, lint, vitest, verify:note-index, verify:external-context,
   build, smoke harnesses).
2. Manual resilience drill: kill gateway mid-chat; crash app mid-save; dead-PID scheduler lock — all recover visibly.
3. Import drill: real ChatGPT + Claude.ai + Gemini exports in; ⌘K returns provenance-mixed results; digests
   reference imported corpora.
4. Capture drill: Telegram message → Inbox → ingest → page → findable in ⌘K (the full unifier loop in one pass).
5. Owner dogfood doc per phase, with the trial-window revert rule applied.

---

## Status (as of 2026-06-10, origin/main @ a3e2e278)

- **Done & merged:** P0; P1.1 (64a9254d); P1.2 (e90d3c29); P1.4 (0478307b); P1.6 (624c488c);
  P1.7 rebuild-event half (f13e8419); lint-zero cleanup (a3e2e278).
- **Next:** P1.3 (IPC error envelope) → P1.5 (workspace write-safety) → then Phase 2 (serialized).
- Live progress + gotchas: project memory `homebase-transformation.md`.
