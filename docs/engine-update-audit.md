# Hermes engine v0.14.0 → main: upstream audit for Hermes Desktop

> **Range audited**: `a91a57f` (v2026.5.16 / v0.14.0) → `2517917` (main as of 2026-05-26), **1089 commits**.
> Top buckets after filtering out docs/i18n/CI/style/tests-only: 82 CLI, 11 config, 53 auth, 98 gateway, 64 security, 17 perf, 43 skills.
>
> Cross-referenced with 60 open desktop issues (#193–#393).

---

## 🔴 BLOCKING — must address before engine update

**(none — see CAUTION instead)**

After deep inspection of every "high-risk category" candidate, no commit *forces* a desktop code change to keep the app functional. The closest call was `e42fcc5`, which initially looked breaking, but the env-var fallback survives. Details in CAUTION.

---

## 🟡 CAUTION — desktop needs adjustment but won't break

**(e42fcc5)** `fix(provider): make config.yaml model.provider the single source of truth (#31222)` — Demotes `HERMES_INFERENCE_PROVIDER` env var from "supported override" to "legacy fallback". The desktop sets this env var at `src/main/hermes.ts:812,815` for custom OpenAI-compatible / Anthropic-protocol endpoints. **Verified the env var is still read** at `hermes_cli/runtime_provider.py:438` (`resolve_requested_provider`), so the desktop continues to function — but the gateway path now reads `model.provider` from config.yaml directly and ignores the env. If a user runs Hermes in *gateway mode* (any platform like Telegram/Discord), the desktop's env-var override is silently ignored for that path. Should switch `src/main/hermes.ts` to `hermes config set model.provider …` (or write via `config.ts:upsertBlockChild`) before launching the chat process, and drop the env-var hack. Also update the doc comment that promises "HERMES_INFERENCE_PROVIDER applies".

**(1a4e64b)** `fix(credential_pool): parse ISO-string last_status_at during from_dict rehydration (#25516)` — `auth.json` credential-pool entries' `last_status_at` field now accepts either float-epoch or ISO-string. Desktop's parser at `src/main/config.ts:1181` doesn't read this field, so no immediate breakage — but if you ever sort/filter by it, support both shapes. Mention in #382's follow-up notes.

**(6855d17)** `fix(memory): guard against external drift in MEMORY.md/USER.md (#26045)` — Memory tool now refuses `add/replace/remove` if the on-disk file content wouldn't round-trip through its `§`-delimited serializer (writes a `.bak.<ts>` and surfaces an error to the model). The desktop writes MEMORY.md directly via `safeWriteFile` in `src/main/memory.ts:151,178,190`, bypassing that delimiter format. If a user edits memory from the desktop while a hermes session is running, the session's next memory tool call could fail with a drift-guard error pointing at a `.bak` file. Recommended fix: have the desktop's memory editor write entries in `§`-delimited form (matching `ENTRY_DELIMITER` it already declares at `memory.ts:6`), and/or surface a one-line UI hint when the user saves while a session is active. Possibly closes downstream #273 (settings not persisting across restart).

**(b4cf5b6)** `feat(portal): one-shot setup, status CLI, and Nous-included markers (#30860)` — Adds a brand-new `hermes portal` subcommand and `hermes setup --portal` flag. Additive; nothing in desktop breaks. But: this is the upstream's now-recommended onboarding path for the Nous bundled offering, and the desktop's first-run wizard currently shows the legacy provider picker. Worth a follow-up PR to expose a "Quick-start with Nous Portal" button that runs `hermes setup --portal` and feeds back the result. Also relevant to #367 (Nous Portal support broken — no UI to add API key).

**(0219b04)** `perf(cli): cut hermes startup 63%` — Big speed win, but also moves the early-startup `config.yaml` read from "read for security.redact_secrets only" to "read for security + network.force_ipv4 in one pass", and adds an on-disk Bitwarden secrets cache at `<HERMES_HOME>/cache/bws_cache.json` (mode 0600). The desktop's installer probe at `src/main/installer.ts` that detects engine readiness should be unaffected (it just spawns `hermes --version`), but any test/harness that times the startup duration will see a different baseline. Live-test the desktop's "first chat send" flow to confirm — if startup is now 63% faster, the desktop's chat-send timeout heuristics may want to shrink too.

**(c6a992e + 5908822)** `fix(security): derive <VENDOR>_API_KEY from host + prevent leakage to non-authoritative custom endpoints` — Engine now refuses to send `OPENAI_API_KEY` / `OPENROUTER_API_KEY` to a custom endpoint whose host isn't a known openai/openrouter URL. Falls back to `no-key-required` for unknown hosts, OR derives `<VENDOR>_API_KEY` from the hostname (e.g. `api.deepseek.com` → `DEEPSEEK_API_KEY`). The desktop's custom-provider auto-generated env-var name is `CUSTOM_PROVIDER_<NAME>_KEY` (`hermes.ts:835`), which is **not** in the host-derived list. If a user has a custom provider on `api.deepseek.com` and the desktop only writes `CUSTOM_PROVIDER_DEEPSEEK_KEY`, the engine will not pick it up after upgrade (the new host-derive expects `DEEPSEEK_API_KEY`). This is the same shape as downstream **#360** (custom-provider API key envvar mismatch) — upstream has now made the desktop's existing mismatch *visibly broken* in more cases. Recommended fix in `src/main/hermes.ts` URL_KEY_MAP / models.ts: write the host-derived `<VENDOR>_API_KEY` *in addition to* `CUSTOM_PROVIDER_<NAME>_KEY` when the URL matches a known vendor host.

**(0dee92d)** `feat(security): promptware defense — shared threat patterns + memory load-time scan + tool-result delimiters (#32269)` — New centralized threat-patterns module (`tools/threat_patterns.py`). Memory content is now scanned *at load time* (not just at write). Desktop writes raw user text into MEMORY.md via `memory.ts`; if a user accidentally types something matching a threat pattern (e.g. "ignore previous instructions" appearing in a memory entry about debugging an LLM bug), the next session boot will block that memory entry from loading. Worth flagging in the memory-editor UI: validate user input against the threat patterns at save-time and surface a warning. Could surprise users testing prompt-injection scenarios.

**(7ebebfb + 00bd24e)** `Harden Skills Guard multi-word prompt patterns + memory content scanning parity (#26852, #9151)` — Patterns now use `(?:\w+\s+)*` between key tokens (e.g. `system\s+(?:\w+\s+)*prompt\s+(?:\w+\s+)*override`). Same as above — strictly more aggressive blocking of skill installs and memory entries. The desktop's Skills tab shouldn't be affected for reading installed skills, but **skill installs from the desktop UI** will now reject more legitimate-looking content. Surface the engine's rejection error to the user (don't swallow it).

