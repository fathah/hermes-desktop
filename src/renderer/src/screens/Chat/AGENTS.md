<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# Chat

## Purpose

The streaming conversation screen — the centerpiece of the app. Owns SSE event handling from the Hermes Agent backend, slash-command parsing, model picker, tool progress rendering, markdown + syntax-highlighted output, token-usage display, fast mode, and input history. The only screen broken into multiple files.

## Key Files

| File | Description |
|------|-------------|
| `Chat.tsx` | Screen root — composes header, message list, input; orchestrates the hooks (~5 KB) |
| `ChatHeader.tsx` | Top bar — session title, model picker trigger, token usage |
| `ChatEmptyState.tsx` | Empty-session placeholder with quick-start prompts |
| `ChatInput.tsx` | Multi-line input — slash-command dropdown, send/stop button, drop-target wiring (~9 KB) |
| `MessageList.tsx` | Scroll-managed message viewport |
| `MessageRow.tsx` | Single message row (user/assistant/tool/system) — feeds content into `AgentMarkdown` |
| `ModelPicker.tsx` | Popover for switching active model |
| `slashCommands.ts` | Slash-command registry, parser, suggestion matcher (~4 KB) |
| `keyboard.ts` | Keyboard event helpers (Enter to send, Shift+Enter newline, history nav, slash trigger) |
| `keyboard.test.ts` | Vitest coverage for `keyboard.ts` |
| `types.ts` | Shared local types for chat |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `hooks/` | Custom hooks that hold the screen's logic (chat IPC, scroll, fast mode, input history, local commands, model config, actions) (see `hooks/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- **SSE events** arrive via `window.api.chat.onEvent(cb)` (typed in `src/preload/index.d.ts`) — never call `ipcRenderer` directly. The hook `useChatIPC` is the canonical subscriber.
- **Slash commands**: the registry in `slashCommands.ts` is the source of truth for the dropdown; the **descriptions** are localized in `src/shared/i18n/locales/*/chat.ts`. Adding a slash command means updating both, plus possibly handling it in `useLocalCommands.ts` if the command runs entirely client-side.
- **Markdown rendering** is done by `../../components/AgentMarkdown.tsx` — performance-sensitive because the assistant stream re-renders many times per second. Memoize.
- **Keyboard handling** lives in `keyboard.ts` with a co-located test — keep it covered.
- **Input history** is managed by `hooks/useInputHistory.ts` (↑/↓ keys cycle through past inputs). Don't bypass it from `ChatInput.tsx` directly.
- **Model config**: read/write via `hooks/useModelConfig.ts` (it talks to `window.api.models.*`).

### Testing Requirements

- `keyboard.test.ts` covers the keyboard helper.
- Streaming behavior is exercised by `tests/sse-parser.test.ts` at the main-process boundary.
- Manual smoke test after changes: start a chat, send a message, watch token usage update, try a slash command, try Fast Mode.

### Common Patterns

- Hooks own state and effects. Components are presentational and receive callbacks from hooks.
- Stream-derived state (`isStreaming`, `currentMessage`) is computed by `useChatIPC` and threaded down — never re-derived from scratch in child components.
- Local slash commands (`/clear`, `/help`) short-circuit before sending to the backend — see `useLocalCommands.ts`.

## Dependencies

### Internal

- `../../components/AgentMarkdown.tsx`
- `../../constants.ts` (default models, fast-mode flag)
- `window.api.chat.*`, `window.api.session.*`, `window.api.models.*`

### External

- `react`, `react-markdown`, `remark-gfm`, `react-syntax-highlighter`
- `lucide-react`

<!-- MANUAL: -->
