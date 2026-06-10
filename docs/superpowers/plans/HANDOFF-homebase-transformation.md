# Handoff — "The Home Base" transformation

**As of 2026-06-11. `origin/main` @ `0f20d86e`. Tree clean.**

This is the in-repo durable pointer. The **living tracker** is the auto-memory file
`homebase-transformation.md` (auto-loads each session via its MEMORY.md index line) and is
authoritative if the two ever drift. The **canonical plan** is
`docs/superpowers/plans/2026-06-10-homebase-transformation.md`.

## Status

- **Phase 0** — done.
- **Phase 1 (Stability) — COMPLETE.** 1.1 gateway supervision, 1.2 scheduler locks,
  1.3 IPC error envelope (`2c5fd7fe`), 1.4 SSH key cache, 1.5 workspace write-safety
  (`08ec21f5`), 1.6 logging, 1.7 note-index event — all merged.
- **Phase 2 (Consolidation) — 4/9.** Owner decision (2026-06-10): **port + delete in
  one pass** (the one-week Developer-mode trial gate was waived). Done:
  - **2.1** delete admin Personalization — SPS You was already a strict superset
    (`dcced1da`).
  - **2.2** port cron oversight into SPS Scheduled modal, delete admin Schedules
    (`a4b39223`).
  - **2.3** port full-history session **search** into SPS `SidebarRecents`, delete admin
    Sessions screen (`fb408a8c`).
  - **2.4** delete Kanban + Agents + Tools + CapabilityReview + Insights (6 commits,
    `9eff1acd`→`0f20d86e`). **Skills / Memory / Soul deletions DEFERRED** (reality-check —
    see below). Per-screen outcome:
    - **Insights** (`9eff1acd`) — INVERTED premise: the component is the live SPS `insights`
      surface (`SpsAgent/App.tsx`), the Chat.tsx pattern. Removed the duplicate admin nav
      entry only; component + `getUsageStats`/`getRunLedger` IPC kept.
    - **CapabilityReview** (`07292867`) — deleted; security summary ported to a new
      `Settings/CapabilitySummary.tsx` card under Settings → Agent Health (same 3 read IPC).
    - **Tools** (`a8aa8457`) — deleted; `getComputerUseStatus`/`installComputerUseDriver`
      removed end-to-end (preload + d.ts + both main handlers — strict main↔preload parity
      forces all-or-nothing); `computer-use.ts` impl kept. `getToolsets`/`listMcpServers`
      stay (ResearchModal + CapabilitySummary use them).
    - **Agents** (`b7c4d620`) — deleted with the **admin chat-pane**; ⌘N now always
      `spsNewChat` (`adminNewChat` + `ADMIN_NEW_CHAT_EVENT` dropped). Removed the SPS sidebar
      "Agents" section (its only action was `openSettings("agents")`). Profile IPC
      (create/delete/setActive) KEPT — backs `tests/profiles.test.ts` security guards + an
      explicit preload-surface assertion; now renderer-orphaned like the sessions IPC.
    - **Kanban** (`1e4eb6e8`) — screen deleted; replaced by read-only
      `SpsAgent/modals/AgentTasksModal.tsx` (Workspace Tools → "Agent tasks"), using
      `kanbanListBoards`/`kanbanListTasks`. ALL kanban IPC kept (write methods now orphaned).
    - **i18n prune** (`0f20d86e`) — deleted `tools`/`kanban`/`agents`/`schedules` namespaces
      (32 locale files + 37 imports/registrations) + dead `navigation.*` keys.
- **Phases 3–5** — not started (external imports → federated search → live capture/streaming).

## What 2.4 corrected + DEFERRED (read before 2.5/2.6)

Reality-check closed/reshaped several plan premises:

1. **Insights is not deletable** — it's the live SPS `insights` surface (`SpsAgent/App.tsx`
   `surface === "insights"`, routed from the sidebar). Same inversion as Chat.tsx in 2.3. Only the
   duplicate admin nav entry was removed; the component stays.
2. **`sessions` i18n namespace was NOT orphaned** (the 2.3 handoff said it was) — `src/main/session-cache.ts`
   calls `t("sessions.newConversation")`. It was KEPT; the i18n prune corrected this.

**Three deletions were DEFERRED — they are genuinely blocked on later items, not skipped:**

- **Skills → 2.6.** Active-skills toggles must move into "Workspace Settings", which **2.6** builds
  and which doesn't exist yet. Deleting `screens/Skills/` first strands the capability. Hold until 2.6
  (or pull 2.6 forward). `ipc/skills.ts` + the screen stay until then.
- **Memory → a Memory→You port (fold into 2.6, or its own item before deleting).** `screens/Memory/`
  has tabs (entries/timeline/providers/profile/soul) not yet all present in `SpsAgent/you/YouSurface.tsx`.
  `MemoryTimeline` is already imported by SPS; a full port of the remaining tabs is required first.
