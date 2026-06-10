# Handoff — "The Home Base" transformation

**As of 2026-06-10. `origin/main` @ `fb408a8c`. Tree clean.**

This is the in-repo durable pointer. The **living tracker** is the auto-memory file
`homebase-transformation.md` (auto-loads each session via its MEMORY.md index line) and is
authoritative if the two ever drift. The **canonical plan** is
`docs/superpowers/plans/2026-06-10-homebase-transformation.md`.

## Status

- **Phase 0** — done.
- **Phase 1 (Stability) — COMPLETE.** 1.1 gateway supervision, 1.2 scheduler locks,
  1.3 IPC error envelope (`2c5fd7fe`), 1.4 SSH key cache, 1.5 workspace write-safety
  (`08ec21f5`), 1.6 logging, 1.7 note-index event — all merged.
- **Phase 2 (Consolidation) — 3/9.** Owner decision (2026-06-10): **port + delete in
  one pass** (the one-week Developer-mode trial gate was waived). Done:
  - **2.1** delete admin Personalization — SPS You was already a strict superset
    (`dcced1da`).
  - **2.2** port cron oversight into SPS Scheduled modal, delete admin Schedules
    (`a4b39223`).
  - **2.3** port full-history session **search** into SPS `SidebarRecents`, delete admin
    Sessions screen (`fb408a8c`).
- **Phases 3–5** — not started (external imports → federated search → live capture/streaming).

## What 2.3 corrected (read before 2.4)

Two plan premises were stale/inverted and were closed, not built:

1. **`screens/Chat/Chat.tsx` is the SHARED chat engine** imported by SPS `ChatSurface` — it was
   NOT deleted. Only the admin Sessions screen went.
2. SPS `SidebarRecents` already did list/resume/rename/delete; the ONLY gap was **search** (the
   whole app had no session search outside the admin screen). 2.3 was a one-capability port.

The admin **`chat` render-pane** in `Layout.tsx` was **deliberately kept** — it's still reached by
`Agents.onChatWith` (`goTo("chat")`) and the global ⌘N (`ADMIN_NEW_CHAT_EVENT` → `adminNewChat`).
Its removal is coupled to 2.4 (see carry-forwards).

## Next step: P2.4 (delete Kanban + remaining admin screens, L — can split)

Delete `screens/Agents/`, `screens/Skills/`, `screens/Memory/`, `screens/Tools/`,
`screens/CapabilityReview/`, `screens/Insights/`, `screens/Soul/`, and `screens/Kanban/`
with relocations. One shippable commit per screen. **Carry-forwards from 2.3:**

- **Admin chat-pane removal lands here.** When deleting Agents, also remove the `chat` render-pane
  in `Layout.tsx` + `handleNewChat` + the `messages`/`currentSessionId` state if no other consumer
  remains, and resolve ⌘N routing: `App.tsx` `onMenuNewChat` still does
  `adminOpenRef ? adminNewChat() : spsNewChat()`; once the chat pane is gone, ⌘N should always
  `spsNewChat` — drop `adminNewChat` + `ADMIN_NEW_CHAT_EVENT` from `lib/spsCommands.ts`.
- **Sequencing nuance — defer Skills.** The plan moves the Skills active-toggles into "Workspace
  Settings", but that surface is **2.6** (doesn't exist yet). Deleting the Skills screen first
  strands the capability. **Default: hold the Skills deletion until 2.6** (or pull 2.6 forward) and
  do the conflict-free deletions first.
- **Relocations:** Kanban → read-only "Agent tasks" view via the existing kanban IPC read path;
  CapabilityReview → a card in admin Settings → Diagnostics (keep the security oversight — Telegram
  inbound arrives in Phase 5); Memory read/manage → the SPS You surface.
- **i18n pruning happens here in bulk** — including the already-orphaned `sessions` (2.3) and
  `schedules` (2.2) namespaces + their `navigation.*` keys.
- Keep every main-side module/IPC that still has a consumer; delete a handler's preload bridge +
  `index.d.ts` entry only when its sole consumer was a deleted screen, in the same commit.
- **Accept:** admin overlay shows a minimal tab set; parity test green; channel/view greps to zero.

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
