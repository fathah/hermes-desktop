# Upstream Capture & Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Phases are independently landable — land each as its own small PR/commit series. Phases 1 and 2 are independent starting points; Phase 3 needs 2; Phase 4 needs 2 (benefits from 1); Phase 5 needs 3.

**Goal:** Make upstream `NousResearch/hermes-agent` updates safe and visible: (a) an engine update never silently breaks the desktop app, (b) new engine capabilities surface to the user in-app, (c) the UI never shows controls the installed engine can't honor.

**Decided strategy (owner-confirmed): record-and-anchor, no hard pin.** The engine keeps tracking upstream `main`. The desktop app records the installed SHA and the last contract-verified SHA per profile, verifies its consumed contract after every engine update, and offers manual one-click rollback to the last verified SHA. Rejected as over-engineering for a single-user app: per-release pin manifests, AST/codegen manifest sync, Python argparse introspection scripts, automatic rollback.

**Background (see `docs/IMPROVEMENT-REPORT-2026-07-03.md` §3 for the full map):** the app couples to hermes-agent through five channels — gateway HTTP, CLI subcommands/flags, direct config.yaml/.env editing, direct JSON scraping, GitHub polling — and only the chat transport is contract-checked today (`resolveHermesChatTransport`, `src/main/hermes/chat-client/api.ts:57-256`, remote/SSH only). Drift has already shipped breakage twice (toolset alias rename → `config-health.ts:782-937`; mirrored model list in `model-discovery.ts`). The installed engine already serves `GET /v1/capabilities` with `features` and `endpoints` maps (upstream `gateway/platforms/api_server.py:1213-1290`), and the upstream CLI is a single argparse tree (`hermes_cli/_parser.py`) — both make verification cheap.

**Repo conventions that bind every phase:**

- Every new IPC method must appear in BOTH `src/preload/index.ts` and `src/preload/index.d.ts` or `tests/preload-api-surface.test.ts` fails.
- Register IPC handlers via `safeHandle` (`src/main/ipc/safe-handle.ts`), in a module under `src/main/ipc/`.
- Pure logic → vitest; anything opening the SQLite index or needing Electron ABI → a `verify:*` script; renderer UI → Playwright smoke. Both typechecks (`npm run typecheck`) before claiming type safety.
- Keep commits small and single-purpose.

## Status refresh — 2026-07-07

This plan is retained as historical implementation context. Source has moved
past several unchecked boxes below; use this refresh before treating the older
checkboxes as current truth.

Shipped in current source:

- Installed SHA and capability snapshots: `src/main/installer.ts`
  (`getInstalledEngineSha()`), `src/main/engine-capabilities.ts`,
  `src/shared/engine-capabilities.ts`, `src/renderer/src/hooks/useEngineCapabilities.ts`,
  `src/preload/bridges/engine.ts`, and `tests/engine-capabilities.test.ts`.
- Contract manifest and drift guard: `src/shared/engine-contract.ts` and
  `tests/engine-contract-drift.test.ts`.
- Contract verifier: `src/main/engine-contract-verify.ts`,
  `scripts/verify-engine-contract.sh`, `scripts/verify-engine-contract.ts`,
  `tests/engine-contract-verify.test.ts`, and the `verify:engine-contract`
  npm script.
- Update safety gate and rollback plumbing: `src/main/hermes-agent-updates.ts`,
  `src/main/installer.ts` (`rollbackEngineTo()`), `src/main/ipc/system.ts`
  (`rollback-engine`, `verify-engine-contract`, engine-capability handlers),
  `src/preload/bridges/engine.ts`, `tests/hermes-agent-update-check.test.ts`,
  and `tests/hermes-agent-update-routine.test.ts`.
- Upstream watch anchoring and contract-risk reporting: `src/main/hermes-upstream-watch.ts`
  and `tests/hermes-upstream-watch.test.ts`.

Still open in the newer roadmap:

- Release-channel default updates (`release` by default, `main` as an explicit
  fast channel).
- Live install-script refresh with sanity-checked fallback to bundled snapshots.
- Pre-launch compatibility gate for manually changed local engine checkouts.
- A unified engine-update-state owner that consolidates update routine,
  capability, verification, and upstream-watch state.
- Broader local-mode UI capability gating using engine snapshot plus connection
  capability matrix.

---

## Phase 1 — Installed-SHA anchor + engine capability snapshot

**Files:**

