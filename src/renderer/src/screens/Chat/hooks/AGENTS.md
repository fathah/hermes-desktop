<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# Chat/hooks

## Purpose

Custom React hooks that hold the Chat screen's state and side effects. Components in `..` stay presentational by delegating logic here. Each hook has one clear responsibility.

## Key Files

| File | Description |
|------|-------------|
| `useChatIPC.ts` | Subscribes to `window.api.chat.onEvent`, parses incoming SSE events, builds the message list and streaming state |
| `useChatActions.ts` | Send / stop / retry / undo / new — the user-initiated action surface that the input and header call |
| `useChatScroll.ts` | Scroll-position management for `MessageList` — auto-stick to bottom while streaming, release on user scroll-up |
| `useFastMode.ts` | Toggle + persistence for Fast Mode (Opus with faster output, model-side feature) |
| `useInputHistory.ts` | ↑/↓ navigation through past inputs; persists per-session history |
| `useLocalCommands.ts` | Handles slash commands that run entirely client-side (`/clear`, `/help`, `/undo`, ...) without hitting the backend (~7 KB) |
| `useModelConfig.ts` | Reads + writes the active model configuration via `window.api.models.*` |

## For AI Agents

### Working In This Directory

- **One concern per hook.** If a hook starts taking more than one ~3 KB-worth of responsibility, split it.
- **Hooks return objects, not tuples.** Named keys make additive changes safe.
- **Cleanup**: every effect that subscribes via `window.api.*.onEvent` must return the unsubscribe function from the cleanup. The bridge contract is that all `on*` calls return an unsubscribe.
- **Fast Mode** state is persisted via `window.api.config.*`; don't keep it in `useState` alone.
- **Local commands** (`useLocalCommands.ts`) should fail loudly if a slash command is registered but no handler exists — silent no-ops are worse than errors.

### Testing Requirements

- Hooks here are not currently unit-tested. If you add complex logic, prefer extracting pure helpers and testing those.
- Integration: exercise via manual chat smoke test.

### Common Patterns

- File name = `useXxx.ts`; exports a single default or named hook.
- IPC subscribed inside `useEffect` with explicit dependency arrays.
- Refs (`useRef`) hold mutable streaming buffers to avoid re-renders mid-stream.

## Dependencies

### Internal

- `../slashCommands.ts` (registry)
- `../types.ts`
- `window.api.chat.*`, `window.api.config.*`, `window.api.models.*`, `window.api.session.*`

### External

- `react`

<!-- MANUAL: -->
