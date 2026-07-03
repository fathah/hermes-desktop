# Hermes Desktop — Deep-Dive Improvement Report

**Date:** 2026-07-03
**Method:** read-only static analysis of the full tree (three parallel exploration passes: upstream coupling, architecture health, update/UX infrastructure), plus targeted verification against the installed engine at `~/.hermes/hermes-agent`.
**Companion plans (LLM-executable):**

- `docs/superpowers/plans/2026-07-03-upstream-capture-and-exposure.md` — the flagship track
- `docs/superpowers/plans/2026-07-03-reliability-and-ci-hardening.md`
- `docs/superpowers/plans/2026-07-03-codebase-health.md`

---

## 1. The steelmanned question

The owner's framing was: _"we built an app on top of Hermes Agent — how do we ensure that all updates by Hermes are captured in this app and exposed to the user correctly?"_

Taken literally ("capture ALL updates"), this is the wrong target. Full feature parity with a fast-moving upstream is an unwinnable treadmill for a GUI wrapper: upstream ships daily, desktop releases ship weekly at best, and hand-mapping every upstream feature to bespoke UI guarantees permanent lag. The steelmanned version splits into three problems that need different machinery:

1. **Don't break.** An upstream update must never silently break the app (endpoint renamed, CLI flag removed, config key moved). This is a _contract/compatibility_ problem. Today the app consumes an implicit API surface of hermes-agent with no pin, no manifest, and no negotiation — every engine update is a gamble.
2. **Don't hide.** When upstream ships a new capability, the user should see it in-app without reading upstream release notes. This is a _discovery/affordance_ problem: a static GUI over a dynamic engine.
3. **Don't lie.** The GUI must not show controls for features the installed engine lacks (or hide ones it has). This is a _capability-negotiation_ problem.

The winnable strategy: **record what you depend on, detect what changed, degrade gracefully for what you don't understand, and surface what's new generically** — dynamic enumeration and summarized release deltas, not hand-mapped parity.

---

## 2. Codebase map and maturity assessment

~158K lines in `src/` across 652 non-test TS/TSX files, with 338 test files. This is a disciplined codebase, not a vibe-coded one:

- Zero `TODO`/`FIXME`/`HACK` markers in `src/` (debt is tracked in `docs/BACKLOG.md` instead).
- Zero `as any` casts; only 5 explicit `: any` annotations.
- All 209 IPC channels route through one `safeHandle()` wrapper (`src/main/ipc/safe-handle.ts`) with redacted, structured error logging.
- Preload↔`.d.ts` parity is structurally enforced by `tests/preload-api-surface.test.ts`.
- Network egress is centralized through tiered fetch helpers (`publicFetch`/`providerFetch`/`gatewayFetch`, documented in `docs/SECURITY-RESIDUALS.md`), with SSRF IP-pinning.
- Dependencies are current-generation (Electron 39, React 19, Zustand 5, electron-vite 5).
- Zustand selector discipline is excellent: 334 narrow selectors, zero whole-store subscriptions.

The risk profile is **unmanaged growth**, not sloppiness: a handful of files have outgrown their boundaries, test coverage is lumpy in exactly the highest-blast-radius modules, and CI quietly stopped gating on two of the three test tiers.

---

## 3. The upstream coupling map (the heart of the question)

The app couples to `NousResearch/hermes-agent` through **five channels. Only one of them is contract-checked today.**

### 3.1 Gateway HTTP (partially checked)

Endpoints consumed: `GET /health`, `POST /v1/chat/completions` (~15 call sites), `POST /v1/runs/{id}/approval`, `GET /openapi.json`, `GET /v1/capabilities`, `GET/POST /api/jobs*` (remote mode only).

A real capability-negotiation mechanism exists — `resolveHermesChatTransport` (`src/main/hermes/chat-client/api.ts:57-256`) probes `/openapi.json` and `/v1/capabilities`, caches 30s, re-probes on 405, and falls back across three transports — **but it only covers chat, and only in remote/SSH mode.** Local mode hard-codes `v1ChatCompletions`. Verified against the installed engine: `/v1/capabilities` already serves rich `features` and `endpoints` maps (`gateway/platforms/api_server.py:1213-1290` upstream) — the negotiation surface exists upstream and is barely used.

### 3.2 CLI subprocess (unchecked)

