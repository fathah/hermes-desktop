<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# shared

## Purpose

Code consumed by **both** main and renderer processes. Must be runnable in either context — no Node-only imports (`fs`, `child_process`, ...) and no DOM-only imports (`window`, `document`, ...). Currently holds the i18n catalog and a single shared IPC channel name constant.

## Key Files

| File | Description |
|------|-------------|
| `askpass.ts` | Single shared constant — the IPC channel name for the askpass bridge. Defined here so main and preload can't drift. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `i18n/` | i18next bootstrap, type aliases, and per-locale translation catalogs (see `i18n/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- **No Node imports.** No `fs`, `os`, `path`, `child_process`. If you need filesystem access, the caller in `main/` should pass the data in.
- **No browser-only imports.** No `window`, `document`, `localStorage`. If you need DOM, the caller in `renderer/` should pass it in.
- Keep things pure and serializable so values can cross the IPC boundary unchanged.
- Add new shared constants here when both main and renderer must agree on a string (channel names, default paths, magic constants).

### Testing Requirements

- `i18n/index.test.ts` covers the i18next bootstrap.
- New shared code should be testable with vanilla Vitest (no jsdom dependency).

### Common Patterns

- Plain TypeScript modules, no framework imports.
- Constants are `export const NAME = "value" as const`.

## Dependencies

### Internal

None — shared is a leaf in the dependency graph.

### External

- `i18next`, `react-i18next` (only used by `i18n/`)

<!-- MANUAL: -->