- **Soul → coupled to Memory.** `screens/Soul/Soul.tsx` has **no standalone admin nav entry** — it's
  rendered only as a tab inside `screens/Memory/Memory.tsx`, and `readSoul` is used by Chat's
  `useLocalCommands`. It can't be deleted while Memory exists and embeds it; it rides with the
  Memory→You port. Its i18n namespace was KEPT for the same reason.

**Current admin overlay tab set** (after 2.4): Skills, Providers, Models, Gateway, Memory, Settings
(6 tabs). The plan's "exactly 4 tabs" target (Providers/Models/Gateway/Settings) is reached once
Skills (2.6) and Memory (Memory→You) land.

## Next step: P2.5 (remove SPS sidebar stubs, S) → then 2.6

`sidebar/SidebarStubs.tsx` + the Meetings/Shared/Apps sections in `Sidebar.tsx` are dead stubs —
delete them; smoke green. Note: 2.4 already removed the sidebar "Agents" section. **2.6** ("One
Workspace Settings surface") is the lever that unblocks the deferred Skills + Memory deletions —
consider doing 2.6 next instead, then closing out Skills/Memory/Soul.

## Established Phase-2 port+delete pattern (reuse for 2.4+)

1. Reality-check the item's premise vs current `main` first — the SPS replacement is often already
   parity (2.1) or a small port (2.2/2.3). Close stale/inverted items.
2. Inventory which IPC the deleted screen uses + whether the SPS replacement or another consumer
   still needs it → **keep all such IPC + main modules** (IPC outlives UI by a release).
3. Delete ONLY: the renderer screen + Layout (`import`/nav-item/icon/render-pane) +
   `lib/openSettings.ts` `AdminView` union + `KNOWN_VIEWS`.
4. Grep the view-name / channel to zero.
5. Gate: `npm run typecheck` (×2) → `npx eslint <touched>` → `npx vitest run` (includes
   the `tests/ipc-handlers.test.ts` SOURCE-SCANNER parity) → `npm run verify:note-index` →
   `npm run build` → `node scripts/sps-smoke.mjs` + `node scripts/verify-admin-overlay.mjs`.

## Integration mechanic

Reuse the worktree `.claude/worktrees/p1.1-gateway-supervision` serially. Per item:
`git checkout -b worktree-pX origin/main` (keeps `node_modules` — do NOT `npm ci`/symlink), then
`git fetch origin` → `git merge-base --is-ancestor origin/main HEAD` ff-check → `git push origin HEAD:main`.

## Known flakes (confirmed pre-existing vs baseline — NOT regressions)

- `verify-admin-overlay`: `a1-admin-open` / `a2-settings-tab` time out
  (`GROUPS=0 SUBNAV_TABS=0`) — cold Electron-start visibility race; a3/a4/a5 pass.
- `sps-smoke`: `02b-research` / `02c-research-nudge` / `03-graph` fail on fresh seed
  (Research/Graph are nested `.nav-item`s in a collapsed nav group); 01-home/02-palette pass.
- `verify:note-index` prints a `SemanticIndex … helper process is not running` stderr line
  (`semantic_engine.py` absent in the harness) — checks still pass.

## Gotchas worth keeping

- Handler type for any IPC wrapper = `Parameters<typeof ipcMain.handle>[1]` (true drop-in,
  no `any`). The canonical free-text scrubber is `external-context/redact.ts`
  `redactExternalText` — NOT a `redactText` in `redactor.ts` (that's `StreamRedactor` only).
- Renderer component tests under **fake timers**: don't use RTL `waitFor` (its polling uses the
  faked timers → 15s hang). Flush the mount promise with `await act(async () => {})`, fire debounced
  timers with `await act(async () => { vi.advanceTimersByTime(n) })`, then assert with `getByText`
  directly (see `screens/SpsAgent/sidebar/SidebarRecents.test.tsx`). Mock the SPS store at the
  selector level (`useStore((s) => s.x)`) via `vi.hoisted` to avoid the store import chain.
- `styles/home.css` is already-scoped output (`.sps-scope .x`) — add pre-scoped rules, do NOT
  re-run `scope-sps-css.mjs` (double-prefix risk).
- Layout's `.schedules-modal` CSS class is reused by the What's-New modal — CSS lives in
  `main.css` and stays.
- `lib/openSettings.ts` + i18n locale files trip the Read-after-format guard — Read before each Edit.
- **`tests/ipc-handlers.test.ts` enforces STRICT two-way main↔preload parity** ("every main handler
  has a matching preload invoke" AND vice-versa). So removing an orphaned IPC is all-or-nothing:
  you cannot keep the main handler while deleting the preload bridge (or vice-versa). Either delete
  both (computer-use in 2.4) or keep both (profiles/kanban in 2.4). `tests/preload-api-surface.test.ts`
  additionally has **explicit** assertions for some methods (e.g. `createProfile`/`deleteProfile`/
  `setActiveProfile`) — those signal "keep".
- SPS `Icon` names are a closed union from `SpsAgent/components/iconPaths.ts` — there is **no**
  `refresh`/`reload`/`sync` icon (typecheck catches a bad name). Use a `↻` glyph or an existing name.
