<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# renderer/src

## Purpose

React 19 application source. The Vite alias `@renderer` resolves here. Organized into top-level `App.tsx` + `main.tsx` entry, shared `components/`, route-style `screens/`, static `assets/`, and the renderer-wide `constants.ts`.

## Key Files

| File | Description |
|------|-------------|
| `main.tsx` | React bootstrap — `createRoot(...).render(<App />)` |
| `App.tsx` | Top-level shell — providers (Theme, I18n, ErrorBoundary), routing between Setup → Layout → screens (~6 KB) |
| `constants.ts` | App-wide constants: slash commands, provider list, default models, gateway list. **Must stay in sync with i18n catalogs** (~21 KB) |
| `env.d.ts` | Vite/TS ambient declarations |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `assets/` | Static assets — fonts, icons, logos, CSS (see `assets/AGENTS.md`) |
| `components/` | Shared UI primitives + providers (see `components/AGENTS.md`) |
| `screens/` | Route-level screens, one folder per top-level view (see `screens/AGENTS.md`) |
| `test/` | Vitest setup file (`setup.ts`) for renderer-side tests |

## For AI Agents

### Working In This Directory

- Renderer is **sandboxed** — no Node, no `electron`. Use `window.api.*` (typed in `src/preload/index.d.ts`).
- **Strings**: route everything through `useI18n()` / `t()`. Don't hard-code user-facing English in components.
- **Constants drift**: when you add a slash command, provider, gateway, or model to `constants.ts`, also add the i18n key in every locale under `src/shared/i18n/locales/*/constants.ts`. Tests in `tests/constants.test.ts` catch obvious omissions.
- **Theme**: dark/light is handled by `components/ThemeProvider.tsx` (CSS variables + Tailwind class strategy).
- **Error boundaries**: wrap risky screens in `<ErrorBoundary>` from `components/ErrorBoundary.tsx`.

### Testing Requirements

- Renderer tests use Vitest + jsdom + Testing Library, set up by `test/setup.ts`.
- Place component tests next to the component (e.g. `components/I18nProvider.test.tsx`).
- Slash-command keyboard handling has a dedicated test: `screens/Chat/keyboard.test.ts`.

### Common Patterns

- One screen folder per top-level view. Single-file screens have just `<Name>.tsx`; complex ones (only `Chat/`) get a folder of pieces + `hooks/`.
- Hooks live next to the screen that owns them, not in a global `hooks/` directory.
- Icons come from `lucide-react` first; brand SVGs come from `assets/logos/`.

## Dependencies

### Internal

- `src/preload/index.d.ts` (via implicit `window.api` typing)
- `src/shared/i18n` (translation runtime + catalogs)

### External

- `react`, `react-dom`
- `react-i18next`, `i18next`
- `react-markdown`, `remark-gfm`, `react-syntax-highlighter`
- `lucide-react`
- `tailwindcss`

<!-- MANUAL: -->