- Create: `src/main/engine-capabilities.ts`
- Create: `tests/engine-capabilities.test.ts`
- Modify: `src/main/installer.ts` (add `getInstalledEngineSha()`)
- Modify: `src/main/hermes/chat-client/api.ts` (extract/export the JSON-probe + capability-normalization helpers; no behavior change)
- Modify: `src/main/hermes/gateway-process.ts` (trigger snapshot refresh on gateway-ready)
- Modify: `src/main/config/desktop-store.ts` (persist snapshot + `installedSha`/`lastVerifiedSha` per profile)
- Modify: `src/main/ipc/system.ts` (or a new `src/main/ipc/engine.ts`): `safeHandle("get-engine-capabilities")`, `safeHandle("refresh-engine-capabilities")`
- Modify: `src/preload/bridges/engine.ts` + `engine.types.ts` + `src/preload/index.d.ts`
- Create: `src/renderer/src/hooks/useEngineCapabilities.ts`
- Modify: `src/renderer/src/screens/Providers/Providers.tsx` (one minimal consumer: engine feature summary in the status area)

- [ ] **Step 1: `getInstalledEngineSha()`** — in `installer.ts`, next to `checkHermesUpdate` (which already runs git plumbing at `installer.ts:454-507`), add a function that runs `git rev-parse HEAD` in `HERMES_REPO` and returns the SHA or `null` (non-git install, remote mode). Reuse the existing exec helpers/timeouts in that file. Vitest with a mocked exec.
- [ ] **Step 2: extract probe helpers** — in `chat-client/api.ts`, the JSON-probe fetch and `/v1/capabilities` normalization are private. Export them (or move to a small `src/main/hermes/capability-probe.ts` re-imported by `api.ts`). Pure refactor: existing chat-transport tests (`chat-client-streaming.test.ts`, `chat-client-deadline.test.ts`) must stay green unchanged.
- [ ] **Step 3: `engine-capabilities.ts`** — fetch `GET /v1/capabilities` from the active gateway URL (via the extracted probe helper, with an AbortController deadline), normalize to `{ fetchedAt, mode, engineSha, features: Record<string, boolean>, endpoints: Record<string, string> }` (`engineSha` from Step 1; null in remote mode), persist per profile in `desktop-store.ts` following the `hermesAgentUpdateByProfile` pattern (`desktop-store.ts:174-337`). An engine too old to serve `/v1/capabilities` yields `{ features: {}, endpoints: {}, status: "unknown" }` — never an error. Vitest with fixture payloads shaped like the real upstream response.
- [ ] **Step 4: refresh triggers** — call the refresh (fire-and-forget, caught) from `gateway-process.ts` when the gateway reaches healthy, and on connection-mode change. Do NOT probe per chat turn or per scheduler tick.
- [ ] **Step 5: IPC + preload + hook + minimal consumer** — `get-engine-capabilities` (read persisted snapshot) and `refresh-engine-capabilities` (force re-probe). Preload parity in both files. `useEngineCapabilities()` hook; render a small "Engine features" summary in Providers near the existing upstream-watch section (`Providers.tsx:~1192`). UI gating rule for future consumers: a feature is available iff the engine snapshot says so AND the `connection-capabilities.ts` mode matrix allows it — the two answer different questions (engine version vs connection mode).
- [ ] **Step 6: verify** — `npx vitest run tests/engine-capabilities.test.ts tests/preload-api-surface.test.ts && npm run typecheck && npm run build`.

**Non-goals:** no broad feature-hiding across screens yet (that lands per-screen later, gated on this snapshot); no change to local chat transport (hard-coded `v1ChatCompletions` is fine for a managed local gateway).

## Phase 2 — Coupling manifest + drift test (zero runtime change)

**Files:**

- Create: `src/shared/engine-contract.ts`
- Create: `tests/engine-contract-drift.test.ts`

- [ ] **Step 1: the manifest** — a typed registry:

```ts
export type ContractTier = "fail" | "warn";
export interface EngineContractEntry {
  id: string;
  kind: "cli" | "http" | "config-key" | "json-file";
  value: string; // e.g. "skills browse", "/v1/chat/completions", "model.provider", "cron/jobs.json"
  flags?: string[]; // for cli: consumed flags, e.g. ["--query", "--json"]
  fields?: string[]; // for json-file: consumed field names
  usedBy: string[]; // repo paths of call sites
  upstreamPaths: string[]; // upstream repo paths implementing this surface
  tier: ContractTier; // fail = verifier hard-fails; warn = heuristic only
}
```

