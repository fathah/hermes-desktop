# Reliability & CI Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are independent — land each as its own small commit series, ordered here by blast radius.

**Goal:** Put direct tests on the resilience-critical main-process modules that currently have none, make CI exercise all three test tiers, and settle the lint gate. Evidence base: `docs/IMPROVEMENT-REPORT-2026-07-03.md` §4 items 1, 2, 6, 7.

**Conventions:** pure logic → vitest; Electron-ABI (better-sqlite3) → `verify:*` scripts; renderer UI → Playwright smoke. Both typechecks before claiming type safety. Capture a green baseline (`npm test` pass count) before starting.

---

## Task 1: Direct tests for `src/main/ssh-tunnel.ts` (258 ln, currently ZERO tests)

The module spawns and health-checks real `ssh -L` tunnel processes. Existing SSH tests (`tests/ssh-remote.test.ts`, `tests/remote-mode-url-and-spawn.test.ts`) cover `src/main/ssh-remote/*` plumbing only — not tunnel lifecycle.

- [ ] **Step 1:** Read the module; if `spawn` is called directly, refactor to accept an injectable spawn (default `child_process.spawn`) — pure seam, no behavior change.
- [ ] **Step 2:** Create `tests/ssh-tunnel.test.ts` with a fake child process (EventEmitter with `stdout`/`stderr`/`kill`). Cover: successful tunnel start → ready state; ssh exits nonzero → error surfaced (not swallowed); teardown kills the child; double-start/double-stop idempotence; health-check failure path.
- [ ] **Step 3:** `npx vitest run tests/ssh-tunnel.test.ts && npm run typecheck`.

## Task 2: Direct tests for `src/main/hermes/gateway-process.ts` (822 ln)

Only `gateway-supervisor.test.ts` (145-ln module) exists. The spawn/health-poll/recovery core (`startGatewayWithRecovery`, `restartGateway`, the 30s health timeout, the AbortController deadlines) is untested.

- [ ] **Step 1:** Identify the seams — the module already takes options (`healthTimeoutMs`, `stopTimeoutMs`); inject spawn + fetch where needed.
- [ ] **Step 2:** Create `tests/gateway-process.test.ts`: healthy-start path (health endpoint flips 200 → ready); health never comes up → timeout error, child killed; child crash after ready → recovery path invoked; `restartGateway` stops then starts; stop-timeout escalation.
- [ ] **Step 3:** Focused vitest + typecheck.

## Task 3: Tests for `src/main/scheduled-research.ts` (940 ln) and `src/main/sps-agent.ts` (1152 ln)

`scheduled-research.ts` has ~10 commented best-effort catch swallows (`:280,312,325,334,349,378,400`) — a persistent write failure currently degrades to silent no-ops.

- [ ] **Step 1:** Extract pure decision logic where entangled with I/O (schedule-due computation, merge decisions, changeset assembly) into exported functions; test those directly.
- [ ] **Step 2:** For the swallow sites: assert that persistent failures surface state (e.g. a `lastError` on the job/routine record) rather than pure silence. If a swallow site has no surfaced-state mechanism, add the minimal one (a recorded error string) — that is a behavior fix, commit it separately with its test.
- [ ] **Step 3:** For `sps-agent.ts`: test the request-assembly/response-parsing pure paths with fixture payloads (it calls the gateway via `/v1/chat/completions`; mock fetch).
- [ ] **Step 4:** Focused vitest + typecheck. Run the full `npm test` to confirm no regressions against baseline.

## Task 4: CI runs all three test tiers

`.github/workflows/ci.yml` now runs fast PR checks plus a non-PR `verify-smoke` tier for build, Electron-ABI verification, external-context verification, and SPS smoke.

- [x] **Step 1:** Add a second job (nightly `schedule:` + on push to `main`; keep PR CI fast) that runs: `npm ci` → `npm run build` → `npm run verify:note-index` → `npm run verify:external-context` → `node scripts/sps-smoke.mjs`. Linux runner needs a virtual display for Electron: use `xvfb-run -a`.
- [x] **Step 2:** Ensure the smokes' env expectations hold headless (throwaway `HERMES_HOME`, `HERMES_EC_*_ROOT` overrides — see CLAUDE.md External Context Bridge notes; smoke needs `onboardingCompleted` seeded).
- [ ] **Step 3:** Trigger the job once (push to main or `workflow_dispatch`) and confirm green before relying on it.

## Task 5: Settle the lint gate

Lint now gates CI after the formatting backlog was cleared.

- [x] **Step 1:** `npm run lint` — capture the warning/error inventory. If it is dominated by formatting, run the formatter across the tree in ONE dedicated commit (no logic changes mixed in — CONTRIBUTING.md rule).
- [x] **Step 2:** Fix or explicitly disable (with a comment) whatever remains.
- [x] **Step 3:** Remove `continue-on-error: true` from ci.yml. Full `npm test` + typecheck to confirm the formatting sweep broke nothing.

## Task 6: Subprocess timeout audit

~12 files spawn children with no visible timeout: `hermes-auth.ts`, `scheduler.ts`, `ssh-tunnel.ts`, `research-reach.ts`, `crawl4ai.ts`, `installer.ts`, `ssh-remote/core.ts`, `sudoCreds.ts`, `security/shell-hooks.ts`, `hermes/gateway-process.ts`, `hermes/chat-client/cli.ts`, `installer/computer-use.ts`.

- [ ] **Step 1:** For each site, determine whether a caller-level deadline already bounds it (some do). Produce a short table in the PR description: site → bounded-by → action.
- [ ] **Step 2:** For genuinely unbounded sites, add an explicit timeout (execFile `timeout` option, or a kill-timer for long-lived spawns) sized to the operation. Long-lived processes (tunnels, gateway) get startup deadlines, not lifetime timeouts.
- [ ] **Step 3:** Focused tests where a seam exists; typecheck + full vitest.

## Task 7: Toolchain pins

- [ ] **Step 1:** Add `"engines": { "node": ">=22" }` to `package.json` (CI uses Node 22).
- [ ] **Step 2 (optional, larger):** Evaluate enabling type-aware lint with `@typescript-eslint/no-floating-promises` on `src/main` only. If the violation count is small, fix and enable; if large, record the count in `docs/BACKLOG.md` and defer.

---

## Acceptance criteria

- `ssh-tunnel.ts`, `gateway-process.ts`, `scheduled-research.ts`, `sps-agent.ts` each have a direct test file covering start/failure/teardown (or equivalent) paths.
- A scheduled CI job runs build + both `verify:*` harnesses + the SPS smoke, and has passed at least once.
- Lint gates CI (no `continue-on-error`), with the formatting backlog cleared in a single dedicated commit.
- Every subprocess spawn site is either bounded by a timeout or documented as caller-bounded.
