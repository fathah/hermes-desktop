# Chat message-list rendering performance

Typing in the composer must stay fast no matter how long the conversation is. The transcript is not virtualized in JS, so the layout cost is bounded with CSS containment plus a single batched textarea measurement (issue #748).

The symptom this guards against: in conversations with many messages, each keystroke took up to ~2.6s with an empty JS profile — the cost was entirely in Chromium's layout engine, recalculating the whole transcript on every keystroke. CPU and memory were normal; new sessions were instant.

## Off-screen rows are skipped with content-visibility

Every transcript row (`.chat-message`) sets `content-visibility: auto` with `contain-intrinsic-size: auto 120px`, so the browser skips layout and paint for off-screen rows. That turns a forced reflow from O(all messages) into O(visible rows).

The rule lives on `.chat-message` in the renderer stylesheet (`src/renderer/src/assets/main.css`). That class is shared by user/agent bubbles, the reasoning and tool-activity rows, and the typing indicator (see [[src/renderer/src/screens/Chat/MessageList.tsx]] and [[src/renderer/src/screens/Chat/MessageRow.tsx]]), so one rule covers every heavy row.

The `auto` keyword in `contain-intrinsic-size` makes the browser remember each row's real measured height after it renders once, so the scrollbar and scroll position stay accurate; the `120px` is only the first-paint estimate for never-yet-rendered rows.

### Paint containment and the hover timestamp

`content-visibility` implies paint containment, which clips anything drawn outside the row's box — including the hover timestamp that sits below the bubble.

The timestamp (`.chat-bubble-time`) used to overflow ~15px below the bubble and would be clipped. It now sits at `bottom: 1px` inside the row's `padding-bottom: 16px`, so it stays visible while still appearing just under the bubble.

## Block flow, not a flex column

The scroll container `.chat-messages` is block flow, not a flex column. A flex column measures each child to lay itself out, which defeats `content-visibility` and reports a wrong `scrollHeight`.

A correct `scrollHeight` matters because [[src/renderer/src/screens/Chat/hooks/useChatScroll.ts#useChatScroll]] uses `scrollHeight - scrollTop - clientHeight` to decide whether the view is pinned to the bottom; a wrong value would break auto-scroll.

The flex `gap` that previously spaced rows is replaced by per-row spacing: `.chat-message` carries `padding-bottom: 16px` (which also provides the timestamp's room), and non-message children that lack it (`.chat-clarify`) carry an equivalent `margin-bottom`. Block flow also moves alignment from `align-self` to `margin-left: auto` for user rows, and the empty state fills height with `min-height: 100%` instead of `flex: 1`.

## Textarea auto-resize avoids per-keystroke reflow

The composer textarea auto-grows to its content. Reading `scrollHeight` to size it forces a layout flush, so it runs once per committed value in a `useLayoutEffect` keyed on the input string, not on every keystroke.

In [[src/renderer/src/screens/Chat/ChatInput.tsx]] every path that changes the value (typing, history recall, voice transcription, and the imperative `setText`/`appendText`) goes through `setInput`, so the layout effect is the single owner of resizing — the other paths only set the caret and focus. Combined with the row-level `content-visibility`, the one measurement per keystroke stays O(visible rows).
