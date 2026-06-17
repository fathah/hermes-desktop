<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# renderer

## Purpose

The Electron renderer process — a React 19 single-page app served by Vite during development and bundled into `out/renderer` for production. Sandboxed: no Node APIs, no direct `electron` import; all privileged operations go through `window.api` (defined in `../preload/`).

## Key Files

| File | Description |
|------|-------------|
| `index.html` | Vite entry HTML — loads `src/main.tsx`, sets CSP meta tag |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | React app source — App.tsx root, screens, components, assets, constants, i18n bootstrap (see `src/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- The renderer is **sandboxed**. No `import "electron"`, no `process.*`, no `require()`. Use `window.api` (typed via `src/preload/index.d.ts`) for anything privileged.
- Tailwind CSS 4 is configured via `@tailwindcss/vite`; `index.html` does **not** import a separate CSS file — base CSS comes from `src/assets/base.css` and `src/assets/main.css`.
- The Vite alias `@renderer` resolves to `src/renderer/src` (see `electron.vite.config.ts`).
- All UI strings should go through `useI18n()` — never hard-code English text in components.

### Testing Requirements

- Component tests use Vitest + jsdom + Testing Library (`@testing-library/react`).
- Component test files sit next to the component: e.g. `components/I18nProvider.test.tsx`.
- Setup file: `src/test/setup.ts`.

### Common Patterns

- `App.tsx` is the top-level router/shell.
- One screen = one folder under `src/screens/` (most are a single `.tsx`, except `Chat/` which has multiple files + `hooks/`).
- Shared UI primitives live in `src/components/`.
- Cross-screen constants (slash commands, provider lists, model defaults) live in `src/constants.ts` and **must** stay in sync with i18n catalogs in `src/shared/i18n/locales/`.

## Dependencies

### Internal

- `src/preload/index.d.ts` — types `window.api`
- `src/shared/i18n/**` — translation catalogs

### External

- React 19 + react-dom
- Tailwind CSS 4 (`@tailwindcss/vite`)
- `react-i18next`, `i18next`
- `react-markdown` + `remark-gfm` + `react-syntax-highlighter`
- `lucide-react` (icons)

<!-- MANUAL: -->
