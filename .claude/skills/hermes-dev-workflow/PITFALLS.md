# Known Pitfalls

Each entry: **symptom → cause → fix**. These come from real incidents in this repo, not theory.

## Test harness routing (the `better-sqlite3` ABI split)

**Symptom:** `Error: Cannot find module` or `NODE_MODULE_VERSION` mismatch when a test touches the note index under vitest.
**Cause:** `better-sqlite3` is compiled for Electron's node ABI, not vitest's node. Any code that _opens_ `.note-index.db` cannot run under vitest.
**Fix:** route the code to the right harness — the canonical routing is the Verification ladder in [SKILL.md](SKILL.md). In short: pure logic and IPC-mocked components stay under vitest; anything that opens the index goes to `npm run verify:note-index` (runs under `ELECTRON_RUN_AS_NODE=1`); renderer UI end-to-end goes to the Playwright-Electron smoke.

## Phantom "cannot find module" typecheck errors in files you never touched

**Cause:** the worktree shares or symlinks `node_modules` with another tree while a concurrent session runs `npm install` there — native module builds get corrupted mid-flight.
**Fix:** every worktree gets its OWN `node_modules`: `bash scripts/setup-worktree.sh` (or `npm ci`) right after `git worktree add`. Never symlink.

## vitest fails with tmp-dir/permission errors

**Cause:** the session's `TMPDIR` can be unwritable in some sandboxed environments.
**Fix:** point it at a directory you can write, e.g. `TMPDIR=$(mktemp -d) npx vitest run …`.

## Pre-existing test failures — don't chase them

**The durable rule:** before assuming your change broke a test, run the same test at the base commit (`git stash`, or a worktree at `origin/main`). Only failures you _introduced_ are yours — but a failure in a "known red" test can still be a real regression, so compare against base rather than trusting any list.
Examples known red on base as of 2026-07: `tests/compat-host-derived-key.test.ts`, plus 2 `proc.unref`-related failures.

## KB/vault writes that vanish (blob mode)

**Symptom:** a write to a workspace page appears to succeed, then disappears.
**Cause:** which store is authoritative depends on `storageMode`. In `blob` mode (the default) `workspace.json` is authoritative and `vault/` is an additive mirror — so a direct file write to `vault/` gets overwritten. In `vault` mode markdown on disk is authoritative. In both modes `.note-index.db` (SQLite) is only a rebuildable index, never a source of truth.
**Fix:** in EITHER mode, route ALL programmatic page writes through the pending-changes path → `commitChangeset` in `src/renderer/src/screens/SpsAgent/lib/storageActions.ts` — it writes to the authoritative store for the active mode. Never write vault files directly. Read `docs/STORAGE.md` before touching the substrate.

## SPS styles leaking into the Hermes renderer — or dying inside SPS

**Cause:** SPS styles are the prototype stylesheets carried over VERBATIM into `screens/SpsAgent/styles/` and mechanically confined to `.sps-scope` by `scripts/scope-sps-css.mjs`. They are not Tailwind and must not be re-derived in it.
**Fix:** edit the source stylesheets and re-run the scope script; never hand-edit the generated scoping, never move SPS rules to global scope. Theme/layout switching is attribute swaps on the scope element only.

## SSRF guard is load-bearing — never loosen it

`src/main/security/ssrf-guard.ts`: external HTTP fetchers pin the validated IP and re-validate every redirect hop. When editing unfurl/fetch code, preserve the IP-pinning lookup exactly. Tests: `tests/ssrf-guard.test.ts`.

## External Context Bridge structural invariants

1. **Index-time redaction:** `applyFragments` in `src/main/external-context/db.ts` is the SINGLE writer and redacts every message before INSERT. Do not add another write path. `npm run verify:external-context` asserts a seeded key never reaches `messages`/`messages_fts`.
2. **Untrusted fencing:** every surface that shows transcript excerpts (UI, Save-to-KB, MCP) wraps them in an untrusted banner + fence and never auto-injects them into a chat turn.

## `setConfigValue` drops nested keys

**Symptom:** config sub-keys silently disappear after a write.
**Cause:** `setConfigValue` (`src/main/config/yaml-config.ts`) replaces the value at the key wholesale — it does not deep-merge, so writing one nested field erases its siblings.
**Fix:** read-modify-write the WHOLE object at that key; never write a nested path in isolation.

## `electron-builder.yml` `mac.extendInfo` must be a YAML mapping

A YAML _list_ there is accepted silently and drops ALL macOS usage descriptions from Info.plist (this shipped broken once). Verify with a `--dir` build + PlistBuddy after touching it.

## Cron job creation success signature

**Symptom:** cron-job creation looks like it failed even though the job exists.
**Cause:** the Hermes CLI reports success via stdout `Created job: <id>`, not exit code alone; `src/main/cron-quality.ts` parses that line (`/Created job:\s*(\S+)/i`).
**Fix:** parse for the stdout signature. This is coupled to upstream Hermes Agent output — if it stops matching, re-verify against the current CLI output before changing the regex.

## N-API modules load under vitest too

`node-mac-contacts` (and other N-API optionalDependencies) load fine under vitest on macOS — unlike ABI-locked `better-sqlite3`. A "module absent" test branch must force the non-darwin path explicitly; it will NOT trigger naturally on a Mac.
