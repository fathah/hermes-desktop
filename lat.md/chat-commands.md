# Slash command execution

Typed slash commands (`/compact`, `/compress`, `/reset`, `/web`, …) are run through the gateway's command pipeline, not submitted to the model as plain prompt text. This is what makes them _do_ something instead of being echoed back as prose.

The desktop talks to the hermes-agent gateway over JSON-RPC. A normal message goes via `prompt.submit`, which the gateway treats as a user turn — so a literal `/compact` reaches the model and comes back as text. Real commands must instead go through `slash.exec` (registry-backed worker) with a `command.dispatch` fallback for commands that resolve to an alias, plugin, skill, or an agent prompt.

## Routing pipeline

The pure routing logic lives in [[src/renderer/src/screens/Chat/slashExec.ts#executeSlash]]: try `slash.exec`, and on rejection fall back to `command.dispatch`, returning a `SlashExecOutcome` of `done` (output rendered), `send` (resolved to an agent prompt the caller should stream), or `error`.

It mirrors hermes-agent's reference client (`web/src/lib/slashExec.ts`) so every front-end implements the same contract. Returning the `send` directive rather than dispatching it keeps the streaming turn lifecycle (loading state, active turn, `prompt.submit`) in the caller.

## Local vs gateway commands

Commands flagged `local: true` or in the `info` category are handled entirely in the renderer and never reach the gateway; everything else is routed through the pipeline.

A handful of commands (`/new`, `/clear`, `/fast`, `/usage`) are resolved client-side by `useLocalCommands`. The submit handler [[src/renderer/src/screens/Chat/hooks/useChatActions.ts#useChatActions]] checks those first, then routes any remaining `/…` text through the dashboard transport's slash pipeline — falling back to plain-text send only on the legacy (non-dashboard) transport.

## Commands never queue

Slash commands run on the gateway's **persistent slash-worker subprocess**, concurrent with any in-flight turn — so they respond instantly and must NOT sit in the busy queue behind a running turn (only plain prompts queue).

`handleSubmitOrQueue` in [[src/renderer/src/screens/Chat/Chat.tsx]] dispatches any `/…` text immediately (for local commands or whenever the dashboard transport is active) instead of queueing. The `slash.exec` call sets no loading/active-turn state, so it can't collide with a streaming turn. The one exception is a command that resolves to a `send` directive (an agent prompt needing the single-flight main session): if a turn is already running it is deferred onto the queue via `enqueueMessage` rather than colliding. The legacy transport has no worker, so its slash commands still queue.

Because no global loading state is set, the slash branch shows its own feedback: it inserts an in-place `⏳ Running …` agent bubble, buffers the pipeline output, and replaces that bubble with the result (or `error: …`) when the command resolves — otherwise a slow or unreachable gateway would leave the user staring at nothing.

## Mid-turn queue anchoring

Follow-ups submitted during a running turn preserve where they were entered without changing the canonical message order consumed by stream reducers and backend history.

[[src/renderer/src/screens/Chat/queueAnchoring.ts#captureQueueAnchor]] records the last message in the active turn when a plain follow-up or resolved `/queue` prompt is deferred. Pending items stay in `queuedMessages`, outside the canonical `messages` array, so reasoning, tool, and completion events cannot mistake a queued prompt for a new active-turn boundary.

[[src/renderer/src/screens/Chat/queueAnchoring.ts#buildQueueAwareRenderPlan]] builds a visual-only transcript plan. It places pending queue notes and their eventual user bubbles after the captured message while leaving the underlying array in backend order. When the queue drains, the pending note is replaced by exactly one normal user message carrying the same renderer-only anchor.

The `/queue` send-directive path in [[src/renderer/src/screens/Chat/hooks/useChatActions.ts#useChatActions]] does not optimistically append the literal command. It resolves the command first, defers only the resulting prompt while busy, and starts a normal turn immediately when idle. A synchronous queued-send failure removes the optimistic user row and rejects back to the queue drain, which restores the item at the front and pauses automatic draining until the user retries instead of silently losing it or entering a retry loop.

## Transport connection lifecycle

Every dashboard turn first connects a JSON-RPC WebSocket to the gateway; that handshake must be time-bounded or a stalled socket wedges the whole transport with no error and no fallback (issue #718).

[[src/renderer/src/screens/Chat/dashboardGatewayClient.ts#DashboardGatewayClient#connect]] resolves on `open`, rejects on `error` or an early `close`, **and** rejects on a connect-timeout (default 10s). A WebSocket stuck in `CONNECTING` — TCP accepted but the upgrade never completing, e.g. when a busy renderer starves the handshake — fires none of those events on its own, so without the timer the connect promise never settles. When it never settles, `ensureClient` in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] never resolves, its cached `connectingRef` promise poisons every later send, `setIsLoading(false)` never runs, and the user sees a permanent loading spinner. The timeout makes the promise reject so auto mode falls back to the legacy HTTP transport (and explicit-dashboard mode surfaces a real error) instead of hanging. Per-request calls are separately bounded by their own 30s timeout.

## Renderer-native commands

A few non-local commands have dedicated desktop handling and must NOT be diverted to the gateway slash pipeline, or they'd lose their behaviour.

The approval responses `/approve` and `/deny` (the `RENDERER_NATIVE_SLASH` set) are excluded from the pipeline and sent as prompt-level input, matching their dedicated button handlers — `slash.exec` rejects pending-input commands anyway.

## Side questions (`/btw`)

`/btw` (with aliases `/bg` and `/background`) is a side question that runs on a **concurrent background agent**, so it must never block or queue behind the main turn — that is the point of "ask without affecting context".

It maps to the gateway's `prompt.background` RPC, which spawns a separate agent and reports back later via a `background.complete` event (a normal `prompt.submit` mid-turn is rejected with "session busy"). [[src/renderer/src/screens/Chat/hooks/useChatActions.ts#parseBackgroundCommand|parseBackgroundCommand]] detects these commands; `handleSubmitOrQueue` in [[src/renderer/src/screens/Chat/Chat.tsx]] fires them immediately — bypassing the busy queue — via the shared background flow (also used by the 💭 quick-ask button). The transport's `runBackground` ([[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]]) calls the RPC, and its gateway-event handler renders the `background.complete` answer as a standalone `[bg …]` message. The legacy (non-dashboard) transport has no background RPC and falls back to the blocking quick-ask.
