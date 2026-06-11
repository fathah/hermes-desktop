# Handoff — "The Home Base" transformation

**As of 2026-06-11. `origin/main` @ `c426f3a0`. Tree clean. Phases 1+2+3 COMPLETE.**

This is the in-repo durable pointer. The **living tracker** is the auto-memory file
`homebase-transformation.md` (auto-loads each session via its MEMORY.md index line) and is
authoritative if the two ever drift. The **canonical plan** is
`docs/superpowers/plans/2026-06-10-homebase-transformation.md`.

## Status

- **Phase 0** — done.
- **Phase 1 (Stability) — COMPLETE.** 1.1 gateway supervision, 1.2 scheduler locks, 1.3 IPC error
  envelope, 1.4 SSH key cache, 1.5 workspace write-safety, 1.6 logging, 1.7 note-index event.
- **Phase 2 (Consolidation) — COMPLETE (9/9).** Owner decision (2026-06-10): **port + delete in one
  pass** (one-week Developer-mode trial gate waived). Owner decision (2026-06-11): **do 2.6 before
  2.5** to unblock the deferred deletions. **The SPS workspace is now the app; the admin overlay is a
  thin 4-tab connectivity+settings surface (Providers / Models / Gateway / Settings).**
  - **2.1** delete admin Personalization — SPS You was already a strict superset (`dcced1da`).
  - **2.2** port cron oversight into SPS Scheduled modal, delete admin Schedules (`a4b39223`).
  - **2.3** port full-history session **search** into SPS `SidebarRecents`, delete admin Sessions
    (`fb408a8c`).
  - **2.4** delete Kanban + Agents + Tools + CapabilityReview + Insights (6 commits,
    `9eff1acd`→`0f20d86e`). Insights/Chat were INVERTED premises (the component IS the live SPS
    surface). CapabilityReview → a Settings card; Tools' computer-use IPC removed end-to-end.
  - **2.6 (core)** `tweaks/TweaksPanel.tsx` became "Workspace settings" (active-skills toggles +
    capture placeholder) (`5912d5bf`); **Skills** screen deleted (`84dcb389`).
  - **Memory→You** (`f65244ae`) — folded admin Memory + its embedded Soul tab into SPS You
    (MemoryTimeline / SoulEditor / MemoryProviders relocated to `you/`), deleted both screens + the
    `memory` AdminView. **Reached the 4-tab target.** Deliberate delta: structured memory-entry CRUD
    not ported (durable-facts textarea + timeline reject already cover it).
  - **2.5** delete SPS sidebar stubs — Meetings/Shared/Apps (`b4567b69`).
  - **2.7** extract one `SpsModal` chrome shell, convert 5 modals (`397e7ae1`). Excluded
    ExternalSessionsModal (nested viewer in one scrim) + TaskDrawer (drawer) as structurally divergent.
  - **2.8** first-run guided seed — "Start here" page wiki-linked to Home + a nested Inbox explainer,
    plus a dismissible 3-step checklist (`OnboardingChecklist`) (`dfd78c24`). New
    `npm run verify:firstrun-seed` probe (drives the real `buildInitialWorkspace` path).
  - **2.9** discoverability — ⌘K commands for **Ask / Vault health / Telos** (Vault health had NO UI
    entry point before — was unreachable) + sidebar tooltips (`20011102`).
- **Phase 3 (External imports) — COMPLETE.** 5 commits, each full-gate-green + ff-merged. Exports from
  the other major AI chat tools import via a drop-zone → extract → content-hash stage → standard scan →
  index-time redaction → searchable + fenced, idempotent.
  - **3.1** source-type plumbing (`3bbe0f48`) — union SPLIT (not flat extension): `ExternalScanSource`
    (claude-code|codex|gemini|grok) | `ExternalImportSource` (chatgpt|claude-ai|grok-export|
    gemini-takeout). Keeps `ADAPTERS: Record<ExternalScanSource>` exhaustive; new
    `IMPORT_ADAPTERS: Partial<Record<ExternalImportSource>>` fills incrementally (so 3.1 shipped before
    any import adapter existed). NEW `import-roots.ts` (pure): `importRootFor` + content-hash copy.
  - **3.2** ChatGPT (`adb855e5`) — `parseChatGptExport` walks the `mapping` node-graph from
    `current_node` up `parent` for the CANONICAL branch (drops abandoned regenerates + system/tool).
    ADDITIVE multi-conversation contract: `ParseResult.conversations?[]` + `applyFragments` loops it
    (single writer + redaction unchanged; 4 live adapters untouched). `ensureImportRootEnv()` bridges
    `getHermesHome()` → `HERMES_EC_IMPORT_ROOT` (a pure adapter can't resolve the electron-only userData
    home-override).
  - **3.3** Claude.ai + Grok-export (`80261b8c`) — claude-ai = linear `chat_messages`. grok-export
    REALITY-CHECK: no x.ai web-export exists, so grounded on the live `{type,content}` session JSONL,
    uploaded; tolerant, extend when a real export surfaces.
  - **3.4** Gemini Takeout (`1eed9db1`) — `MyActivity.json` is an activity LOG (no responses) →
    pseudo-conversations split on a >30 min gap (`SESSION_GAP_MS`), "Prompted " verb stripped.
  - **3.5** Perplexity — **DESCOPED (no-go):** no official export; paste-capture is Phase 5. Built nothing.
  - **3.6** import IPC + drop-zone UI (`c426f3a0`) — NEW `import-extract.ts` (adm-zip; PK-magic sniff;
    unpack `conversations.json`/`MyActivity.json` with any-`.json` fallback). `external-context-pick-file`
    - `external-context-import-file` ({source, filePath}) → extract → copy → enable → `runScan` → totals.
      NEW "Import" view/chip in `ExternalSessionsModal` (per-source drop-zone + picker + instructions).
      WORKER_THREAD REALITY-CHECK (premise inverted): renderer can't freeze (async IPC); main-thread parse
      matches the live `gemini` source — worker offload DEFERRED for pathological exports. Dep: `adm-zip`.

