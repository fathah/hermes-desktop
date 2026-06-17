<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# src

## Purpose

All application source code, partitioned by Electron's process model: `main/` (Node main process), `preload/` (context-isolated bridge), `renderer/` (React UI), and `shared/` (code safe to import from any process — currently just i18n + the askpass IPC channel name).

## Key Files

None at this level — only subdirectories.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `main/` | Electron main process — IPC handlers, Hermes installer, SSE proxy, SQLite, gateway/cron orchestration (see `main/AGENTS.md`) |
| `preload/` | contextBridge — exposes a narrow, typed surface to the renderer (see `preload/AGENTS.md`) |
| `renderer/` | React 19 single-page app served by Vite (see `renderer/AGENTS.md`) |
| `shared/` | Code consumed by both main and renderer — i18n catalog + cross-process constants (see `shared/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- **Never** import `electron`, `node:*`, `fs`, `child_process`, or `better-sqlite3` from `renderer/` — these only exist in `main/`.
- **Never** add direct `ipcRenderer.invoke` calls in the renderer — go through `preload/` so the typed surface stays accurate.
- When adding a new feature: think main → preload → renderer. Skipping the preload typing layer breaks `window.api` typings.
- `shared/` must not import from `main/` or `renderer/` (it must be runnable in both contexts).

### Testing Requirements

Tests live in `/tests/` (main-process logic) and inside renderer source (e.g. `*.test.tsx` next to components). See the root and tests AGENTS.md.

### Common Patterns

- **IPC channel naming**: `domain:verb` (e.g. `hermes:start`, `session:list`, `kanban:save`).
- **SSE streaming**: main process owns the upstream connection and forwards parsed events to the renderer via `webContents.send`.
- **Three process types**:
  - Main (`main/`) is a long-lived Node process — owns disk, network, child processes.
  - Preload (`preload/`) runs in the renderer's V8 isolate but before page scripts — only place to use `contextBridge`.
  - Renderer (`renderer/`) is the React app — no Node, no Electron APIs except `window.api`.

## Dependencies

### Internal

None at this level — children depend on each other through the IPC contract.

### External

See parent `AGENTS.md`.

<!-- MANUAL: -->
