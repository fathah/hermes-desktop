> Archived on 2026-06-25. This standalone Vite app is historical reference material only.
> The canonical SPS Agent implementation lives in `src/renderer/src/screens/SpsAgent/` in the Electron app.

# SPS Agent

A Notion-style workspace — documents + tasks + an AI co-author — built in the **SPS "Sukhi"
warm-paper design system**. This is a real, maintainable reimplementation (React + TypeScript +
Vite + Tailwind) of the single-file hi-fi prototype in [`../sps-agent-prototype/`](../sps-agent-prototype/),
which remains the canonical **design + interaction spec**.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint
npm test           # vitest (tree ops, markdown, assistant validation, task sort)
```

Copy `.env.example` → `.env` to configure providers (all optional; defaults run fully offline).

| Env var                   | Default                     | Purpose                                                      |
| ------------------------- | --------------------------- | ------------------------------------------------------------ |
| `VITE_ASSISTANT_PROVIDER` | `mock`                      | `mock` (offline) or `hermes` (live AI)                       |
| `VITE_HERMES_BASE_URL`    | `http://localhost:8000`     | Hermes OpenAI-compatible server, used by the `/v1` dev proxy |
| `VITE_HERMES_MODEL`       | `anthropic/claude-opus-4.6` | model id sent to Hermes                                      |

## Design-system fidelity (the whole point)

The look is **not** re-derived in Tailwind. It is carried over verbatim:

- **`src/styles/`** holds the four prototype stylesheets unchanged: `sps-tokens.css` (raw palette,
  type, spacing, radii, fonts) + `home.css` / `notion.css` / `v3.css` (semantic runtime variables
  and component rules). Components emit the **exact same class names** (`.rail`, `.block`, `.db-tab`,
  `.sel-toolbar`, …) — the CSS keys off them.
- Theme/layout switches are **pure attribute swaps on `<html>`** (`src/lib/theme.ts`): `data-theme`
  (light/warm-dark — no JS color math), `data-density`, `data-width`, `data-bodyfont`, the
  `--accent` / `--content-w` inline vars, and `.app[data-rail]` for the sidebar.
- **Tailwind** has `preflight` **disabled** and only mirrors the tokens into its theme
  (`tailwind.config.ts`) so any net-new utility resolves to the same variables. No ported component
  uses utility classes.

## Architecture

- **State:** a single Zustand store (`src/store/`) split into slices — `workspace` (tree/meta/docs/
  trash/page + all page ops), `comments`, `ui`, `tweaks`, `assistant`. Derived reads are stable
  selectors (`src/store/selectors.ts`); per-page filters are memoized in components (a `.filter()`
  selector would loop with `useSyncExternalStore`).
- **Persistence:** `PersistenceAdapter` interface (`src/lib/persistence.ts`) with `LocalAdapter`
  (localStorage, debounced 350 ms). Swap in a `RemoteAdapter` behind the same interface.
- **Editor:** `src/editor/` — `Editor` orchestrator + `Editable` blocks, slash menu, markdown
  shortcuts, drag reorder/nest, block menu, mentions, AI proposals/diffs.
- **Tasks DB:** `src/tasks/` — board/table/list/gallery/calendar, filter/sort, inline edits, drawer.
- **Panel:** `src/panel/` — Assistant / Outline / Comments / Info tabs.

## The three upgraded subsystems

### 1. AI assistant — interface-first

`AssistantProvider` (`src/assistant/types.ts`) is the contract; the editor already understands the
typed `AssistantResult` union (`chat | append | diff | db`). Providers are drop-in:

- **`MockAssistant`** — the prototype's canned logic; default, fully offline.
- **`HermesAssistant`** — POSTs to the repo's OpenAI-compatible `/v1/chat/completions` (Vite-proxied,
  **no API key in the browser**), requests structured JSON, and runs every response through
  `validateResult`, falling back to a `chat` reply if the model goes off-contract or the gateway is
  down. Enable with `VITE_ASSISTANT_PROVIDER=hermes` and a running Hermes gateway.
- An Anthropic-proxy provider can be added behind the same interface with **zero UI changes**.

### 2. Bookmark unfurl — real link metadata

Browsers can't fetch arbitrary cross-origin pages (CORS), so unfurl is a server endpoint:
`GET /api/unfurl?url=` (`vite-plugins/unfurl.ts`) fetches the page server-side, parses OG/Twitter/
title/description/favicon, and is **SSRF-guarded** against local/private hosts. `EndpointUnfurl`
calls it with graceful `MockUnfurl` fallback.

> **Production:** the dev middleware is Vite-only. Port the same handler in `vite-plugins/unfurl.ts`
> to an edge function / serverless route (e.g. `/api/unfurl`) for production builds.

### 3. Persistence + the multiplayer/presence seam

Local persistence ships today. For real-time collaboration, replace the `docs` slice's block document
with a **Yjs** doc + a network provider (WebSocket/WebRTC); presence (cursors/avatars) rides a
presence channel and renders where `src/shell/Presence.tsx` already draws collaborator avatars in the
topbar. The `PersistenceAdapter` boundary and the `Presence` component are the designated seams — no
other UI changes required.

## Out of scope (designed, not built)

Real Yjs multiplayer/presence · `RemoteAdapter` backend · production `/api/unfurl` route ·
Anthropic-proxy assistant provider. Each has a defined seam above.

## Security note

The editor stores and renders the user's own document HTML (contentEditable) directly, matching the
prototype. When peer-authored content arrives via a future multiplayer layer, sanitize it (e.g.
DOMPurify) at the network boundary before it reaches `Editable`/`DiffBlock`.
