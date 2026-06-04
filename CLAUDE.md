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
co-author) that is *the* app; the Hermes admin screens (Providers/Gateway/Settings/…) open on demand
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

## Architecture

Three processes (electron-vite builds each separately — `electron.vite.config.ts`):

- **`src/main/`** — Electron main process. Owns all privileged work: IPC handlers (`index.ts` is the
  hub), the Hermes installer (`installer.ts`), gateway lifecycle + chat streaming (`hermes.ts`,
  spawns the Python server, parses SSE via `sse-parser.ts`), SSH tunnels (`ssh-tunnel.ts`), config,
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
pure attribute swaps on the scope element. The standalone `sps-agent/` (runnable Vite app) and
`sps-agent-prototype/` (the canonical design + interaction spec) are the upstream sources for this code.

## Conventions that bite if missed

- **Preload API parity is enforced.** Every method must appear in BOTH `src/preload/index.ts` and
  `src/preload/index.d.ts`, or `tests/preload-api-surface.test.ts` fails.
- **`better-sqlite3` is compiled for Electron's node ABI, not vitest's.** Any code that *opens* the
  index cannot run under vitest. Split: pure logic + IPC-mocked hooks/components → vitest (jsdom);
  anything that opens the index → `npm run verify:note-index` (runs under `ELECTRON_RUN_AS_NODE=1`);
  renderer UI → the Playwright-Electron smoke harness `scripts/sps-smoke.mjs`.
- **Two TS projects, two typechecks.** `tsconfig.node.json` (main+preload) and `tsconfig.web.json`
  (renderer) — run `npm run typecheck` (both) before claiming type safety.
- **SSRF hardening is load-bearing** in `src/main/sps-agent.ts` (link unfurl pins the validated IP and
  re-validates every redirect hop). Don't loosen the IP-pinning lookup when editing unfurl/fetch code.
- **Full verification gate** (from `docs/STORAGE.md`) before shipping substrate changes: both
  typechecks → eslint touched files → `vitest run` → `verify:note-index` → `npm run build`.
- **Keep PRs small and single-purpose** (CONTRIBUTING.md); don't bundle formatting sweeps with logic.
- Husky `pre-commit`/`pre-push` only run lint+tests on `release`/`release/*` branches — feature
  branches are NOT gated by the hook, so run checks manually.

## Related directories

- `obsidian-bridge/` — a separate Obsidian plugin (localhost bridge so Hermes can call Obsidian).
- `scripts/` — `repro-*.js` / `verify-*.js` / `probe-*.js` are Playwright/node repro harnesses for
  specific issues (named by bug); `sps-smoke.mjs` is the UI smoke; `scope-sps-css.mjs` rescopes SPS CSS.
- `docs/superpowers/plans/` and `docs/superpowers/specs/` — design plans/specs for in-flight work.
