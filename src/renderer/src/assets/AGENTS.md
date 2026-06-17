<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# assets

## Purpose

Static assets bundled into the renderer build by Vite: brand images, splash, fonts, app icon, base + main CSS, provider/gateway SVG logos, and the lucide-react icon barrel.

## Key Files

| File | Description |
|------|-------------|
| `base.css` | CSS reset + Tailwind `@import` directives |
| `main.css` | App-wide CSS (~96 KB) — generated/extended Tailwind layer with custom utilities |
| `hermes.png` / `hermesbg.webp` | Hero / background brand imagery |
| `icon.png` | App icon for in-app display (build icons live in `/build/`) |
| `splash.png` / `splashtext.png` / `splashtext-w.webp` | Splash-screen artwork |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `fonts/` | Google Sans TTF family (Regular, Italic, Medium, MediumItalic, SemiBold, Bold) — referenced from `main.css` `@font-face` |
| `icons/` | `index.tsx` re-exports lucide-react icons used across the app, so screens import from one place |
| `logos/` | 35+ SVG logos for LLM providers and messaging gateways (OpenAI, Claude, Gemini, Discord, Slack, Telegram, ...) — light/dark variants where needed |

## For AI Agents

### Working In This Directory

- **Don't add large new fonts** unless explicitly required — each Google Sans variant is ~2 MB.
- **SVG logos** must use `currentColor` for fills wherever possible so they re-tint with theme; otherwise add a `-color` suffix to the filename and accept that they're fixed-color (e.g. `openai.svg` is monochrome; `gemini-color.svg` is full-color).
- **CSS**: `main.css` is large because it includes generated utilities — prefer adding Tailwind classes in components over hand-editing this file.
- **Asset paths**: import via the `@renderer` alias or a relative path; Vite handles fingerprinting.
- **Adding a new provider/gateway logo**: drop the SVG here, add a mapping in `../constants.ts` and the corresponding screen, and add the i18n string in each locale.

### Testing Requirements

None — assets are validated by the build (Vite errors on missing imports).

### Common Patterns

- Filenames: lowercase, kebab-case, `-color` suffix for non-monochrome variants, `-dark` suffix for explicitly-dark variants.

## Dependencies

### Internal

- `../constants.ts` references logo files by relative path
- Screens import icons via `./icons/index.tsx`

### External

- `lucide-react` (re-exported through `icons/index.tsx`)

<!-- MANUAL: -->
