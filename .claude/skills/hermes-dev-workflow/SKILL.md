---
name: hermes-dev-workflow
description: The working method for making changes to Hermes Desktop safely — problem decomposition, a verification ladder keyed by change type, git/worktree discipline, and output structure. Use when making any code change, bug fix, feature, refactor, or review in this repo — load BEFORE editing files — and when diagnosing unexplained test failures, "cannot find module" errors, or vanishing writes. CLAUDE.md states WHAT the invariants are; this skill states HOW to work.
---

# Hermes Desktop Dev Workflow

## The loop

1. **Work backwards from the user-visible outcome** before proposing steps. State what "done" looks like for the end user, then plan toward it.
2. **For bugs, frame before fixing** — `As a [user], I want [behavior], so that [benefit]` plus 1–2 testable acceptance criteria. Then: reproduce with a failing test → fix → prove (reproducing test passes, full relevant suite passes, story satisfied). Skip the framing for typos, CI/build fixes, dependency bumps, infra-only bugs, and <3-line obvious fixes.
3. **Locate before reading.** Prefer a targeted search index if one is available in your environment; otherwise Grep/Glob with specific symbols, not broad terms. Read at most 3–5 files before making the first change — iterate from there. Delegate broad exploration to subagents and keep the conclusions, not file dumps.
4. **Smallest change that works.** Before writing code, walk the ladder: needed at all? stdlib? platform feature? existing dependency? one line? Only then new code. One operation per line — named intermediates over chained calls, nested returns, or compound conditions. No unrequested abstractions; never simplify away validation, error handling, security, or accessibility.
5. **Commit early and small** — one logical change per commit (CONTRIBUTING.md). Don't bundle formatting sweeps with logic.

## Verification ladder

Run the tier that matches the change **before claiming done**. If a change matches multiple rows, run the UNION of all matching tiers — never just the cheapest. Regardless of tier, run `npx eslint <touched files>` before committing (nothing else enforces lint on feature branches). Evidence before assertions: paste the passing output; if something fails, report it plainly — never claim green without running.

| Change type                                 | Required verification                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs only                                   | Proofread; check cited paths exist                                                                                                          |
| Pure renderer logic / IPC-mocked components | `npx vitest run <file>` then `npm run typecheck`                                                                                            |
| Main process or preload                     | `npm run typecheck` (BOTH projects) + `npx vitest run`                                                                                      |
| Anything that opens the note index          | `npm run verify:note-index` (Electron ABI — vitest cannot open it)                                                                          |
| External-context bridge                     | `npm run verify:external-context`                                                                                                           |
| Renderer UI behavior                        | `npm run build` then `node scripts/sps-smoke.mjs`                                                                                           |
| Storage substrate                           | Full gate from `docs/STORAGE.md`: both typechecks → eslint touched files → `npx vitest run` → `npm run verify:note-index` → `npm run build` |

Hard invariants the gate enforces:

- Every new preload method must appear in BOTH `src/preload/index.ts` and `src/preload/index.d.ts`, or `tests/preload-api-surface.test.ts` fails.
- Two TS projects, two typechecks — `npm run typecheck` runs both; passing one proves nothing about the other.
- Multi-file changes → run the full test suite. Do not commit on red. Before a refactor, capture the green-test and lint-warning baseline so regressions are unambiguous.

## Git & concurrency discipline

- **Never edit in the shared primary tree.** One dedicated worktree per task; run `bash scripts/setup-worktree.sh` (or `npm ci`) inside it. NEVER symlink `node_modules` between trees — native modules (`better-sqlite3`) plus a concurrent `npm install` corrupt builds mid-flight.
- **Integrate in series:** `git fetch origin` → `git rebase origin/main` → re-run the verification tier → `git push` (clean fast-forward). A rejected push is success, not an error — fetch, rebase, retry. No merge commits into `main`; no force-push on shared branches.
- Husky hooks only gate `release/*` branches — feature branches are ungated, so run checks manually.
- One integrator at a time. If another session is active in the same tree, do not write — surface the conflict instead.

## Output structure

- **Lead with the outcome** — what changed / what was found, then supporting detail.
- Cite evidence as `file:line` for every claim.
- End substantive changes with a 1–2 line self-check that the change does what was asked; if it doesn't, self-correct.
- **Audit/review requests HARD-STOP at findings** (severity + `file:line` evidence). Do not auto-expand into fixes — remediation is a separate, opt-in step.
- After 2 consecutive failures of the same approach, stop and change strategy; when stuck, summarize what was tried and escalate.

## Known pitfalls

Failure signatures, causes, and fixes earned from real incidents: read [PITFALLS.md](PITFALLS.md). Consult it FIRST when you hit "cannot find module", vanishing writes, phantom typecheck errors, or unexplained test failures.
