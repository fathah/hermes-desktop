<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# components/common

## Purpose

Branding components used across multiple screens. Kept separate from `components/` so the broader components dir stays focused on functional primitives.

## Key Files

| File | Description |
|------|-------------|
| `BrandLogo.tsx` | Composable brand logo (text + glyph variants, supports light/dark theming) |
| `HermesLogo.tsx` | Hermes glyph only — used in splash, header, narrow contexts |

## For AI Agents

### Working In This Directory

- These are **presentation-only** components; no state, no IPC.
- Logo SVGs are inlined as JSX where possible; raster fallbacks live in `../../assets/`.
- Respect the active theme via the `useTheme()` hook from `../ThemeProvider.tsx` rather than CSS-only media queries — the app's theme is user-configurable, not just OS-driven.

### Testing Requirements

None at the moment — purely presentational. Add tests if behavior is added.

### Common Patterns

- Components accept a `className` prop to allow per-use sizing/spacing.
- SVGs use `currentColor` so Tailwind text utility classes can colorize them.

## Dependencies

### Internal

- `../ThemeProvider.tsx` (for theme detection)

### External

- `react`

<!-- MANUAL: -->
