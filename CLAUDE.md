# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Hermes Desktop** — an Electron desktop GUI for installing, configuring, and chatting with
[Hermes Agent](https://github.com/NousResearch/hermes-agent), a self-improving Python AI agent. The
desktop app is a front-end: it drives the official Hermes install script, stores Hermes under
`~/.hermes` (`HERMES_HOME`), spawns/manages the Hermes **gateway** (an OpenAI-compatible server,
local on `127.0.0.1:8642` or remote/SSH), and gives a GUI for chat, providers, profiles, memory,
skills, tools, scheduling, and messaging gateways.

The current product surface is **SPS Agent** — a Notion-style workspace (docs + tasks + AI
co-author) that is _the_ app; the Hermes admin screens (Providers/Gateway/Settings/…) open on demand
as an overlay (gear button or ⌘,).

## Commands

```bash
npm run dev            # run the app (electron-vite dev). dev:fresh uses a throwaway HERMES_HOME
npm run build          # typecheck + electron-vite build (REQUIRED before the smoke harness)
npm run lint           # eslint (cached)
npm run typecheck      # BOTH projects: typecheck:node (main+preload) + typecheck:web (renderer)
npm test               # vitest run (jsdom). test:watch for watch mode
npx vitest run path/to/file.test.ts            # single test file
npx vitest run -t "name substring"             # single test by name
npm run verify:note-index                      # native-module index proof (see caveat below)
node scripts/sps-smoke.mjs                      # Playwright-Electron UI smoke (build first)
```

Build installers: `build:mac` / `build:win` / `build:linux` / `build:rpm` (electron-builder).

## Working method — load the skill first

Before any non-trivial change, load `.claude/skills/hermes-dev-workflow/SKILL.md`. It carries the
working method: problem decomposition, the verification ladder keyed by change type, git/worktree
discipline, output structure, and the pitfall catalog
(`.claude/skills/hermes-dev-workflow/PITFALLS.md` — failure signatures → causes → fixes from real
incidents). CLAUDE.md states WHAT the invariants are; the skill states HOW to work.

## Architecture

Three processes (electron-vite builds each separately — `electron.vite.config.ts`):

- **`src/main/`** — Electron main process. Owns all privileged work: IPC handlers (`index.ts` is the
  hub), the Hermes installer (`installer.ts`), gateway lifecycle (`src/main/hermes/gateway-process.ts`),
  chat/completions (`src/main/hermes/chat-client/*`), retrieval grounding
  (`src/main/hermes/grounding.ts`), SSE parsing (`sse-parser.ts`), SSH tunnels (`ssh-tunnel.ts`), config,
  profiles, models/providers, memory, skills, cronjobs. `better-sqlite3` is marked `external` here.
- **`src/preload/`** — the secure renderer bridge (`contextBridge`). The renderer never touches
  Node/Electron directly; it calls `window.hermesAPI.*` which `ipcRenderer.invoke`s the main handlers.
- **`src/renderer/src/`** — React 19 + Zustand app. `App.tsx` is a state-machine over screens
  (`loading → welcome → installing → setup → main`). `screens/` holds each surface; `screens/SpsAgent/`
  is the workspace (its own Zustand store, editor, sidebar, panels, graph).
- **`src/shared/`** — types/helpers imported by both main and renderer (attachments, usage, i18n, …).

### Connection modes

Hermes runs **local** (managed subprocess), **remote** (URL + API key to a remote Hermes server), or
**ssh** (tunnel to a remote box). `getConnectionConfig()` drives this; the renderer adapts screens to it.

### SPS Agent storage substrate (read `docs/STORAGE.md` before touching it)

The one rule: **markdown on disk is the only source of truth; SQLite is a rebuildable index. Writes go
file-first.** Per-profile layout under `<profileHome>/sps-agent/`: `workspace.json` (the blob),
`vault/<pageId>.md` (one page per file, frontmatter + blocks), `vault/<dbFolder>/<rowId>.md`
(folder-backed query-DB rows), `_manifest.json` (tree/trash/comments), `.note-index.db` (derived
`better-sqlite3` FTS5 + wikilink-graph index, rebuilt from disk by `src/main/note-index.ts`).
Two `storageMode`s: `blob` (default; vault is an additive mirror) and `vault` (markdown authoritative).
Migration goes through `lib/storageActions.ts` and is gated by a **parity** round-trip that refuses
lossy cutover. Markdown↔block serializers live in `screens/SpsAgent/editor/` (Tier 1 clean / Tier 2
lossless-fallback `<!-- sps:… -->` comments) and have golden byte-for-byte tests.

### The SPS design system

The SPS look is **not** re-derived in Tailwind — the prototype stylesheets are carried over verbatim
into `screens/SpsAgent/styles/` and confined to a `.sps-scope` container by `scripts/scope-sps-css.mjs`
(so its global `:root`/`body`/`*` rules don't leak into the Hermes renderer). Theme/layout switches are
pure attribute swaps on the scope element. The integrated renderer at
`src/renderer/src/screens/SpsAgent/` is canonical. The archived standalone Vite app at
`archive/sps-agent-standalone/` is historical reference material only.

## Conventions that bite if missed

One-line invariants; full failure signatures and fixes live in
`.claude/skills/hermes-dev-workflow/PITFALLS.md`.

- **Preload API parity is enforced:** every method in BOTH `src/preload/index.ts` and
  `src/preload/index.d.ts`, or `tests/preload-api-surface.test.ts` fails.
- **`better-sqlite3` is compiled for Electron's node ABI, not vitest's:** code that _opens_ the index
  runs under `npm run verify:note-index`, never vitest; renderer UI → `scripts/sps-smoke.mjs`.
- **Two TS projects, two typechecks:** `npm run typecheck` runs both (`tsconfig.node.json` +
  `tsconfig.web.json`); passing one proves nothing about the other.
- **SSRF hardening is load-bearing** (`src/main/security/ssrf-guard.ts`): don't loosen the IP-pinning
  lookup or per-redirect re-validation when editing unfurl/fetch code.
- **Full verification gate** (from `docs/STORAGE.md`) before shipping substrate changes: both
  typechecks → eslint touched files → `vitest run` → `verify:note-index` → `npm run build`.
- **Keep PRs small and single-purpose** (CONTRIBUTING.md); don't bundle formatting sweeps with logic.
- **Husky only gates `release`/`release/*`** — feature branches are ungated; run checks manually.
- **Each git worktree needs its OWN `node_modules`** — `bash scripts/setup-worktree.sh` (or `npm ci`)
  after creating one; never symlink to another tree.

## Related directories

- `obsidian-bridge/` — a separate Obsidian plugin (localhost bridge so Hermes can call Obsidian).
- `scripts/` — `repro-*.js` / `verify-*.js` / `probe-*.js` are Playwright/node repro harnesses for
  specific issues (named by bug); `sps-smoke.mjs` is the UI smoke; `scope-sps-css.mjs` rescopes SPS CSS.
- **External Context Bridge** (`src/main/external-context/`, `src/mcp/external-context-server.ts`) — a
  local-first, opt-in, **redacted** index of OTHER AI tools' transcripts (Claude Code / Codex / Gemini
  / Grok) so Hermes is the cross-tool continuity layer. Source roots are env-overridable
  (`HERMES_EC_{CLAUDE,CODEX,GEMINI,GROK}_ROOT`) for the verify/smoke harnesses. Two load-bearing,
  structurally-enforced invariants: (1) **index-time redaction** — `applyFragments` in `db.ts` is the
  single writer and redacts every message before INSERT (verify asserts a seeded key never reaches
  `messages`/`messages_fts`); (2) **untrusted fencing** — every UI/Save-to-KB/MCP surface wraps
  excerpts in an untrusted banner + fence and never auto-injects them into a chat turn. The index DB is
  machine-global + rebuildable (`HERMES_HOME/external-context.db`). Harnesses:
  `npm run verify:external-context` (index + redaction + MCP roundtrip, under Electron's node) and
  `node scripts/external-context-smoke.mjs` (Playwright UI; build first).
- `docs/superpowers/plans/` and `docs/superpowers/specs/` — design plans/specs for in-flight work.
