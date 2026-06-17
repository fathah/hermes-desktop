<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# screens

## Purpose

Route-level screens for the app. Each folder corresponds to one top-level view selectable from the nav. Most screens are a single `<Name>.tsx` file; the **only** screen with internal structure is `Chat/`, which has hooks and helper files.

## Subdirectories (single-file screens unless noted)

| Directory | Purpose |
|-----------|---------|
| `Agents/` | Hermes profile CRUD (`Agents.tsx`) |
| `Chat/` | Streaming conversation UI — **multi-file**, has `hooks/`, slash commands, message rendering (see `Chat/AGENTS.md`) |
| `Gateway/` | Messaging platform integration setup (Telegram, Discord, Slack, ...) |
| `Install/` | First-run Hermes Agent installer UI |
| `Kanban/` | Kanban board (~34 KB single file) |
| `Layout/` | Top-level shell after Setup — sidebar nav, header, content slot |
| `Memory/` | Memory entries CRUD + memory provider config |
| `Models/` | Saved model configurations per provider |
| `Office/` | Claw3d (Hermes Office) dev server + adapter management |
| `Providers/` | LLM provider configuration + credential entry |
| `Schedules/` | Cron job builder + delivery target picker |
| `Sessions/` | Session history (search, resume, date-grouped) |
| `Settings/` | All settings — provider config, credentials, backup/import, log viewer, theme, locale (~35 KB) |
| `Setup/` | First-run flow router (local vs remote, provider pick) |
| `Skills/` | Bundled + installed skills browser |
| `Soul/` | Persona (SOUL.md) editor |
| `SplashScreen/` | Boot splash shown before main window renders |
| `Tools/` | Toolset enable/disable |
| `Welcome/` | Welcome screen shown before Setup |

## For AI Agents

### Working In This Directory

- **One folder = one screen.** Do not flatten — folders give us room to grow without renames if a screen ever needs hooks or sub-components.
- **Single-file screens** stay single-file until they actually need splitting. Don't preemptively explode small screens into folders.
- **Naming**: folder is PascalCase, file is `<Folder>.tsx`.
- **Routing**: `App.tsx` picks the screen based on app state (Setup → Welcome → Layout); inside `Layout`, the active screen is picked from sidebar state. There is no react-router.
- **IPC**: every screen calls `window.api.*`. Failures should be caught and surfaced via toast or inline error UI — never let an IPC rejection unmount the screen.
- **Strings**: every visible label goes through `useI18n()`. The matching namespace usually matches the screen name (e.g. `Settings.tsx` uses `settings:*`).

### Testing Requirements

- Screens are not currently unit-tested in isolation; coverage comes from main-process tests in `/tests/` plus the Chat keyboard test.
- When adding a new screen, add at least one smoke test if it has non-trivial logic.

### Common Patterns

- Screen file structure: top-of-file imports → component → default export.
- Heavy logic (IPC orchestration, derived state) gets extracted into hooks colocated with the screen (see `Chat/hooks/` as the canonical example).
- Cross-screen state: keep it minimal — most state is screen-local + read-on-mount from `window.api`. There is no global Redux/Zustand store.

## Dependencies

### Internal

- `../components/**` (providers, banners, shared UI)
- `../constants.ts` (slash commands, providers, gateways, models)
- `window.api.*` from preload

### External

- `react`, `lucide-react`, `react-i18next`

<!-- MANUAL: -->