Populate from the audited inventory (report §3): CLI — `profile delete|use`, `pairing list|approve|revoke|clear-pending`, `checkpoints status|prune|clear`, `mcp *`, `doctor`, `update`, `dump`, `security audit`, `prompt-size --json`, `skills browse|install|uninstall` (`--query --json --yes`), `cron *`, `kanban *` (flag set from `kanban.ts`), `--version` → tier `fail`. HTTP — `/health`, `/v1/chat/completions`, `/v1/runs/{id}/approval`, `/api/jobs`, `/v1/capabilities`, `/openapi.json` → tier `fail`. Config keys (`model.*`, `providers.*`, `api_server.*`, `memory.provider`, `mcp_servers` block) and JSON files (`cron/jobs.json` field list from `cronjobs.ts:24-59`, `models.json`, `auth.json`) → tier `warn`. `upstreamPaths` hints: skills → `hermes_cli/skills*.py`, gateway endpoints → `gateway/platforms/api_server.py`, cron → `cron/`, models/providers → `hermes_cli/models.py`, `providers/`.

- [ ] **Step 2: the bidirectional drift test** — vitest that greps `src/main` for (a) first string-literal args at `hermesCliArgs(`/CLI spawn call sites and (b) `"/v1/..."` / `"/api/..."` string literals, then asserts: every found token is declared in the manifest, and every manifest entry's `usedBy` files still contain the token. Small explicit allowlist for false positives. The point: the build fails the moment anyone adds an undeclared CLI/HTTP coupling. (Grep, not AST — ~25 call sites don't justify codegen.)
- [ ] **Step 3: verify** — `npx vitest run tests/engine-contract-drift.test.ts && npm run typecheck`. Zero runtime change; safest first landing.

## Phase 3 — Contract verifier (needs Phase 2)

**Files:**

- Create: `src/main/engine-contract-verify.ts`
- Create: `tests/engine-contract-verify.test.ts`
- Create: `scripts/verify-engine-contract.mjs` + npm script `verify:engine-contract` (runs against the real installed engine, like the other `verify:*` harnesses; NOT in hermetic CI)
- Modify: IPC module + preload (both files): `safeHandle("verify-engine-contract")`
- Modify: `src/main/config/desktop-store.ts` (persist last verification result per profile)
- Modify: `src/renderer/src/screens/Providers/Providers.tsx` ("Verify engine contract" action near the doctor/update controls, showing pass/broken/unknown + findings)

