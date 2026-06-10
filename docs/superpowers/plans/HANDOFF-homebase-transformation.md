# Handoff — "The Home Base" transformation

**As of 2026-06-10. `origin/main` @ `a4b39223`. Tree clean.**

This is the in-repo durable pointer. The **living tracker** is the auto-memory file
`homebase-transformation.md` (auto-loads each session via its MEMORY.md index line).
The **canonical plan** is `docs/superpowers/plans/2026-06-10-homebase-transformation.md`.

## Status

- **Phase 0** — done.
- **Phase 1 (Stability) — COMPLETE.** 1.1 gateway supervision, 1.2 scheduler locks,
  1.3 IPC error envelope (`2c5fd7fe`), 1.4 SSH key cache, 1.5 workspace write-safety
  (`08ec21f5`), 1.6 logging, 1.7 note-index event — all merged.
- **Phase 2 (Consolidation) — 2/9.** Owner decision (2026-06-10): **port + delete in
  one pass** (the one-week Developer-mode trial gate was waived). Done:
  - **2.1** delete admin Personalization — SPS You was already a strict superset
    (`dcced1da`).
  - **2.2** port cron oversight into SPS Scheduled modal, delete admin Schedules
    (`a4b39223`).
- **Phases 3–5** — not started (external imports → federated search → live capture/streaming).

## Next step: P2.3 (Chat + Sessions history parity)

Add a History affordance inside SPS ChatSurface (list/search/resume/rename/delete via
the existing `ipc/sessions.ts` hooks), then delete `screens/Chat/` + `screens/Sessions/`

- Layout wiring + the `chat`/`sessions` AdminView members. This is **history parity, not
  a chat merge** (chat merged 2026-06-09). Keep ALL `ipc/sessions.ts` + `ipc/chat.ts`
  handlers. The doc co-author `assistant/AgentBody.tsx` is **out of scope** (keep its
  changeset flow + MED-2 key-scrub). Update `scripts/verify-admin-overlay.mjs`.

## Established Phase-2 port+delete pattern (reuse for 2.3+)

1. Reality-check the item's premise vs current `main` first — the SPS replacement is
   often already parity (2.1) or a small port (2.2). Close stale/inverted items.
2. Inventory which IPC the deleted screen uses + whether the SPS replacement or another
   consumer still needs it → **keep all such IPC + main modules** (IPC outlives UI by a
   release).
3. Delete ONLY: the renderer screen + Layout (`import`/nav-item/icon/render-pane) +
   `lib/openSettings.ts` `AdminView` union + `KNOWN_VIEWS`.
4. Grep the view-name / channel to zero.
5. Gate: `npm run typecheck` (×2) → `npx eslint <touched>` → `npx vitest run` (includes
   the `tests/ipc-handlers.test.ts` SOURCE-SCANNER parity) → `npm run build` →
   `node scripts/sps-smoke.mjs` + `node scripts/verify-admin-overlay.mjs`.

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
- `styles/home.css` is already-scoped output (`.sps-scope .x`) — add pre-scoped rules, do
  NOT re-run `scope-sps-css.mjs` (double-prefix risk).
- Layout's `.schedules-modal` CSS class is reused by the What's-New modal — CSS lives in
  `main.css` and stays.
- `lib/openSettings.ts` + i18n locale files trip the Read-after-format guard — Read before
  each Edit.
- Integration: reuse the existing worktree, `git checkout -b worktree-pX origin/main` per
  item, push `HEAD:main` after a `git merge-base --is-ancestor` fast-forward check.

## Verification gate (every PR)

`npm run typecheck` → `npx eslint <touched>` → `npx vitest run` → `npm run verify:note-index`
→ `npm run build`, plus `sps-smoke` / `verify:external-context` / `verify-admin-overlay`
where relevant.