**(c26af46 + bd2756d + ee59ef1 + b7b8bec)** Symlink-rejection patches (skills, update ZIP, blocking devices, `/proc/*/environ`) — All Linux-relevant; the desktop on Windows is unaffected, but Linux desktop installs (#203, #325) and especially **#364** (Linux Windows updater) will see the engine refuse to install skill bundles with any symlink. If the desktop's skill-installer codepath ever creates intermediate symlinks for atomic-install or workspace-staging, those operations need to be reworked.

**(2c34a7d + bd2756d)** Update path hardening — Update ZIP now rejects symlink members **and** cleans up the temp dir on any failure. The desktop's auto-updater (#364) runs `hermes update` as a child process; before this fix, a failed update left `/tmp/hermes-update-*` directories behind. After the fix they're cleaned up. **Nice-to-have for the desktop**: this likely helps issue #364 indirectly by reducing partial-state corruption after an `aiohttp WinError 5` lock failure.

**(0219b04 + various perf)** Five separate perf wins (`6dbbf20`, `c29b4f5`, `a3beee4`, `6c3fd97`, `784febe`, `544c31b`) collectively reduce hermes startup by ~63% and per-conversation function calls by ~47%. Update the desktop's progress-spinner phrasing in `src/main/installer.ts` if it currently quotes a "startup may take a few seconds" expectation that's no longer accurate.

---

## 🟢 NICE-TO-HAVE — desktop benefits, no action needed

**(e2a1a2b)** `fix(gateway): pre-mark sessions as resume_pending before drain to prevent data loss (#27856)` — Sessions are marked resume-pending **before** the drain wait, so a kill-during-drain doesn't lose in-flight work. Directly relevant to **downstream #364** (Desktop updater should gracefully stop server.py before syncing updates) — upstream just made the abrupt-kill case safer. After the engine bump, #364's "aiohttp WinError 5" failure mode is less likely to corrupt sessions.

**(ac5359a + 9140be7)** `fix(streaming): route mid-tool-call partial-stream-stub through length continuation` — Partial-stream stubs now emit `finish_reason=length` for text-only truncations (so the model is asked to continue), while mid-tool-call partials keep `finish_reason=stop`. This addresses a class of "stream-died mid-response" cases that may show up as #370 / #391 ("duplicate messages — old assistant responses reappear"). Worth retesting #370 against this fix after upgrade.

**(5cb21e3 + a4ceead + 8edeebe + 7eb6c7f)** Gateway response-transformed flag chain — Plugin-transformed responses now edit the streamed message in-place instead of sending a duplicate. **Likely fixes #391** (一条指令却回复两条回复 / one user message → two responses) for users with `transform_llm_output` plugins active. Worth checking against #391's reproducer.

**(39fe4ec + c4b8f5e)** Kanban corrupt-db refusal + hardened backup paths — Engine now refuses to auto-init a corrupt `kanban.db` and emits a stable JSON error envelope. **Likely fixes #373** ("Failed to parse JSON from 'hermes kanban': Unexpected end of JSON input") by replacing the silent-stdout-corruption failure mode with a structured error.

**(99d62f6)** `fix(gateway): protect in-flight subagents from busy-mode interrupts (#30170)` — Conversational follow-ups during `delegate_task` no longer cascade-cancel subagents. Tangentially relevant to **#300** ("Session ID Lost When Switching Windows/Tabs") and **#370** — these reports describe symptoms of session state being torn down unexpectedly.

**(d33c99b + e32d2ff)** Nous Portal `inference_base_url` host allowlist — Engine now refuses to persist or forward a poisoned base_url from a network response. Desktop reads `providers.nous.inference_base_url` from auth.json (`model-discovery.ts:164`); after this fix, that value is guaranteed to be in the allowlist (`inference-api.nousresearch.com`). Tangentially relevant to **#384** (Unsloth Studio endpoint returns "Invalid token payload") — that issue is about a different provider entirely but the same hardening pattern would apply.

**(223a397 + 4694524 + bba76f3 + 056e00a + ba3c450)** Five separate file-safety hardening patches blocking `read_file` access to `.env`, `auth.json`, `auth.lock`, `.anthropic_oauth.json`, `mcp-tokens/*`, `auth/google_oauth.json`, project-local `.env*` files, plus closing TOCTOU windows in Claude Code OAuth credential writes. **None affect the desktop** — desktop reads these files directly via Node's `fs`, bypassing the Python engine's `read_file` guard entirely. Pure security win.

**(3ab7e2a)** `harden(env_passthrough): apply GHSA-rhgp-j443-p4rf filter to config.yaml path` — Operator-configured `tools.env_passthrough` in `config.yaml` can no longer leak Hermes-managed provider credentials to `execute_code` / terminal children. Desktop doesn't write that key, so no behavior change here.

**(be27bfe)** `security: harden API server key placeholder handling (#30738)` — `has_usable_secret()` now rejects `your_api_key_here` (in addition to the existing list). Desktop generates random keys, so no impact.

**(2ef501e)** `feat(cli): add /update slash command to CLI and TUI` — Adds `/update` slash command to the bundled CLI/TUI. Desktop has its own update flow and doesn't run the TUI, so no direct effect — but the existence of this command makes "engine update from inside a chat session" a thing users might expect. Consider mirroring the gesture in the desktop UI.

**(1c7a783)** `fix(cli,gateway): strip outer brackets/quotes from /resume args` — Cleaner handling of `/resume <abc123>` typed literally. Doesn't affect desktop, which sends session IDs via API.

**(25295e7)** `fix(cli): redirect resume status lines to stderr in quiet mode` — Desktop runs `hermes` subprocesses with `TERM=dumb` and parses stdout in places. This commit moves resume status lines from stdout to stderr in quiet mode (`-Q`/`tool_progress_mode=off`). If the desktop runs any command in quiet mode that previously had "Session not found" appear on stdout, it'll now appear on stderr — but no such code path found in the desktop. Worth keeping in mind for future stdout-parsers.

**(1c3c364 + 226cee4)** New status-bar indicators (`▶ N` for /background tasks, `⚙ N` for terminal processes) — TUI-only, no desktop impact.

**(b07524e + xAI-OAuth cluster)** `feat(xai-oauth): add xAI Grok OAuth (SuperGrok Subscription) provider` plus ~20 follow-up fixes (`6362e71`, `6975a2d`, `cb53c40`, `9b91377`, etc.) — New OAuth provider. The desktop's `isOAuthLoginProvider()` allowlist in `hermes-auth.ts` would need to add `xai-oauth` to expose this in the UI. Strictly additive feature.

**(eeb747d)** `feat(sessions): opt-in per-session JSON snapshot writer` — Per-session JSON snapshots, opt-in via config. Could be useful if the desktop wants to add a "Export session as JSON" feature later.

**(2cd952e + 00ec0b6)** `feat(stt): register_transcription_provider() / feat(tts): register_tts_provider()` — New plugin hooks. Additive; desktop doesn't expose TTS/STT extension points yet.

**(c1ae18e)** `fix(gateway): add trust_env=True to aiohttp sessions in SMS/Slack/Teams/Google Chat adapters` — Lets HTTP_PROXY env vars reach gateway adapters. Useful for corporate-proxy users of those gateway platforms; no desktop impact.

**(9732559)** `fix(security): restrict dashboard websockets to loopback clients` — Removes the `--insecure` bind allowlist. Desktop hits `127.0.0.1` so still allowed; SSH-tunnel users (#286, #358) tunnel to loopback on the server, so still allowed.

---

## Notes on cross-reference findings

- Open issues that look likely to be **fixed or improved** by the upgrade: **#364** (e2a1a2b), **#370** (ac5359a + 9140be7), **#373** (39fe4ec + c4b8f5e), **#391** (5cb21e3 chain).
- Open issues the upgrade **does not address**: #198/#219/#225/#234 (locale persistence — UI bug), #387 (Sessions view broken layout — UI bug), #371 (cache bug — desktop-side), #368 (SSH tunnel OAuth spawning local Python — desktop-side), #306 (Windows HOME→/tmp — desktop-side), #348 (SQLite lock during chat — needs investigation, may be partially relieved by `c634c07 test(gateway): pin DEFAULT_DB_PATH` and `c30608c` worker-tools fix but not a clear fix).
- Open issues that the upgrade may **make worse** (the CAUTION items): **#360** (custom-provider API key envvar mismatch — c6a992e/5908822 expose this).

## Suggested test plan before bumping

1. Live-test custom OpenAI-compatible provider with `api.deepseek.com`-style URL (verify env-var path still resolves the key — covers c6a992e/5908822 + e42fcc5).
2. Live-test desktop memory editor: write a memory entry, run a chat session, observe whether memory tool calls succeed without drift errors (covers 6855d17).
3. Live-test fresh install: run `hermes setup --portal` via desktop and confirm config.yaml shape is still parseable by `src/main/config.ts` (covers b4cf5b6).
4. Live-test #370 reproducer with new partial-stream-stub behavior (ac5359a).
5. Confirm `hermes kanban` JSON output stability with a corrupted kanban.db file (covers 39fe4ec / #373).

---

_Audit run: 2026-05-26. Engine SHAs from `NousResearch/hermes-agent` `main` (`2517917`). Confirms `validate_toolset` was **not** renamed — desktop's `LEGACY_TOOLSET_NAME` check in #369 remains correct._