- [ ] **Step 1: pure parse functions** — `parseHelpSubcommands(helpText)` and `parseHelpFlags(helpText)` for argparse output (upstream is one argparse tree, `hermes_cli/_parser.py`; subcommands appear in the `{a,b,c}` choices line and the positional list). Vitest against fixture help text captured from the real engine.
- [ ] **Step 2: orchestration** — for each `fail`-tier CLI entry: run `hermes --help` once, then `hermes <subcommand> --help` per consumed subcommand (use `hermesCliArgs()` from `installer/paths.ts` and the repo's hidden-subprocess options), substring-check consumed flags. Explicit per-spawn timeout (e.g. 15s) and bounded concurrency (2–3). For `fail`-tier HTTP entries: compare against the Phase-1 snapshot's `endpoints` map; snapshot `unknown` → verdict `unknown`, never `broken`. `warn`-tier config/JSON entries: grep the installed repo (`hermes_cli/config.py`, `cli-config.yaml.example`) for key segments; report warnings only — reactive protection for config drift stays with the existing `config-health.ts` check/fix pattern. Result: `{ status: "passed" | "broken" | "unknown", findings: [{ entryId, verdict, detail }] }`.
- [ ] **Step 3: expose** — on-demand IPC only (each `--help` costs a Python startup; never run per-launch or per-tick). Persist last result; Providers action + result display. Preload parity.
- [ ] **Step 4: verify** — `npx vitest run tests/engine-contract-verify.test.ts tests/preload-api-surface.test.ts && npm run typecheck && npm run build`, then `npm run verify:engine-contract` against the real engine once, manually.

## Phase 4 — Upstream watch v2: anchored, contract-aware, feeding What's-new (needs Phase 2)

**Files:**

- Modify: `src/main/hermes-upstream-watch.ts`
- Modify: `tests/hermes-upstream-watch.test.ts`
- Create: `src/shared/engine-affordances.ts` (or extend `src/shared/update-affordances.ts`)
- Modify: `src/renderer/src/screens/SpsAgent/updates/useWhatsNew.ts` + `WhatsNewPanel.tsx` + `WhatsNewPanel.test.tsx`
- Modify: `src/renderer/src/screens/Providers/Providers.tsx` (counts copy)

- [ ] **Step 1: anchor to the installed SHA** — replace the per-path polling (N+2 GitHub calls) with one `GET /repos/NousResearch/hermes-agent/compare/{installedSha}...main` call (via `publicFetch`, same headers). The response's commits + changed files ARE "what you'd get if you update." Keep the current per-path behavior only as fallback when `installedSha` is unavailable (remote mode, non-git install). Extend state with `{ anchorSha, pendingCommitCount, contractRiskCount }`.
- [ ] **Step 2: contract-risk category** — cross-reference the compare response's changed file paths against the manifest's `upstreamPaths`; matches classify as a new `contract-risk` category (add to `HermesUpstreamWatchCategory` and `CATEGORY_ORDER`, first). Providers copy becomes "N commits behind · M touch surfaces this app depends on". Report file keeps its current format plus the new section.
- [ ] **Step 3: tests** — fixtures shaped like the compare-API response; assert anchoring, fallback, and contract-risk classification.
- [ ] **Step 4 (separate commit/PR — 4b): engine-sourced What's-new cards** — optional, fail-soft LLM summarization: POST the commit subjects + contract-risk list to the app's own gateway `/v1/chat/completions` (follow the `scheduled-research.ts` call pattern) asking for 0–3 user-meaningful cards `{ title, body, cta? }`. Define `EngineAffordance` (`source: "engine"`, keyed by `"<anchorSha>..<headSha>"` range instead of app version) alongside `RELEASE_AFFORDANCES`; merge into `useWhatsNew` with the existing dismissal plumbing (dismissal stores the seen commit range). Gateway down or call fails → no cards, markdown report still lands. Cards must be labeled as describing an **available update**, not installed features.
- [ ] **Step 5: verify** — `npx vitest run tests/hermes-upstream-watch.test.ts src/renderer/src/screens/SpsAgent/updates/WhatsNewPanel.test.tsx && npm run typecheck && npm run build`.

**Non-goals:** the watch never triggers updates; no GitHub token management (unauthenticated compare call is one request/day).

## Phase 5 — Update safety gate + manual rollback (needs Phase 3)

**Files:**

- Modify: `src/main/hermes-agent-updates.ts`
- Modify: `tests/hermes-agent-updates.test.ts` (or create if absent)
- Modify: `src/main/installer.ts` (add `rollbackEngineTo(sha)`)
- Modify: IPC + preload (both files): `safeHandle("rollback-engine")`
- Modify: the Settings/Providers surface that shows the engine update routine (confirmation dialog + break alert)

- [ ] **Step 1: gate the autoApply path** — in `runHermesAgentUpdateCheck` (`hermes-agent-updates.ts:110-275`): capture `preUpdateSha` (Phase 1's `getInstalledEngineSha()`) before `runHermesUpdate()`; after update + gateway restart, run the Phase-3 verifier fail-tier and refresh the capability snapshot. Extend `HermesAgentUpdateRoutineResult` with `contract: { status, findings }`. Advance `lastVerifiedSha` in the desktop store only on `passed`. On `broken`: keep the update applied (no auto-rollback), set a loud result status, emit a notification, and set a flag that suppresses further autoApply until the user acknowledges in the UI. `unknown` (hermetic/fake engine, old engine) passes through without advancing `lastVerifiedSha`.
- [ ] **Step 2: manual rollback** — `rollbackEngineTo(sha)` in `installer.ts`: `git checkout <sha>` in `HERMES_REPO` followed by the dependency re-install step (reuse the `install.sh --commit` path / the same pip-sync the installer already runs). IPC `rollback-engine` targets `lastVerifiedSha`, behind a renderer confirmation dialog that states the caveat plainly: rollback moves code AND reinstalls Python deps; it is not instantaneous. **No automatic rollback ever** — `hermes update` also moves the venv, so an automatic `git checkout` can produce a state worse than the breakage.
- [ ] **Step 3: tests** — vitest for the gate decision logic with a mocked verifier + mocked git (the module is already structured around injected results); assert `lastVerifiedSha` advancement rules and autoApply suppression. Playwright smoke stays untouched (fake engine → verifier reports `unknown` → pass-through).
- [ ] **Step 4: verify** — focused vitest + `tests/preload-api-surface.test.ts` + `npm run typecheck` + `npm run build`.

---

## Acceptance criteria (whole plan)

- The desktop store records, per profile: installed engine SHA, last contract-verified SHA, capability snapshot, last verification result.
- Adding a new CLI/HTTP coupling in `src/main` without declaring it in `engine-contract.ts` fails vitest.
- After an auto-applied engine update, a contract break is detected within the same routine run, surfaced loudly, and further auto-applies are suppressed until acknowledged; one click rolls back to the last verified SHA.
- The upstream watch reports the delta between the installed SHA and upstream head, flags commits touching coupled surfaces, and (4b) surfaces 0–3 dismissible What's-new cards describing the available update.
- UI can query `useEngineCapabilities()` and gate features on engine-snapshot AND connection-mode matrix.
- All hermetic harnesses stay green with fake engines (every probe degrades to `unknown`, never `broken`).