Hard-coded subcommands and flags across: `installer.ts` (`--version`, `doctor`, `update`, `dump`, `security audit`, `prompt-size --json`), `cronjobs.ts` (`cron …`), `checkpoints.ts`, `pairing.ts`, `profiles.ts`, `skills.ts` (`skills browse|install|uninstall --query --json --yes`), `mcp-servers.ts`, `kanban.ts` (a very large flag set). If upstream renames a subcommand or flag, the only failure signal is a non-zero exit or unparseable stdout — silent from the user's perspective.

### 3.3 Direct config-file editing (unchecked)

- `config.yaml` is read/written at hard-coded dotted paths (`model.*`, `providers.*`, `api_server.*`, `memory.provider`) via the `yaml` lib — unknown upstream keys survive round-trips but are invisible to the GUI.
- The `mcp_servers:` block is parsed by **regex over raw text** (`mcp-servers.ts:194,462-507`) — the most fragile coupling in the repo.
- `.env` is parsed by a hand-rolled line regex against a hard-coded `PROVIDER_ENV_KEYS` map (`installer.ts:102-142`) that must be manually extended for every new upstream provider.

### 3.4 Direct JSON scraping (unchecked)

`cron/jobs.json` is read with a hard-coded field list (`cronjobs.ts:24-59`); local and remote cron are two independently-maintained code paths for the same feature. `models.json` and `auth.json` follow the same pattern.

### 3.5 GitHub polling (exists, but not anchored)

`src/main/hermes-upstream-watch.ts` runs daily off the scheduler: fetches `/commits/main`, `/releases/latest`, and the latest 20 commits per watched path, classifies them by keyword/path heuristics into 8 categories, and writes a dated markdown report to `<profileHome>/upstream-watch/`. It is surfaced in Providers as classified counts plus "Run now" / "Open report" (the report opens via the OS file opener). Its gaps: it is **not anchored to the installed engine commit** (it reports "what's recent upstream," not "what you're missing"), classification is heuristic-only, and it feeds nothing into the What's-new UI.

### 3.6 Drift has already bitten — twice, plus one workaround

- `config-health.ts:782-937` (`checkLegacyToolsetName`/`fixLegacyToolsetName`) exists solely because upstream renamed the default toolset alias `hermes` → `hermes-cli`, which broke configs silently until a reactive fix shipped.
- `model-discovery.ts` hard-codes a mirror of upstream `hermes_cli/models.py` with the in-code comment that the list "will drift as new models ship."
- `model-config.ts:157-189` documents a credential-fallback workaround for an unnumbered upstream bug.

### 3.7 Structural facts that shape the fix

- **No version pin exists anywhere in this repo.** Installs track upstream `main` HEAD (`resources/install.sh:74`); the installed commit lives only in `~/.hermes/hermes-agent/.git`. There is no record of which engine commit any desktop release was tested against. (`install.sh --commit` exists but is unused by the GUI.)
- Update detection is git ahead/behind (`installer.ts:454-507`); apply delegates to the engine's own `hermes update`; a dirty repo makes auto-apply silently skip; post-update the only action is a gateway restart — no contract re-validation.
- **Three disconnected update-state stores can disagree:** `hermes-agent-updates.ts` (git ahead/behind), `hermes-upstream-watch.ts` (GitHub API), `capability-risk-store.ts` (per-plugin update status).
- **CI and the smoke harnesses are hermetic by design** (fake python/hermes stubs), so nothing in automation ever exercises the real engine — upstream drift detection must be its own live, scheduled probing.
- Feature enumeration is mixed: skills directories and memory-provider plugin dirs are scanned dynamically (new ones appear automatically), but memory providers are decorated from a hard-coded `KNOWN_PROVIDERS` table (`installer.ts:842-886`) and models are mirrored statically.

**The remedy** — installed-SHA anchoring, a typed coupling manifest with a drift test, a contract verifier, compare-API upstream watch, engine-sourced What's-new cards, and a post-update safety gate — is specified in `docs/superpowers/plans/2026-07-03-upstream-capture-and-exposure.md`.

---

## 4. Architecture-health findings (ranked)

