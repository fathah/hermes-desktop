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

[[src/renderer/src/screens/Chat/dashboardEventAdapter.ts#completeAssistantWithFinalText]] rewrites the last assistant bubble through [[src/renderer/src/screens/Chat/dashboardEventAdapter.ts#mergeStreamedWithFinal]], which compares whitespace-insensitively and: uses the final text when it already contains the streamed text; keeps the streamed text when it contains the final (preserving pre-tool-call content); stitches a re-streamed boundary by dropping the duplicated word-aligned seam (rejecting coincidental mid-word overlaps); replaces a garbled re-stream with the final text when the two converge on a substantial common suffix (a corrupted-prefix delta — e.g. a mangled CJK stream — that ends the same sentence as the clean final, rather than the disjoint pre-tool-call + answer pair); and otherwise concatenates the two with a blank-line separator so segments never run together. On the remote/SSH path deltas are not rendered (`renderAssistantDeltas: false`), so the bubble starts empty and the final text is used verbatim.

## Streaming source-of-truth ref

`handleGatewayEvent` in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] applies stream events against a synchronous `messagesRef`, not React state, because state lags a render behind and each successive delta must build on the previous one.

The handler reads the ref, applies a delta, writes the ref back, then calls `setMessages`. An effect mirrors `messages` back into `messagesRef`, and its guard is a correctness invariant. Every `setMessages` in the hook stores the exact same array in the ref, so when React commits the hook's own push, `messages === messagesRef.current` and the effect must skip: re-adopting that snapshot let a second `message.delta` land on a pre-delta array and silently drop a chunk (#757). The effect therefore syncs only when the identity differs (`messages !== messagesRef.current`), which happens only when Chat state changes underneath the hook — a new user turn, `handleClear` emptying the list, or a clarify card resolving in place. A length comparison is wrong here: it misses the shrink and the same-length replacement.

## Reasoning & tool activity rows

Streamed reasoning and tool calls are folded into compact, collapsible transcript rows rather than stacked bubbles, so a turn with heavy thinking or many tool calls stays scannable.

[[src/renderer/src/screens/Chat/HistoryRow.tsx#ReasoningRow]] renders the `Thought` / `Thinking…` row and [[src/renderer/src/screens/Chat/HistoryRow.tsx#ToolActivityGroup]] folds a contiguous run of tool calls/results into one row titled by [[src/renderer/src/screens/Chat/HistoryRow.tsx#toolActivityGroupTitle]]. Each row is collapsed by default and borderless (Codex-style): dim at rest, it brightens and reveals an expand chevron beside the title on hover/focus, and clicking toggles the body open. While the turn is still streaming the leading icon is a `Grid` loader (purple for reasoning, blue for tools); once finished it shows the brain/tool glyph.

## Bubble hover timestamp

Each user/assistant bubble reveals a relative "time ago" label on row hover, so the transcript stays uncluttered at rest but is still scrutable when a user wants to know _when_ something was said.

The canonical time comes from state.db: [[src/renderer/src/screens/Chat/sessionHistory.ts#dbItemsToChatMessages]] copies each row's `timestamp` onto the `ChatBubbleMessage`, and [[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileAfterDbRefresh|the end-of-stream reconcile]] adopts it onto the matching streamed bubble (via `mergeDbMetadataIntoStreamed`) so a live turn picks up its real time after refresh without remounting. state.db stores times in **seconds**, so `toEpochMs` in MessageRow scales any sub-`1e12` value up to milliseconds before use (otherwise it renders as ~Jan 1970). [[src/renderer/src/screens/Chat/MessageRow.tsx#formatBubbleTime]] builds the label with date-fns `formatDistanceToNowStrict` (e.g. "5 minutes ago", "just now" under 10s), with `formatBubbleTimeAbsolute` supplying the exact date/time as the `<time>` element's `title`/`dateTime`. The `.chat-message:hover .chat-bubble-time` CSS fades it in below the bubble, anchored to `.chat-message` because `.chat-bubble`'s own `overflow` would clip it.

## Renderer-native commands

A few non-local commands have dedicated desktop handling and must NOT be diverted to the gateway slash pipeline, or they'd lose their behaviour.

The approval responses `/approve` and `/deny` (the `RENDERER_NATIVE_SLASH` set) are excluded from the pipeline and sent as prompt-level input, matching their dedicated button handlers — `slash.exec` rejects pending-input commands anyway.

## Side questions (`/btw`)

`/btw` (with aliases `/bg` and `/background`) is a side question that runs on a **concurrent background agent**, so it must never block or queue behind the main turn — that is the point of "ask without affecting context".

It maps to the gateway's `prompt.background` RPC, which spawns a separate agent and reports back later via a `background.complete` event (a normal `prompt.submit` mid-turn is rejected with "session busy"). [[src/renderer/src/screens/Chat/hooks/useChatActions.ts#parseBackgroundCommand|parseBackgroundCommand]] detects these commands; `handleSubmitOrQueue` in [[src/renderer/src/screens/Chat/Chat.tsx]] fires them immediately — bypassing the busy queue — via the shared background flow (also used by the 💭 quick-ask button). The transport's `runBackground` ([[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]]) calls the RPC, and its gateway-event handler renders the `background.complete` answer as a standalone `[bg …]` message. The legacy (non-dashboard) transport has no background RPC and falls back to the blocking quick-ask.

## Central command router

The central slash command architecture in [[src/renderer/src/screens/Chat/slash/handleSlashCommand.ts#handleSlashCommand]] classifies every slash command into a discriminated union (`target: "desktop" | "agent" | "model"`). Unrecognized commands return an error instead of reaching the model as prose.

The router's attachment guard rejects a command run with staged attachments unless it declares `supportsAttachments`, but `target: "desktop"` commands are exempt — they are local UI actions / info displays that never consume attachments (the files stay in the composer for the next message), matching the pre-router behavior where local commands ran unconditionally. Only `agent`/`model` commands, which route content upstream, are gated.

The command palette and executor share a catalog built by [[src/renderer/src/screens/Chat/slash/commandCatalog.ts#createSlashCatalog]]. Hermes Agent metadata comes from `commands.catalog`; Desktop commands are merged after collision validation, and upstream names/aliases are normalized from `/name` to the router's canonical `name`.

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
