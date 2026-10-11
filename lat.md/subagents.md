# Subagent roster

Delegated children report their activity into the conversation that spawned them, so a subagent runs _inside_ the chat that asked for it instead of appearing as another sidebar session.

## Why it exists

A `delegate_task` fan-out creates a child session per worker, and those children are session rows in `state.db` with a `parent_session_id`. A sidebar that lists every session row shows them as separate conversations.

The gateway already relays the child's live activity to the PARENT session as `subagent.*` events (`tui_gateway/tool_progress.py::_progress_subagent` in hermes-agent), keyed by the parent's runtime session id. Child activity therefore belongs to the parent's view of the conversation: it is application state for the chat surface, not transcript content, and not a session of its own.

## Event projection and store

[[src/renderer/src/screens/Chat/subagents.ts]] projects gateway payloads into display rows: `applySubagentEvent` folds the live events into one row per `subagent_id`, and `reconcileSubagentSnapshot` merges the `subagent.list` roster for windows opened mid-run.

Rows are stored per connection, profile, config revision and session and exposed through `useSubagents`, a `useSyncExternalStore` subscription whose snapshot only changes identity when the rows change — a growing stream would otherwise re-render the composer on every chunk.

Two rules keep the model honest:

- **A completion event is terminal.** An unrecognized or still-`running` status on `subagent.complete` renders as `failed`, never as a row that spins forever (`timeout`/`error` → failed, `cancelled`/`canceled` → interrupted).
- **Absence is bounded evidence.** `subagent.start` can precede registry admission. Identified children survive any roster during a 10-second grace and retire after at least two successful omissions, with the final omission after the grace, including empty rosters. Newer events and successful snapshots fence older responses. Provisional rows remain event-fed and do not expose ID-bound controls.

`subagent.text` (the child's per-token reply) is deliberately not relayed to the parent, so the parent-side stream is built from tool, progress and thinking lines.

## Rendering above the composer

[[src/renderer/src/screens/Chat/SubagentSection.tsx]] renders the roster in the composer's input area, above the queued-message indicator. It shows only live rows: finished children are retired at the next turn boundary, while children that outlived their turn stay.

Expanding a row reveals the child's own stream, its live output tail (`subagent.tail`, polled only while the row is expanded and the window is visible) and controls that steer or stop it. A rejected request surfaces to the user instead of pretending it landed.

## Transport wiring

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]] intercepts `subagent.*` events before they reach the message-stream adapter (they never append to the transcript) and keys the roster by the durable session id the chat is showing.

The roster RPCs (`subagent.list`, `subagent.steer`, `subagent.interrupt`, `subagent.tail`) are bound to this conversation's runtime session, so a control can never address whichever session happens to be active. `list` answers empty only for a new conversation. Reopened conversations use the Agent’s lazy watch resume for roster reads and controls without sending a message, auto-continuing an interrupted turn or creating a replacement conversation. Connection, profile, revision and conversation changes reject late resumes.

## Verification

Tests cover the projection, the reconciliation guards and the section behaviour: `subagents.test.ts`, `SubagentSection.test.tsx`, and the roster cases in `useDashboardChatTransport.test.tsx`, including live-captured payloads.

## Recovery regressions

Repaired reconciliation preserves the registration gap, removes missed completions, isolates identical IDs by target and keeps the composer accessible in short windows.

### Registration gap

A sibling-only roster must not remove the new child's live row while registry admission is pending. Covered by [[src/renderer/src/screens/Chat/subagents.test.ts]].

### Missed completion

At least two successful omissions, with the final omission after the start grace, remove a stale identified live row even when every poll is empty. Failed requests provide no absence evidence. Covered by [[src/renderer/src/screens/Chat/subagents.test.ts]].

### Snapshot ordering

Events received after request start and later successful snapshots take precedence over old roster replies. Covered by [[src/renderer/src/screens/Chat/subagents.test.ts]].

### Target isolation

A durable session ID on another connection, profile or config revision cannot share rows or controls. The transport supplies the same scope to event projection and the rendered section. Covered by [[src/renderer/src/screens/Chat/subagents.test.ts]].

### Composer space

The complete roster scrolls inside a 30-viewport-percent or 240-pixel height limit, keeping expanded streams and child controls within the input area instead of growing over the composer.

### Control state isolation

Changing conversation scope remounts expanded controls, so identical child IDs cannot carry drafts or late transcript/action results to another target. Covered by [[src/renderer/src/screens/Chat/SubagentSection.test.tsx]].

### Finished row fencing

Terminal evidence survives display pruning, preventing old snapshots and progress events from restoring completed children or controls until an explicit new start. Covered by [[src/renderer/src/screens/Chat/subagents.test.ts]].

### Reopened conversation

Reading a saved chat resumes its existing session once for concurrent roster and control requests without sending a message or creating another conversation. Covered by [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]].

### Resume target isolation

A target change while a saved chat resumes rejects the old action before any child RPC reaches the replacement target. Covered by [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]].

### Snapshot terminal fencing

Terminal evidence is recorded for both cold snapshot hydration and running-to-completed snapshot updates, so pruning cannot restore completed children through late polls or events. Covered by [[src/renderer/src/screens/Chat/subagents.test.ts]].

### Conversation return fencing

Leaving a conversation invalidates a pending child control even if the same durable ID is reopened, and unmount rejects pending resumes before dispatch. Covered by [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]].
