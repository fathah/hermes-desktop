<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# preload

## Purpose

The context-isolated preload bridge. Runs in the renderer's V8 isolate before page scripts, with access to both Node and the DOM. Exposes a **narrow, typed** API surface to the renderer via `contextBridge.exposeInMainWorld("api", { ... })`. No business logic lives here — only IPC wiring + type declarations.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Main preload — defines `window.api` surface via `contextBridge`, wraps every renderer-callable IPC channel from `src/main/index.ts` (~24 KB) |
| `index.d.ts` | TypeScript declaration of `window.api` — the **source of truth** for the renderer's view of IPC (~17 KB) |
| `askpass.ts` | Separate preload entry for the sudo askpass child window — minimal surface, security-sensitive |

## For AI Agents

### Working In This Directory

- This directory has **two preload entry points** (see `electron.vite.config.ts`):
  - `index.ts` — main window preload
  - `askpass.ts` — askpass child window preload (gives the dedicated sudo prompt window only what it needs)
- **`contextBridge` is mandatory.** Never assign to `window.*` directly. Never use `nodeIntegration` to short-circuit this.
- **`index.d.ts` must mirror `index.ts`.** When you add a method to the bridge, add its signature here, otherwise the renderer loses type safety.
- Keep the surface **small** — every method here is a permanent ABI for the renderer. Group by domain (`window.api.hermes.*`, `window.api.session.*`, etc.) rather than flat namespacing.
- The preload is the only place that calls `ipcRenderer.invoke` / `ipcRenderer.on`. The renderer must never import `electron`.

### Security (load-bearing)

- `contextIsolation: true` is enforced — do not weaken.
- The askpass preload exposes a **minimal** surface (submit + cancel only). Do not extend it with general IPC.
- Strings passed across the bridge must be primitive (no functions, no DOM nodes).

### Testing Requirements

- `tests/preload-api-surface.test.ts` — snapshot of the exposed methods. Update intentionally; an accidental new method should fail this test.
- `tests/askpass-security.test.ts` — guards on the askpass channel.

### Common Patterns

- One file per preload entry point.
- Bridge methods are async (`async (...) => ipcRenderer.invoke(...)`) or event subscriptions (`on(channel, cb)` returning an unsubscribe).
- Subscriptions return an `() => void` unsubscribe — React effects must call it on cleanup.

## Dependencies

### Internal

- `src/main/index.ts` — every IPC channel must have a matching `ipcMain.handle` in main
- `src/shared/askpass.ts` — shared channel-name constant

### External

- `electron` (`contextBridge`, `ipcRenderer`)
- `@electron-toolkit/preload`

<!-- MANUAL: -->