**Phase 3 gate (met):** standard + `verify:external-context` (extended — all 4 import sources + redaction

- idempotency) + `external-context-smoke` (real ChatGPT `.zip` end-to-end, idempotent, no DOM leak, 6/6).

## Still owed (deferred, not lost)

- **1.7 vault-mirror failure COUNT** — needs a counter in the load-bearing vault write path
  (`sps-vault.ts` / `ipc/notes.ts` `sps-export-page`) + a `spsGetMirrorFailCount` IPC, surfaced in
  the TweaksPanel Storage section. Held out of every UI commit to avoid touching the storage substrate.
  Pick up as its own small commit.

## Next: Phase 4 (federated search) → Phase 5 (live capture/streaming)

- **Phase 4** — unify the SPS vault + external-context index + KB into one search surface.
- **Phase 5** — live capture / streaming (Telegram gateway + streaming). 5.2/5.3 droppable.
- (Plus the owed 1.7 vault-mirror count above.)

## Established Phase-2 port+delete pattern (reuse where it applies)

1. **Reality-check the premise vs current `main` first** — the SPS replacement is often already
   parity, the "blank" thing already seeded, or the "missing" surface actually unreachable. Several
   plan premises were stale/inverted; close them, don't build them.
2. Inventory which IPC the deleted screen uses + whether the SPS replacement / another consumer still
   needs it → **keep all such IPC + main modules** (IPC outlives UI; `tests/ipc-handlers.test.ts`
   enforces STRICT two-way main↔preload parity, so IPC removal is all-or-nothing).
3. Delete ONLY: renderer screen + Layout (`import`/nav-item/icon/render-pane) + `lib/openSettings.ts`
   `AdminView` union + `KNOWN_VIEWS`.
4. Grep the view-name / channel to zero.
5. Gate: `npm run typecheck` (×2) → `npx eslint <touched>` → `npx vitest run` → `npm run
verify:note-index` → `npm run build` → `node scripts/sps-smoke.mjs` + `node
scripts/verify-admin-overlay.mjs` (+ `verify:firstrun-seed` for onboarding/discoverability).

## Integration mechanic

Reuse the worktree `.claude/worktrees/p1.1-gateway-supervision` serially. Per item:
`git checkout -b worktree-pX origin/main` (keeps `node_modules` — do NOT `npm ci`/symlink), then
`git fetch origin` → `git merge-base --is-ancestor origin/main HEAD` ff-check → `git push origin HEAD:main`.

## Known flakes (confirmed pre-existing vs baseline — NOT regressions)

- `verify-admin-overlay`: `a1-admin-open` / `a2-settings-tab` time out (`GROUPS=0`) — cold-start
  visibility race; a3/a4/a5 pass. (a4 was repointed `memory`→`providers` when Memory was deleted.)
- `sps-smoke`: `02b-research` / `02c-research-nudge` / `03-graph` fail on fresh seed (nested `.nav-item`s
  in a collapsed nav group); 01-home / 02-palette pass.
- `verify:note-index` prints a `SemanticIndex … helper process is not running` stderr line — checks
  still pass.

## Gotchas worth keeping

- **The Electron UI probes (`sps-smoke`, `verify-admin-overlay`, `verify-firstrun-seed`) drive the
  BUILT app (`out/`) — `npm run build` BEFORE running them** or they test stale code (a stale build
  once gave a false-positive in the first-run probe).
- `tests/ipc-handlers.test.ts` is a STATIC SOURCE-SCANNER enforcing two-way main↔preload parity;
  `tests/preload-api-surface.test.ts` has explicit per-method assertions (a "keep" signal).
- SPS `Icon` names are a closed union (`components/iconPaths.ts`) — typecheck catches a bad name; no
  `refresh`/`reload`/`sync` icon.
- `styles/home.css` is already-scoped output — append **pre-scoped** rules (`.sps-scope .x`); do NOT
  re-run `scope-sps-css.mjs` (double-prefix risk).
- Renderer component tests under fake timers: don't use RTL `waitFor`; flush with
  `await act(async () => {})`. Mock the SPS store at the selector level via `vi.hoisted`.
- `lib/openSettings.ts` + i18n locale files trip the Read-after-format guard — Read before each Edit.
- Orphaned-but-harmless i18n keys left after deletions: `navigation.memory`,
  `settings.memoryMovedHint`, `settings.openMemory`, plus the `schedules` namespace.
