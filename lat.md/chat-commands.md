# Slash command execution

Typed slash commands (`/compact`, `/compress`, `/reset`, `/web`, …) are run through the gateway's command pipeline, not submitted to the model as plain prompt text. This is what makes them _do_ something instead of being echoed back as prose.

The desktop talks to the hermes-agent gateway over JSON-RPC. A normal message goes via `prompt.submit`, which the gateway treats as a user turn — so a literal `/compact` reaches the model and comes back as text. Real commands must instead go through `slash.exec` (registry-backed worker) with a `command.dispatch` fallback for commands that resolve to an alias, plugin, skill, or an agent prompt.

**Profile scoping over the unified SSH dashboard.** In SSH mode one machine dashboard serves every profile (see [[main-process#SSH dashboard transport]]), so chat calls must carry the active `profile` or the gateway runs them under its launch profile (`default`) — the agent would then answer as `default` even when a named profile is selected. [[src/main/remote-sessions.ts#RemoteSessionConfig]]`.profile` scopes the `/api/*` HTTP ops, and the `/api/ws` chat client passes `profile` on `session.create`/`session.resume` **and** `prompt.submit`/`prompt.background` ([[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#submitDashboardPromptWithRecovery]]); `session.create` builds the agent and persists against that profile's `HERMES_HOME`/`state.db`, and each turn re-binds it. Omitted/`default` → the launch profile (unchanged for local and per-profile-remote setups).

## Routing pipeline

The pure routing logic lives in [[src/renderer/src/screens/Chat/slashExec.ts#executeSlash]]: try `slash.exec`, accept either rendered output or a structured dispatch result, and on rejection fall back to `command.dispatch`, returning `done`, `send`, or `error`.

The name/argument split is done by [[src/renderer/src/screens/Chat/slashExec.ts#parseSlash]], which matches with the dotAll flag so a command's argument may span multiple lines (e.g. a multi-line `/remember` note) — an empty name is what `executeSlash` rejects as an empty command, so a multi-line body must not collapse the match.

It mirrors hermes-agent's reference client (`web/src/lib/slashExec.ts`) so every front-end implements the same contract. Pending-input commands such as `/learn` can return `{type: "send"}` directly from `slash.exec`; that prompt still passes through the central model-submission path.

## Local vs gateway commands

Every typed slash command is resolved through the merged catalog before execution. Ownership is explicit (`target: "desktop" | "agent" | "model"`); display categories such as `info` do not determine routing.

Desktop-only commands delegate to local renderer handlers, Agent commands use the gateway command pipeline, and model commands build a prompt through the shared model-submission formatter. The legacy transport reports Agent commands as unavailable instead of sending raw `/…` text to the model.

## Commands never queue

Slash commands run on the gateway's **persistent slash-worker subprocess**, concurrent with any in-flight turn — so they respond instantly and must NOT sit in the busy queue behind a running turn (only plain prompts queue).

`handleSubmitOrQueue` in [[src/renderer/src/screens/Chat/Chat.tsx]] dispatches every `/…` input immediately to the central router. Desktop and slash-worker commands can complete concurrently; model commands and Agent `send`/skill directives are formatted once and queued when the main model turn is busy.

Because no global loading state is set, the slash branch shows its own feedback: it inserts an in-place `⏳ Running …` agent bubble, buffers the pipeline output, and replaces that bubble with the result (or `error: …`) when the command resolves — otherwise a slow or unreachable gateway would leave the user staring at nothing. Handled UI actions without output silently remove the pending bubble without leaving conversation artifacts.

## Transport connection lifecycle

Every dashboard turn first connects a JSON-RPC WebSocket to the gateway; that handshake must be time-bounded or a stalled socket wedges the whole transport with no error and no fallback (issue #718).

[[src/renderer/src/screens/Chat/dashboardGatewayClient.ts#DashboardGatewayClient#connect]] resolves on `open`, rejects on `error` or an early `close`, **and** rejects on a connect-timeout (default 10s). A WebSocket stuck in `CONNECTING` — TCP accepted but the upgrade never completing, e.g. when a busy renderer starves the handshake — fires none of those events on its own, so without the timer the connect promise never settles. When it never settles, `ensureClient` in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] never resolves, its cached `connectingRef` promise poisons every later send, `setIsLoading(false)` never runs, and the user sees a permanent loading spinner. The timeout makes the promise reject so auto mode falls back to the legacy HTTP transport (and explicit-dashboard mode surfaces a real error) instead of hanging. Per-request calls are separately bounded by their own 30s timeout.

## Dashboard up ⇒ /api/ws only (never /v1 fallback)

When a dashboard is available, chat goes through `/api/ws` **only** — never the `/v1` fallback, which 405s over the dashboard tunnel.

This matches the reference `apps/desktop`, which has no `/v1` chat path at all (its `use-prompt-actions.ts` submits via `requestGateway('prompt.submit', …)` with a busy-retry). The fork's main-process `/v1` path (`sendMessageViaApi`/`sendMessageViaRuns`) exists solely for genuine gateway-only remotes; falling to it while a dashboard is up POSTs `/v1` to the dashboard tunnel — which has no `/v1` → **405**.

So `ensureClient` distinguishes two failures: a **genuinely absent** dashboard (`startDashboard` → `running:false`) latches the negative flag and (auto mode) drops to legacy gateway `/v1`; a **transient** WS drop while the dashboard is up (a "socket hang up" from a tunnel blip) instead **retries the connect** (up to 3×, re-running `startDashboard` each time to re-establish the SSH tunnel). If it still can't connect, it throws a `dashboardWasReachable`-tagged error so `sendMessage` **fails the turn for the user to retry** rather than 405-ing on `/v1`.

## Completion text reconciliation

On `message.complete` the desktop reconciles the text streamed via `message.delta` with the turn's `final_response`, because a last-turn-only final would otherwise clobber text streamed before a tool call (#746).

[[src/renderer/src/screens/Chat/dashboardEventAdapter.ts#completeAssistantWithFinalText]] rewrites the last assistant bubble through [[src/renderer/src/screens/Chat/dashboardEventAdapter.ts#mergeStreamedWithFinal]], which compares whitespace-insensitively and: uses the final text when it already contains the streamed text; keeps the streamed text when it contains the final (preserving pre-tool-call content); replaces a **lossy chunk-dropped stream** with the final text when [[src/renderer/src/screens/Chat/lossyText.ts#isLossyChunkCopy]] recognises the streamed content as a chunk-dropped copy of the final (the upstream tagging alternate chunks as `reasoning` leaves the content stream a garbled subset like "! What are we working on?" for "Hey! What are we working on today?"; concatenating stacked the partial above the clean answer in one bubble: the matcher requires contiguous runs of ≥3 chars (≥6 for CJK/Japanese/Korean text, where a run this short is much weaker evidence of continuity) plus ≥12-char / ≥30%-coverage guards, so a pre-tool-call segment whose characters merely embed as scattered fragments still stacks); stitches a re-streamed boundary by dropping the duplicated word-aligned seam (rejecting coincidental mid-word overlaps); replaces a garbled re-stream with the final text when the two converge on a substantial common suffix (a corrupted-prefix delta, e.g. a mangled CJK stream, that ends the same sentence as the clean final, rather than the disjoint pre-tool-call + answer pair); and otherwise concatenates the two with a blank-line separator so segments never run together. On the remote/SSH path deltas are not rendered (`renderAssistantDeltas: false`), so the bubble starts empty and the final text is used verbatim.

### Unicode length and coverage guards

Lossy-copy admission and run matching count Unicode code points consistently. Supplementary-plane characters cannot bypass the minimum 12-character length or 30% coverage by occupying two UTF-16 code units.

[[src/renderer/src/screens/Chat/lossyText.test.ts]] rejects an 11-character partial and a 12-character partial covering less than 30%, while retaining acceptance at the exact 12-character/30% boundary. This protects distinct streamed completion and reasoning text from false deduplication.

## Streaming source-of-truth ref

`handleGatewayEvent` in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] applies stream events against a synchronous `messagesRef`, not React state, because state lags a render behind and each successive delta must build on the previous one.

The ref is the write-through transcript ref owned by [[src/renderer/src/screens/Chat/hooks/useTranscriptState.ts#useTranscriptState]] and shared with every transcript writer through its wrapped `setMessages`: the wrapper resolves functional updaters against the ref _at dispatch time_ and writes the result back before dispatching the value to React. This is the correctness invariant that replaced the old adopt-back effect. Committed React state can be up to a frame behind the ref while deltas coalesce, so a writer resolved against committed state (a `/btw` user turn, `handleClear`, a clarify card resolving, failure marking) would fork from a pre-delta snapshot and silently drop the in-flight chunks — the coalesced twin of #757. With the write-through wrapper, every writer builds on the newest transcript and the ref always equals the newest dispatched-or-streamed array.

Delta commits are coalesced: high-frequency events (`message.delta`, `thinking.delta`, `reasoning.delta`, `tool.progress`, `tool.generating`) update the ref and schedule one `setMessages(messagesRef.current)` per animation frame, while lifecycle events (start/complete/clarify/tool boundaries) cancel any pending frame and commit immediately, so `isLoading`/approval state never observes a stale transcript. Because the flush publishes the ref rather than a pinned snapshot, a frame that fires after another writer took over republishes (or advances to) that newer state — it can never resurrect an older transcript. Nothing may call the raw state setter or re-adopt committed state into the ref. Specified by the delta-coalescing tests in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]].

## Reasoning & tool activity rows

Streamed reasoning and tool calls are folded into compact, collapsible transcript rows rather than stacked bubbles, so a turn with heavy thinking or many tool calls stays scannable.

[[src/renderer/src/screens/Chat/HistoryRow.tsx#ReasoningRow]] renders the `Thought` / `Thinking…` row and [[src/renderer/src/screens/Chat/HistoryRow.tsx#ToolActivityGroup]] folds a contiguous run of tool calls/results into one row titled by [[src/renderer/src/screens/Chat/HistoryRow.tsx#toolActivityGroupTitle]]. Each row is collapsed by default and borderless (Codex-style): dim at rest, it brightens and reveals an expand chevron beside the title on hover/focus, and clicking toggles the body open. While the turn is still streaming the leading icon is a thinking-orbs [[loading-indicators|OrbLoader]] (`solving` for reasoning, `working` for tools); once finished it shows the brain/tool glyph.

### Reasoning reconciliation

The live reasoning stream is best-effort — dropped delta chunks leave the streamed row garbled — while state.db holds the canonical text. The DB refresh must collapse the two, or the user sees both stacked in one Thought block.

The observed symptom: a Thought block showing "moon-k3 … ous" (lossy live preview) above "moonshotai/kimi-k3 … nous" (canonical DB row) for the same thought.

Because the garbled text can't match the DB row's text-based reconciliation key, [[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileStreamedWithDb]] ends with [[src/renderer/src/screens/Chat/sessionHistory.ts#dropLossyStreamedReasoning]]: a streamed reasoning row is dropped when [[src/renderer/src/screens/Chat/lossyText.ts#isLossyChunkCopy]] recognises it as a chunk-dropped copy of a DB reasoning row (`db-r-<id>`) in the **same turn**. A dropped-chunks preview is by construction a concatenation of contiguous runs of the canonical text; the matcher's run (≥3 chars, ≥6 for CJK/Japanese/Korean text) and length/coverage (≥12 chars, ≥30%) guards separate "same thought, chunks missing" from a genuinely distinct short segment whose characters merely embed as scattered fragments.

#### Lossy live preview collapses into the DB row

A streamed reasoning row recognised as a chunk-dropped copy of the same turn's DB reasoning row disappears from the merge; only the canonical DB text renders. A short thought whose characters embed only as scattered fragments is kept.

#### Distinct live segments survive

A second live reasoning segment that is not a lossy duplicate of any DB row in the turn (multi-segment thinking around tool calls) is kept alongside the reconciled first segment.

#### Turn-scoped matching

The chunk-copy check never crosses turns: a live preview in turn 2 is kept even when its text would match turn 1's canonical reasoning, so repeated questions can't cross-cancel live rows.

## Bubble hover timestamp

Each user/assistant bubble reveals a relative "time ago" label on row hover, so the transcript stays uncluttered at rest but is still scrutable when a user wants to know _when_ something was said.

The canonical time comes from state.db: [[src/renderer/src/screens/Chat/sessionHistory.ts#dbItemsToChatMessages]] copies each row's `timestamp` onto the `ChatBubbleMessage`, and [[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileAfterDbRefresh|the end-of-stream reconcile]] adopts it onto the matching streamed bubble (via `mergeDbMetadataIntoStreamed`) so a live turn picks up its real time after refresh without remounting. state.db stores times in **seconds**, so `toEpochMs` in MessageRow scales any sub-`1e12` value up to milliseconds before use (otherwise it renders as ~Jan 1970). [[src/renderer/src/screens/Chat/MessageRow.tsx#formatBubbleTime]] builds the label with date-fns `formatDistanceToNowStrict` (e.g. "5 minutes ago", "just now" under 10s), with `formatBubbleTimeAbsolute` supplying the exact date/time as the `<time>` element's `title`/`dateTime`. The `.chat-message:hover .chat-bubble-time` CSS fades it in below the bubble, anchored to `.chat-message` because `.chat-bubble`'s own `overflow` would clip it.

## Renderer-native commands

A few non-local commands have dedicated desktop handling and must NOT be diverted to the gateway slash pipeline, or they'd lose their behaviour.

The legacy approval responses `/approve` and `/deny` (the `RENDERER_NATIVE_SLASH` set) are excluded from the pipeline and sent as prompt-level input. They remain a compatibility path for text-only backends; structured gateway approvals use the flow below.

## Structured command approvals

Dangerous commands pause the current turn until the user explicitly allows or denies them; the desktop never auto-approves or replays a prompt after an approval request.

Response acknowledgements may follow turn completion; lifecycle regression coverage is documented in [[approval-completion]].

[[src/shared/chat-approval.ts#normalizeApprovalRequest]] limits choices to the gateway's offered permissions and preserves a deny path. Dashboard chat renders [[src/renderer/src/screens/Chat/ApprovalCard.tsx#ApprovalCard]] from `approval.request`. Responses include the gateway-issued `request_id` and runtime session ID through [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]]. Cards queue in arrival order, with an in-flight guard. Only an acknowledgment resolving exactly one request succeeds. Network failures can retry the same ID; a missing ID or unresolved acknowledgment invalidates the cards and interrupts the turn.

Gateway-only WebSocket chat registers opaque renderer IDs through [[src/main/hermes.ts#registerPendingApproval]], bound to the originating renderer and run by [[src/main/ipc/register.ts#registerIpcHandlers]]. These IDs map to the upstream request IDs; they never substitute for them. Completion, cancellation, renderer destruction, or connection loss clears pending requests. Run cleanup retains the originating connection key; cancelled IPC calls settle, and runs that finish before their handle arrives are not registered as active. A transport failure after any approval request cannot replay the prompt. Callers without an approval UI fail closed. `Always allow` requires a second confirmation because the gateway persists that permission.

The current upstream `/v1/runs/{run_id}/approval` handler ignores request IDs and resolves the queue head. Desktop therefore stops Runs API turns that request approval, using the original connection's credentials, and directs users to Dashboard chat. Ordinary Runs streaming remains available; manual Runs approvals require an upstream contract change first.

### Stale approval isolation

Dashboard regression tests simulate expired requests and lost acknowledgments with a queued second command, ensuring retries cannot approve that next command and unresolved responses stop the turn.

### Gateway approval correlation

WebSocket transport tests verify opaque renderer IDs map to gateway IDs, and missing IDs, disconnects, or lost prompt acknowledgments stop the turn without replaying it.

### Runs approval fail-closed

Runs transport tests verify approval events stop the original run with its captured credentials, never POST an approval, and never replay through chat completions.

## Side questions (`/btw`)

`/btw` (with aliases `/bg` and `/background`) is a side question that runs on a **concurrent background agent**, so it must never block or queue behind the main turn — that is the point of "ask without affecting context".

It maps to the gateway's `prompt.background` RPC, which spawns a separate agent and reports back later via a `background.complete` event (a normal `prompt.submit` mid-turn is rejected with "session busy"). [[src/renderer/src/screens/Chat/hooks/useChatActions.ts#parseBackgroundCommand|parseBackgroundCommand]] detects these commands; `handleSubmitOrQueue` in [[src/renderer/src/screens/Chat/Chat.tsx]] fires them immediately — bypassing the busy queue — via the shared background flow (also used by the 💭 quick-ask button). The transport's `runBackground` ([[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]]) calls the RPC, and its gateway-event handler renders the `background.complete` answer as a standalone `[bg …]` message. The legacy (non-dashboard) transport has no background RPC and falls back to the blocking quick-ask.

## Central command router

The central slash command architecture in [[src/renderer/src/screens/Chat/slash/handleSlashCommand.ts#handleSlashCommand]] classifies every slash command into a discriminated union (`target: "desktop" | "agent" | "model"`). Unrecognized commands return an error instead of reaching the model as prose.

The router's attachment guard rejects a command run with staged attachments unless it declares `supportsAttachments`, but `target: "desktop"` commands are exempt — they are local UI actions / info displays that never consume attachments (the files stay in the composer for the next message), matching the pre-router behavior where local commands ran unconditionally. Only `agent`/`model` commands, which route content upstream, are gated.

The command palette and executor share a catalog built by [[src/renderer/src/screens/Chat/slash/commandCatalog.ts#createSlashCatalog]]. Hermes Agent metadata comes from `commands.catalog`; Desktop commands are merged after collision validation, and upstream names/aliases are normalized from `/name` to the router's canonical `name`.

The same successful catalog read is recorded through the bounded compatibility bridge described by [[agent-capabilities#Bounded command inventory]]. Only normalized names reach the main-process cache; a failed read clears prior command evidence so capability gates become unknown rather than stale.

[[src/renderer/src/screens/Chat/slash/commandCatalog.ts#reconcileSlashCatalog]] merges the backend catalog with the in-repo desktop commands into a conflict-free catalog before it reaches `createSlashCatalog`. Desktop commands are authored in-repo and win deterministically; the backend catalog is untrusted runtime data, so a collision there must never crash the app. Any backend command whose name equals a desktop command **name or alias** is dropped (missing the alias check let a backend `/commands` command squat `help`'s `commands` alias and crash startup — #813), and a `canon` alias that targets a desktop command becomes an agent-visible alias entry instead.

[[src/renderer/src/screens/Chat/slash/commandCatalog.ts#agentCommandsFromCatalog]] reconciles the gateway's two-part catalog — the flat `pairs` command list and the `canon` alias map — into a self-consistent shape first. Because `createSlashCatalog` deliberately throws on a name registered twice (to catch genuine desktop-authoring conflicts), the reconciler drops any `canon` alias whose name is already a first-class `pairs` command: the backend can legitimately expose the same name as both (e.g. `/compact` is a standalone TUI command _and_ an alias of `/compress`), and without this guard the merge would throw and crash the app on agent connect.

### Desktop commands

Desktop commands in [[src/renderer/src/screens/Chat/slash/desktopCommands.ts#DESKTOP_SLASH_COMMANDS]] handle local Electron/renderer UI operations such as opening settings, triggering the active chat's model picker, and switching navigation views without sending prompts.

Pure UI desktop actions are flagged `uiAction: true` (settings, model picker, navigation, `/new`, `/clear`, `/fast`). [[src/renderer/src/screens/Chat/hooks/useChatActions.ts#useChatActions]] reads that flag to suppress the echoed `/command` user bubble for them — their effect is the UI change itself, so a bubble would be a dangling artifact. Output-producing desktop commands (`/help`, `/memory`, `/usage`, …) are not flagged and still echo, so their output reads as a reply.

`/settings <section>` forwards the section name through `openSettings` to [[src/renderer/src/screens/Layout/Layout.tsx]], which opens the global settings modal on the matching nav item (see [[sidebar-navigation#Settings modal]]). [[src/renderer/src/components/settings/SettingsModal.tsx#resolveSection]] maps the argument to a nav id (`appearance`, `privacy`, `connection`, …, plus the legacy alias `hermesagent` → About); an unknown or omitted name lands on the first item.

Asynchronous Agent commands render a temporary slash-loader bubble without transcript actions such as Copy; the bubble is replaced by the command output or error when execution finishes.

### Agent commands

Agent commands forward upstream via [[src/renderer/src/screens/Chat/slash/executeAgentCommand.ts#executeAgentCommand]] using gateway JSON-RPC.

### Model commands

Model commands and Agent `send`/skill directives pass through [[src/renderer/src/screens/Chat/slash/prepareModelSubmission.ts#prepareModelSubmission]] before entering the standard chat transport. This is the only slash route allowed to submit model content.

### Command icons

Visual presentation in the autocomplete popup is handled by [[src/renderer/src/screens/Chat/slash/SlashCommandIcon.tsx#SlashCommandIcon]], mapping command names to Lucide icons with fallback defaults and a custom SVG registry. Every slash command including desktop settings and navigation shortcuts is assigned an icon.

Custom icons render via `dangerouslySetInnerHTML`, so string SVGs passed to [[src/renderer/src/screens/Chat/slash/SlashCommandIcon.tsx#registerCustomSlashSvg]] are stripped of `<script>`/`<foreignObject>`, inline `on*` handlers, and `javascript:` URIs before storage — a defensive guard (real icons never need them), not a full sanitizer. Only register trusted markup; route remote/plugin-sourced SVG through a proper sanitizer first.

Typing `/` opens a centered command palette in [[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] while the composer retains keyboard focus. Results filter by name or description, stay grouped by category, and support arrows, Enter or Tab, and Escape.

Escape is captured at the document level while the palette is open, so it closes even if focus has moved from the composer into a command row. Dismissal preserves the slash draft and returns focus to the composer.

The palette pre-normalizes searchable command metadata and virtualizes its grouped rows through [[src/renderer/src/screens/Chat/slash/virtualSlashCommands.ts#createSlashCommandVirtualLayout]]. Only visible rows plus a small overscan are mounted, while keyboard selection uses calculated offsets.

## Dashboard clarification cards

Dashboard clarify requests preserve structured choices. Answers and skips must return through the originating dashboard client, while local cards retain IPC delivery.

[[src/renderer/src/screens/Chat/dashboardEventAdapter.ts#appendClarifyRequest]] creates a dashboard-tagged card. [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] supplies the transport responder to [[src/renderer/src/screens/Chat/ClarifyCard.tsx]]. [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] shares delivery with the composer, accepts only a confirmed `status: ok`, and invalidates pending questions on connection/session changes, completion, abort or teardown. Disconnects expire cards rather than sending an old answer through a new runtime. The card retains retry feedback on delivery failure. Tests: [[dashboard-clarify]].

Agent `clarify.expire` notifications disable only the matching pending card and restore tracking of the turn that resumes after timeout. Replays of answered, expired or currently responding questions cannot invalidate a newer question or reset the resumed turn's busy state.
