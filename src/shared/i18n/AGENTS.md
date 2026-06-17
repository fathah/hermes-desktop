<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# i18n

## Purpose

i18next bootstrap, namespace types, and translation catalogs for every supported UI language. Used by both main (native dialog strings) and renderer (all visible UI text).

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | i18next init — registers all namespaces, sets fallback chain, exposes a single `i18n` instance (~11 KB) |
| `index.test.ts` | Smoke test that all namespaces load and `t()` returns strings |
| `config.ts` | Locale list + default locale + fallback configuration |
| `types.ts` | `Resources` type and namespace declarations for type-safe `t()` calls |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `locales/` | Per-language catalogs — one folder per locale, each with the same set of namespace files (see `locales/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- **Adding a translation key**: add it to **every** locale in `locales/*/<namespace>.ts`. Tests do not currently enforce key parity — manual diligence required.
- **Adding a new namespace**: register it in `index.ts` and `types.ts`, then add a corresponding `.ts` file in every locale.
- **Adding a new locale**: add an entry to `config.ts`, create `locales/<lang>/` mirroring `locales/en/`, and add the language to the locale picker in `src/renderer/src/screens/Settings/Settings.tsx`.
- The English catalog (`locales/en/`) is the **source of truth** — copy from it when starting a new locale.
- Constants strings (slash commands, provider names) live in `locales/<lang>/constants.ts` and must stay aligned with `src/renderer/src/constants.ts`.

### Testing Requirements

- `index.test.ts` — basic load + lookup smoke test
- Component tests (e.g. `I18nProvider.test.tsx`) exercise the integration

### Common Patterns

- Each namespace exports a default object of `key: string` (or nested objects for grouped keys).
- `t("namespace:key")` is the standard call form; `useI18n()` pre-binds namespaces.

## Dependencies

### Internal

- Consumed by `src/renderer/src/components/I18nProvider.tsx` and `useI18n.ts`
- Main process imports for native dialog text

### External

- `i18next`, `react-i18next`

<!-- MANUAL: -->
