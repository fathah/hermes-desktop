<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# components

## Purpose

Shared UI primitives, providers (Theme, I18n), and cross-screen widgets. Anything used by **more than one** screen lives here. Screen-specific UI stays in the screen folder.

## Key Files

| File | Description |
|------|-------------|
| `AgentMarkdown.tsx` | Markdown renderer for assistant messages — uses react-markdown + remark-gfm + syntax highlighter |
| `ThemeProvider.tsx` | Dark/light theme provider — reads/writes preference via `window.api`, applies via Tailwind class strategy |
| `I18nProvider.tsx` | i18next provider wrapper — initializes from `src/shared/i18n` and reacts to locale changes |
| `I18nProvider.test.tsx` | Vitest coverage for the provider |
| `I18nContext.ts` | React context for i18n |
| `useI18n.ts` | Convenience hook wrapping `useTranslation()` with the project's namespaces |
| `ErrorBoundary.tsx` | Reusable React error boundary — wraps risky screens, shows fallback UI |
| `RemoteNotice.tsx` | Banner shown when in remote-mode (connected to a remote Hermes API server) |
| `VerifyWarningBanner.tsx` | Banner warning when the user is running an unverified Hermes Agent build |
| `Versions.tsx` | Renders Electron / Chromium / Node versions (debug footer) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `common/` | Branding components (HermesLogo, BrandLogo) (see `common/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- Components here are **stateless** wherever possible — state belongs in screens, providers expose state via context.
- Providers go through `App.tsx`; do not instantiate a second `<I18nProvider>` or `<ThemeProvider>` inside a screen.
- Use `useI18n()` from `useI18n.ts`, not the raw `useTranslation()` from `react-i18next` — it pins the namespace tuple consistently.
- New shared components should have a co-located `.test.tsx` covering the rendering + at least one interaction.
- Markdown renderer (`AgentMarkdown.tsx`) is performance-sensitive — token streams update it many times per second. Memoize anything heavy.

### Testing Requirements

- Vitest + Testing Library, jsdom.
- Co-located `*.test.tsx`.

### Common Patterns

- Provider files end in `Provider.tsx` and pair with a `Context.ts` + hook (`useXxx.ts`).
- Banner components are presentational — they receive their visibility flag as a prop or via context.

## Dependencies

### Internal

- `useI18n.ts` ↔ `src/shared/i18n`
- Many components consume `window.api.*` (typed by `src/preload/index.d.ts`)

### External

- `react`, `react-i18next`, `react-markdown`, `remark-gfm`, `react-syntax-highlighter`
- `lucide-react`

<!-- MANUAL: -->
