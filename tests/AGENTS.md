<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# tests

## Purpose

Vitest test suites for main-process logic, preload surface, installer utilities, security boundaries, and SSE parsing. Renderer component tests live next to the components themselves (e.g. `src/renderer/src/components/I18nProvider.test.tsx`).

## Key Files

| File | Description |
|------|-------------|
| `sse-parser.test.ts` | Tests `src/main/sse-parser.ts` event framing, partial buffers, multi-line data |
| `ipc-handlers.test.ts` | Verifies main-process IPC handler registration |
| `preload-api-surface.test.ts` | Snapshot of the typed `window.api` surface exposed via contextBridge |
| `installer-utils.test.ts` | Hermes installer helper logic (dependency detection, path resolution) |
| `installer-platform.test.ts` | Per-platform installer branching (win/mac/linux) |
| `askpass-security.test.ts` | Guards on the sudo askpass IPC channel — must not leak credentials |
| `electron-security.test.ts` | Asserts `nodeIntegration: false`, `contextIsolation: true`, sandboxed renderer, CSP |
| `env-validation.test.ts` | Validation of `~/.hermes/.env` parsing |
| `hermes-api.test.ts` | HTTP client against the Hermes Agent local API |
| `claw3d-command-resolution.test.ts` | Claw3d (Office) executable resolution |
| `constants.test.ts` | Sanity-checks `src/renderer/src/constants.ts` (slash commands, provider lists) |
| `process-options.test.ts` | `src/main/process-options.ts` flag construction |
| `profile-validation.test.ts` / `profiles.test.ts` | Hermes profile CRUD + validation |
| `remote-history.test.ts` | Remote-mode session history sync |
| `session-cache-sync.test.ts` | Local ↔ remote session cache reconciliation |
| `ssh-options.test.ts` / `ssh-remote.test.ts` | SSH remote-mode option parsing and connection logic |
| `winget-generator.test.ts` | `scripts/generate-winget-manifests.mjs` output validation |

## For AI Agents

### Working In This Directory

- Use Vitest's mocking for `electron`, `fs`, `child_process` — never let tests actually launch Electron or spawn subprocesses.
- Tests run in jsdom OR node depending on `vitest.config.ts` — check the env if you see DOM-related failures.
- When adding a new IPC handler in `src/main/index.ts`, add a matching entry to `ipc-handlers.test.ts` AND `preload-api-surface.test.ts` so the renderer surface stays exhaustive.

### Testing Requirements

```bash
npm run test         # single run
npm run test:watch   # iterative dev
```

All tests must pass before push. CI gates on this.

### Common Patterns

- `describe` per module, `it` per behavior — keep tests close to the unit, not the file.
- Fixtures inline; avoid a shared fixtures directory.
- Security tests (`askpass-security`, `electron-security`) are **load-bearing** — they enforce that nothing weakens process isolation. Treat any failure here as a P0.

## Dependencies

### Internal

- `src/main/**` — primary test target
- `src/preload/**` — surface snapshot
- `src/renderer/src/constants.ts` — slash-command and provider constants

### External

- `vitest`, `@testing-library/dom`, `@testing-library/jest-dom`, `jsdom`

<!-- MANUAL: -->
