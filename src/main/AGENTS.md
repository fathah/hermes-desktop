<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# main

## Purpose

The Electron main process. Owns the BrowserWindow lifecycle, IPC handlers, the local Hermes Agent child process, the Hermes installer, SSE stream parsing/forwarding, SQLite session storage, profile/skill/tool/cron CRUD, gateway orchestration, SSH-tunneled remote mode, and Claw3d (Office) management. All disk and network I/O lives here.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Entry point — creates BrowserWindow, registers all IPC handlers, manages app lifecycle, auto-updater (~39 KB, the largest file) |
| `installer.ts` | Hermes Agent installer — runs the official install script with progress reporting, dependency resolution, platform branching (~36 KB) |
| `hermes.ts` | Hermes Agent local process orchestration — start/stop, health, config writing (~26 KB) |
| `ssh-remote.ts` | Remote-mode SSH tunneling for connecting to a Hermes API server over SSH (~44 KB) |
| `claw3d.ts` | Claw3d (Hermes Office) management — dev server, adapter resolution (~20 KB) |
| `config.ts` | `~/.hermes/.env` and `~/.hermes/config.yaml` read/write (~13 KB) |
| `kanban.ts` | Kanban board persistence |
| `cronjobs.ts` | Scheduled-task CRUD against `~/.hermes/cron/jobs.json` |
| `skills.ts` | Bundled and installed skill discovery + management |
| `tools.ts` | Toolset enable/disable |
| `profiles.ts` | Hermes profile CRUD (named environments under `~/.hermes/profiles/`) |
| `sessions.ts` | Session metadata listing |
| `session-cache.ts` | Local ↔ remote session cache reconciliation |
| `memory.ts` | Memory entry CRUD |
| `models.ts` | Saved model config CRUD |
| `default-models.ts` | Per-provider default model identifiers |
| `soul.ts` | SOUL.md (persona) read/write |
| `sse-parser.ts` | SSE event-stream parser (handles partial buffers, multi-line `data:` frames) — covered by `tests/sse-parser.test.ts` |
| `askpass.ts` | sudo askpass IPC channel — must never leak credentials (see `tests/askpass-security.test.ts`) |
| `sudoCreds.ts` | Short-lived sudo credential cache |
| `security.ts` | Electron security policy helpers |
| `locale.ts` | Locale detection + persistence for i18n |
| `process-options.ts` | Process spawn flag construction (covered by `tests/process-options.test.ts`) |
| `ssh-options.ts` | SSH connection option parsing |
| `ssh-tunnel.ts` | SSH tunnel lifecycle helpers |
| `session-cache.ts` | Local cache for remote session metadata |
| `utils.ts` | Miscellaneous shared helpers |

## For AI Agents

### Working In This Directory

- **All Node/Electron APIs are allowed here.** `child_process`, `fs`, `better-sqlite3`, `electron`, `electron-updater` — this is the only place to use them.
- **IPC handler registration** lives in `index.ts`. Adding a handler is a three-step change: register in `index.ts` (or a feature module), expose in `src/preload/index.ts`, add the type in `src/preload/index.d.ts`. The renderer cannot use a handler until all three exist.
- **`better-sqlite3` is externalized** from the main bundle (see `electron.vite.config.ts`). It is loaded at runtime, so do not statically bundle it.
- **Streaming**: outbound SSE from Hermes Agent is parsed by `sse-parser.ts` and forwarded to the renderer via `webContents.send("chat:event", ...)`. Backpressure is handled by Electron's IPC queue — do not buffer unbounded.
- **Hermes paths**: always go through `~/.hermes/` (resolved via `os.homedir()` + `process.env.HERMES_HOME`). Never hard-code absolute paths.
- **`HERMES_HOME` env override** is honored everywhere — the `dev:fresh` script uses this to run against a temp directory.

### Security (load-bearing)

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` on the BrowserWindow. Tests in `tests/electron-security.test.ts` enforce this.
- The askpass channel (`askpass.ts`) gets sudo passwords from the user; it must **never** echo, log, or persist the credential. Test coverage: `tests/askpass-security.test.ts`.
- Renderer URLs are restricted; do not enable `allowRunningInsecureContent` or weaken CSP.

### Testing Requirements

Main-process unit tests live in `/tests/`. Key suites:

- `tests/ipc-handlers.test.ts` — when adding a handler, add it here too
- `tests/preload-api-surface.test.ts` — keep the renderer-facing surface accurate
- `tests/sse-parser.test.ts` — any change to `sse-parser.ts` must keep all assertions green
- `tests/electron-security.test.ts` / `tests/askpass-security.test.ts` — security regressions block release

### Common Patterns

- **IPC channel naming**: `domain:verb` (`hermes:start`, `session:list`, `cron:save`, `kanban:export`).
- **Error responses**: handlers either return `{ ok: true, data }` or `{ ok: false, error }` — never throw across the IPC boundary.
- **Long-running ops** (installer, hermes start) push progress via `webContents.send("topic:progress", ...)` while the invoke returns a job handle.
- **File modules** are organized by feature (kanban, profiles, skills, ...) rather than by layer; the IPC registration is in `index.ts` but the implementation is in the feature module.

## Dependencies

### Internal

- `src/preload/index.d.ts` — must mirror IPC surface
- `src/shared/i18n` — main process loads locale for native dialog strings
- `src/shared/askpass.ts` — channel name constant shared with preload

### External

- `electron`, `electron-updater`
- `@electron-toolkit/utils`, `@electron-toolkit/preload`
- `better-sqlite3` (externalized)
- Node built-ins: `fs`, `child_process`, `os`, `path`, `crypto`, `net`

<!-- MANUAL: -->
