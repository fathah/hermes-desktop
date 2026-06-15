# Vault-Bootstrap-on-Setup — SDLC Run (2026-06-13)

Branch: `fix/readiness-remote-mode-guard` (canonical: superset of `feat/vault-bootstrap-onboarding` + the remote-mode readiness guard).
Owner: ATHENA (orchestrator, direct authorship of security-critical main-process code per mumbo standing rule).
Step-0 triage: **YES — security-relevant.** Touches secrets resolution, vault creation, child-process spawn (`/bin/sh -c`, `keepassxc-cli`, `systemd-creds`), file-path handling, and the first-run install/readiness gate. Two-person appsec gate REQUIRED.

## Phase 1 — Understand (DONE)
- Baseline-green captured: **282/282 tracked tests pass across 34 files.**
- The 4 full-run failures are in git-ignored live-vault smoke tests (`liveSmoke.test.ts`, `liveGatewayEnv.test.ts`) that require an unlocked vault containing `ANTHROPIC_TOKEN`; the current tmpfs dump lacks it → environment-gated, NOT feature-logic, NOT tracked. Excluded from the gate signal correctly.
- Pre-existing upstream TS2742 in `src/shared/i18n/index.ts` — branch does NOT touch that file (0 mods) → not ours to fix (lint-scope rule).
- Feature is far MORE complete than memory implied: CHANGELOG (`changelogs/0.6.0.md`), README, `docs/keepassxc-vault-guide.md`, full renderer (Setup/Settings/Gateway), i18n, and a test suite already committed.

## Phase 2 — Threat Model (STRIDE) on the bootstrap surface

Assets: the vault key-file (plaintext-at-rest unless TPM-sealed), resolved secret VALUES, the vault file, the user's config (command templates).
Trust boundaries: renderer → preload → main-process IPC; main-process → child process (`sh -c`, keepassxc-cli, systemd-creds); main-process → filesystem.
Entry points: `detectExistingVault`, `createVault`, `sealKeyFileToTpm`, `checkToolAvailability`, `commandWriteSecret`/`commandDeleteSecret`, the install/readiness gate.

| STRIDE | Threat | Control (layer) | Verdict |
|---|---|---|---|
| **S**poofing | Compromised/buggy renderer drives a write/delete against a LOCKED vault | `decideCanWrite` fail-closed on `providerListSafe` key COUNT (not env-overlaid status); IPC handler RE-checks the gate (renderer can't bypass) | control present — appsec to confirm IPC re-check |
| **T**ampering | Hostile key NAME injects a forged `KEY=VALUE` line / `\n` into a dotenv-dumping read helper (cross-key poisoning) | `VALID_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/` enforced on write/delete BEFORE exec; `envKeyNames` read parser only accepts the same shape | NEEDS adversarial test (family 3) — currently 0 coverage |
| **T**ampering | Vault PATH with `'`/`$()`/`;`/backtick breaks out of the `suggestedCommand` shell string | `shellQuote()` single-quote-escapes all interpolated paths; `$HERMES_SECRET_KEY` is an env var (inert at build, resolved by sh at run) | NEEDS injection test (family 6) — currently 0 coverage |
| **R**epudiation | Silent failure hides a real misconfig (no forensic trail) | Failures return coarse structured reasons (`exit-N`, `timeout`, `db-create-failed`); write path `console.warn`s structured-only | control present |
| **I**nfo disclosure | Secret VALUE leaks to renderer / logs / argv / ps / stderr | value on stdin only (never argv/env/shell); key-NAME-only to renderer; stderr piped+discarded; structured-only error logging; result blobs carry no values | control present — appsec to confirm no value in any return shape |
| **I**nfo disclosure | Key-file written world-readable | `chmod 0600` on key + kdbx after create; `keyFileIsLocked` audit; dir `mkdir 0700` | control present |
| **I**nfo disclosure | False "TPM sealed" → user believes key is hardware-protected when plaintext | conservative seal: ANY uncertainty → `{sealed:false}` + honest 0600 fallback + actionable error code | control present (verified live: polkit blocks unprivileged seal) |
| **D**oS | Caller loop / hostile renderer hammers a synchronous helper spawn → main-thread UI wedge | get()-path spawn FLOOR (timestamp-only, null-degrade in window); list() TTL+floor cache; create/seal `TOOL_TIMEOUT_MS` 15s; write `COMMAND_TIMEOUT_MS` 5s + `maxBuffer` cap | control present — appsec to confirm bootstrap ops are not on a hot path |
| **D**oS | Oversized/malformed tmpfs dump wedges the parser | `envKeyNames` is linear over lines; NEEDS a bound/large-input test (family 4/7) | NEEDS test |
| **E**oP | `sh -c` on the command templates = shell injection | BY DESIGN: templates are the user's own config (same trust as their `.env`); the value/key never enter the shell string | accepted-risk (documented); appsec to confirm the value/key truly never reach argv/shell |
| **E**oP | Prototype pollution via a `__proto__` "key" in the parsed dump | `envKeyNames` returns an array (push), not object keys; regex rejects `__proto__=`? — `__proto__` MATCHES `[A-Za-z_]...` so it's RETURNED as a name | NEEDS test: confirm it's a harmless string in an array, never used as an object key downstream |

### High+ threats requiring a named control before ship
1. **Key-name injection (T)** → `VALID_KEY_NAME` + `envKeyNames` regex — write adversarial tests proving rejection. (family 3)
2. **Path injection in suggestedCommand (T)** → `shellQuote` — write injection canary tests. (family 6)
Both have controls in code; the gap is TEST coverage proving they hold. That's this run's build work.

## Phase 3 — Plan
1. Write adversarial tests (families 3, 4, 6, 7, 8) against `envKeyNames` (via `detectExistingVault` on a hostile tmpfs dump) and `shellQuote` (via the produced `suggestedCommand`), proving inert-data handling. These are the "test past first green" + Greptile-gate tests.
2. Re-verify the parked `wip/install-readiness-vault-aware` import-cycle concern (top-level `import { resolvedSecretMap }` in installer.ts) — decide fold-in vs keep lazy-require.
3. Run full tracked suite green after each logical change.
4. AppSec two-person gate via `delegate_task` (isolated appsec-engineer reviewer) → SHIP/FIX-THEN-SHIP/BLOCK verdict.
5. Diagrams: logical/flow Mermaid + dedicated SECRET workflow diagram (validated parse) into CHANGELOG/README/docs.
6. CISO residual-risk gate (4 criteria) + PDF SDLC report.
7. Open PR — HELD for explicit "push".

## Rollback (one line)
All work is on `fix/readiness-remote-mode-guard`, working-tree only; revert = `git checkout .` / branch is unpushed-to-upstream so no public surface until explicit push.
