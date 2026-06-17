<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# hermes-desktop

## Purpose

Hermes Desktop is a native cross-platform Electron application that installs, configures, and runs the [Hermes Agent](https://github.com/NousResearch/hermes-agent) self-improving AI assistant. It provides a GUI for chat, sessions, profiles, memory, skills, tools, scheduling, messaging gateways, and Claw3d Office. It supports both **local** (spawns Hermes at `127.0.0.1:8642`) and **remote** (connects to a remote Hermes API server) modes with SSE streaming.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | npm scripts, dependencies. Main entry: `out/main/index.js` |
| `electron.vite.config.ts` | Electron-Vite config — main externalizes `better-sqlite3`, preload has 2 entry points (index + askpass), renderer aliases `@renderer` |
| `electron-builder.yml` | Cross-platform packaging config (mac dmg, win nsis, linux AppImage/deb/rpm/snap); GitHub release publisher |
| `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json` | Split TS configs — `node` covers main+preload, `web` covers renderer |
| `eslint.config.mjs` | Flat ESLint config using Electron Toolkit presets |
| `vitest.config.ts` | Vitest test runner configuration |
| `dev-app-update.yml` | electron-updater dev override |
| `skills-lock.json` | Locked versions of bundled Hermes skills |
| `README.md` / `README.zh-CN.md` | Project overview (English + Simplified Chinese) |
| `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md` | Contribution guidelines |
| `LICENSE` | MIT license |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Application source — main, preload, renderer, shared (see `src/AGENTS.md`) |
| `tests/` | Vitest test suites for main-process and preload logic (see `tests/AGENTS.md`) |
| `build/` | Packaging assets — icons, mac entitlements, winget templates (see `build/AGENTS.md`) |
| `scripts/` | Build-time scripts — winget manifest generator (see `scripts/AGENTS.md`) |
| `resources/` | Runtime resources bundled into asar (icon.png) |
| `docs/` | Long-form planning docs and design specs (see `docs/AGENTS.md`) |
| `.github/` | CI/CD — release workflow that builds all platforms |
| `.agents/` / `.claude/` / `.omc/` | Local AI-agent tooling skills + session state (NOT project code) |

## For AI Agents

### Working In This Directory

- This is an **Electron** app with three process boundaries: **main** (Node, has `nodeIntegration`), **preload** (bridge using `contextIsolation`), and **renderer** (React 19, sandboxed). Never cross these boundaries directly — always add an IPC handler in `src/main/index.ts` and expose it via `src/preload/index.ts`.
- Persistent state lives in `~/.hermes/` (Hermes Agent owns this; the desktop app reads/writes config + state.db).
- Local SQLite session storage uses `better-sqlite3` — it is externalized from the main bundle (see `electron.vite.config.ts`).
- The renderer uses Tailwind CSS 4 + React 19 with the `@renderer` import alias.
- Two TypeScript projects (`tsconfig.node.json` for main/preload, `tsconfig.web.json` for renderer) — typecheck both before pushing.

### Testing Requirements

```bash
npm run lint                # ESLint cache enabled
npm run typecheck           # Both node + web tsconfig projects
npm run test                # Vitest, single run
npm run test:watch          # Watch mode during dev
```

All three must pass with exit 0 before commit.

### Common Patterns

- IPC: `ipcMain.handle("namespace:action", ...)` in main, exposed via `contextBridge.exposeInMainWorld("api", { ... })` in preload, consumed as `window.api.x()` in renderer with types in `src/preload/index.d.ts`.
- SSE streaming: parse with `src/main/sse-parser.ts` (has matching unit tests).
- Slash commands and constants are duplicated between renderer (`src/renderer/src/constants.ts`) and i18n locales — keep them in sync.
- Always read `src/preload/index.d.ts` before adding a new renderer-side `window.api.*` call.

### Build & Release

- `npm run build` → typecheck + electron-vite build (produces `out/`).
- Platform packaging via `npm run build:mac|win|linux|rpm` — runs electron-builder, signed builds only happen in CI.
- Release pipeline: `.github/workflows/release.yml` produces dmg, exe, AppImage, deb, rpm, snap on tag push.
- macOS notarization is required (`notarize: true` in builder config); credentials live in CI secrets.

## Dependencies

### External (runtime)

- **Electron 39** — desktop shell
- **React 19** + **react-dom** — UI
- **TypeScript 5.9** — type safety across processes
- **Tailwind CSS 4** — utility-first styling
- **Vite 7** + **electron-vite 5** — dev/build tooling
- **better-sqlite3 12** — local FTS5 session history
- **electron-updater 6** — in-app auto-update
- **i18next 25** + **react-i18next** — i18n
- **react-markdown** + **remark-gfm** + **react-syntax-highlighter** — chat rendering
- **lucide-react** — icons

### External (dev)

- Vitest 4 + Testing Library — unit/integration tests
- electron-builder 26 — packaging
- ESLint 9 + Prettier 3 — linting/formatting

### Upstream Project

- **Hermes Agent** (https://github.com/NousResearch/hermes-agent) — the actual agent runtime the desktop app installs and orchestrates.

<!-- MANUAL: Custom project notes can be added below this line; the auto-generator preserves them. -->