1. **Resilience-critical modules have zero direct tests.** `src/main/ssh-tunnel.ts` (258 ln — spawns real `ssh -L` tunnels; no test file at all), `src/main/hermes/gateway-process.ts` (822 ln — gateway spawn/health-poll/recovery; only the 145-ln supervisor is tested), `src/main/sps-agent.ts` (1152 ln), `src/main/scheduled-research.ts` (940 ln, ~10 commented best-effort catch swallows — a persistent write failure degrades to silent no-ops).
2. **CI gates only two of three test tiers.** `.github/workflows/ci.yml` runs typecheck + vitest. `verify:note-index`, `verify:external-context`, and all ~16 Playwright smoke scripts never run automatically. Lint runs with `continue-on-error: true`. Feature branches have no pre-commit gate (by design — husky fires only on `release/*`).
3. **Renderer god-components.** `Settings.tsx` (1631 ln, **50 `useState`**), `InboxSurface.tsx` (1718 ln), `LearningSurface.tsx` (1160 ln), `PersonalHealthDashboard.tsx` (1139 ln). Main-process: `sps-agent.ts`, `skills.ts` (1091), `installer.ts` (1042). Note: `src/main/index.ts` is _not_ the god file CLAUDE.md implies — the IPC surface is properly decomposed into 37 `src/main/ipc/*` modules.
4. **No runtime validation at the IPC boundary.** Handlers cast untrusted `invoke` payloads straight to TS interfaces; no path-sanitization helper exists in `src/main`. Mitigated by contextIsolation + sandbox on every window, but internal bugs reach `fs` unchecked.
5. **157 raw `console.*` calls remain in `src/main`**, bypassing the redacting structured logger that `log.ts` explicitly exists to replace — a modest secret-leak surface and an incomplete `desktop.log`.
6. **~12 files spawn subprocesses with no visible timeout** (ssh-tunnel, hermes-auth, installer, gateway-process, crawl4ai, …) — a hung child can wedge a user-facing flow. (Network fetches, by contrast, are well-centralized with deadlines.)
7. **Type-safety cracks:** both tsconfigs inherit `noImplicitAny: false` from `@electron-toolkit/tsconfig`; lint is not type-aware (no `no-floating-promises`); no `engines` field pins Node (CI uses 22).
8. **Docs drift, narrow but costly:** CLAUDE.md and `docs/BACKLOG.md` still point at `src/main/hermes.ts` as the gateway/chat implementation — it is an 87-line re-export shim; the real code is `hermes/gateway-process.ts`, `hermes/chat-client/*`, and `hermes/grounding.ts`. This is exactly the module a new contributor (or LLM worker) touches first.
9. Zustand slice size (`assistant.ts` 858 ln, `workspace.ts` 717 ln) and 10 `react-hooks/exhaustive-deps` suppressions are worth a spot-audit; selector discipline itself is clean.
10. IPC channel naming is inconsistent (`sps-*` ~80 channels vs abbreviated `sr-*`).

Items 1, 2, 6, 7 → `2026-07-03-reliability-and-ci-hardening.md`. Items 3, 4, 5, 8 → `2026-07-03-codebase-health.md`.

---

## 5. Status corrections (records that no longer match reality)

- **Both existing plan docs are fully implemented but read as open work.** `docs/superpowers/plans/2026-06-20-settings-simplification.md` and `2026-06-29-update-awareness-affordance-loop.md` shipped end-to-end (update-affordances registry, WhatsNewPanel, desktop-update routine, Control Center overview, `normalizeAdminView`, full IPC/Settings wiring) — every checkbox still reads `- [ ]`. Status headers have been added to both alongside this report.
- **The 2026-06-27 UI/UX audit drove a real remediation wave** (commits `1f3e95cf` → `6b940bee` → `68a08c41` → `5d4583ad` → `193edab9` → `86d2d5c4`): Signal-Briefs/Automations naming unified (regression-tested), narrow-window collapse fixed, workspace packs made opt-in, first viewport simplified. **Still open/unverified:** first-run provider-choice simplification, Capture/Inbox unification as the universal intake surface, accessibility/contrast completeness beyond the dark-theme fixes.
- `docs/ui-ux-audit/` and `scripts/audit-ui-ux-captures.mjs` remain untracked in the primary tree — the commit-or-discard decision is tracked as a task in `2026-07-03-codebase-health.md`.

---

## 6. Priority recommendation

If only one track gets scheduled: **Upstream Capture & Exposure, Phases 1–2** (installed-SHA anchor + capability snapshot; coupling manifest + drift test). They are independent, small, zero-risk landings that convert the app's biggest structural exposure — an implicit, unversioned dependency on a daily-moving upstream — into a recorded, tested, observable contract. Everything else in that plan builds on them, and the reliability/health tracks can proceed in parallel at leisure.
