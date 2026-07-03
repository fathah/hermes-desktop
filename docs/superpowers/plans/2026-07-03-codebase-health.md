# Codebase Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are independent; Task 1 is the largest — do not bundle it with anything else.

**Goal:** Decompose the renderer god-components, add minimal runtime validation at the IPC boundary, finish the structured-logging migration, and fix the docs drift. Evidence base: `docs/IMPROVEMENT-REPORT-2026-07-03.md` §4 items 3, 4, 5, 8.

**Conventions:** shortest working diff; no new dependencies; keep commits small and single-purpose; full `npm test` + both typechecks after multi-file changes; capture green baseline first.

---

## Task 1: Decompose `Settings.tsx` (1631 ln, 50 `useState`)

The child components already exist (`ConfigHealth`, `CapabilitySummary`, `McpServersManager`, `ResearchReachSummary`, `HealthSurface`); the parent's 50 pieces of coordination state are the remaining monolith. The screen already renders one `section` at a time (`preferences` / `dataPrivacy` / `troubleshooting` / `advanced` — see `settingsSections.ts`).

- [ ] **Step 1:** Map each `useState` to the single section that consumes it (expect near-total partitioning; note any genuinely shared state).
- [ ] **Step 2:** Extract one file per section — `SettingsPreferences.tsx`, `SettingsDataPrivacy.tsx`, `SettingsTroubleshooting.tsx`, `SettingsAdvanced.tsx` — each owning its own state and IPC effects; `Settings.tsx` becomes a thin section router. Move state verbatim; this is a mechanical move, not a redesign.
- [ ] **Step 3:** One section per commit, running `npm run typecheck` + related vitest after each. Existing Settings-adjacent tests must stay green.
- [ ] **Step 4:** After all four: `npm run build` + `node scripts/sps-smoke.mjs` (build first) to confirm the Control Center still navigates.
- [ ] **Step 5 (follow-on, optional):** Apply the same pattern to `InboxSurface.tsx` (1718 ln), splitting list/detail/triage subcomponents.

## Task 2: Minimal runtime validation at the IPC boundary

Handlers cast untrusted `ipcRenderer.invoke` payloads straight to TS interfaces; no path-sanitization helper exists in `src/main`. Keep it hand-rolled — do NOT add zod.

- [ ] **Step 1:** Create `src/main/ipc/validate.ts`: `assertString(v, name)`, `assertOptionalString`, `assertProfileName(v)` (allowlist chars), and `assertPathInside(child, parentDir)` (resolve + prefix check, rejecting `..` escapes). Vitest: `tests/ipc-validate.test.ts` including traversal attempts (`../`, absolute paths, null bytes).
- [ ] **Step 2:** Inventory handlers taking file paths, profile names, or IDs used in `fs` paths (start: `src/main/ipc/sps/capture.ts:19-21`, vault/asset read-write handlers, profile-scoped handlers). Apply guards at the top of each — validation failures throw (safeHandle already redacts/logs/rethrows cleanly).
- [ ] **Step 3:** Batch by IPC module, one commit per module. Full `npm test` after — renderer tests that invoke IPC mocks must be unaffected (validation lives main-side).

## Task 3: Finish `console.*` → `log.ts` migration in `src/main` (157 call sites)

Raw console calls bypass rotation and `redactExternalText` secret-scrubbing — `log.ts:1-6` states its purpose is to replace them. Known clusters: `self-healing.ts:103,267,277`, `active-skills.ts:158,187`, `note-index.ts:373,443,664`, `yaml-utils.ts:37,100`.

- [ ] **Step 1:** `grep -rn "console\.\(log\|error\|warn\)" src/main` — inventory; skip intentional CLI/stdout output if any (verify harness entry points).
- [ ] **Step 2:** Mechanical replacement with the appropriate `log.ts` level, preserving message content; where an `err` object is logged, route through the existing redaction path. Batch by directory, one commit per batch.
- [ ] **Step 3:** Guard against regression: extend lint config with `"no-console": "error"` scoped to `src/main/**` (allowlist the few intentional sites via inline disables with reasons).
- [ ] **Step 4:** Full vitest + typecheck; run `npm run dev` briefly and confirm `desktop.log` receives the migrated output.

## Task 4: Fix docs drift (cheap, high-leverage)

`src/main/hermes.ts` is an 87-line re-export shim; real code moved to `hermes/gateway-process.ts` (lifecycle), `hermes/chat-client/*` (streaming), `hermes/grounding.ts` (retrieval helpers). Two docs still point at the pre-split location.

- [ ] **Step 1:** CLAUDE.md Architecture section: replace the `hermes.ts` description with the actual module layout (gateway lifecycle in `hermes/gateway-process.ts` + `gateway-supervisor.ts`; chat streaming in `hermes/chat-client/`; `hermes.ts` is a compatibility re-export).
- [ ] **Step 2:** `docs/BACKLOG.md` KB Phase 2 entry: `buildRetrievalSystemMessage`/`parseQueryVariants`/`fuseRankings` live in `src/main/hermes/grounding.ts:190`, not `hermes.ts`.
- [ ] **Step 3:** Spot-check the rest of CLAUDE.md's file references against the tree while in there; fix any other stale paths found.

## Task 5: Small hygiene sweep

- [ ] **Step 1:** Spot-audit the 10 `react-hooks/exhaustive-deps` suppressions (`SpsAgent/shell/ChatSurface.tsx:81`, `SpsAgent/editor/Editable.tsx:50,55`, `SpsAgent/editor/Editor.tsx:99`, `SpsAgent/modals/ExternalSessionsModal.tsx:203,266`, + 4 more via grep). For each: either the suppression is correct (add a one-line reason comment) or it hides a stale-closure bug (fix it, with a test if reproducible).
- [ ] **Step 2:** Decide `sr-*` vs `sps-*` IPC naming: do NOT rename existing channels (churn without payoff); add one line to CLAUDE.md conventions stating new channels use full-word kebab-case prefixes.

---

## Acceptance criteria

- `Settings.tsx` is a thin router; each section component owns its state; smoke passes.
- Path/profile-taking IPC handlers validate input via `src/main/ipc/validate.ts`; traversal attempts throw.
- Zero unapproved `console.*` in `src/main`, enforced by lint.
- CLAUDE.md/BACKLOG.md point at the real gateway/chat modules.
- Every exhaustive-deps suppression carries a reason or is fixed.
