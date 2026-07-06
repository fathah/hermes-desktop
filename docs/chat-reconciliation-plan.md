# Chat Reconciliation Stabilization Plan

## 2026-06-06 Direction Correction: Dashboard/WebSocket Timeline

This document originally described a conservative stabilization path for the
existing Hermes One reconciliation layer. That path is useful as background, but
it is not sufficient as the long-term implementation direction.

Manual testing and comparison with Hermes Agent desktop showed that PR540/PR545
and the current Hermes One implementation still share the same risky shape:

- live UI rows are assembled from one stream;
- restored/final rows are assembled from `state.db`;
- completion then tries to merge two independently-shaped transcripts;
- edge cases depend on content matching, row splitting, and heuristics.

The corrected target is closer to Hermes Agent desktop:

- use a live dashboard/WebSocket event stream as the active-turn source of
  truth;
- build one ordered turn timeline from gateway events;
- project both live events and restored DB rows through the same normalizer;
- avoid whole-transcript text-key reconciliation for active turns;
- treat DB hydration as replacement/fill-in after a turn is settled, not as a
  competing live transcript.

The old reconciliation work should not be expanded into another pile of special
cases. It should be treated as a compatibility layer while the dashboard
transport is introduced.

### What Hermes Agent Desktop Does Differently

The latest Hermes Agent desktop app lives at:

`apps/desktop` in `NousResearch/hermes-agent`.

Relevant files:

- `apps/desktop/electron/main.cjs`
- `apps/desktop/src/app/gateway/hooks/use-gateway-boot.ts`
- `apps/desktop/src/app/session/hooks/use-message-stream.ts`
- `apps/desktop/src/app/session/hooks/use-prompt-actions.ts`
- `apps/desktop/src/app/session/hooks/use-session-actions.ts`
- `apps/desktop/src/lib/chat-messages.ts`
- `apps/desktop/src/lib/chat-runtime.ts`

The desktop app starts a dashboard backend:

```text
hermes dashboard --no-open --host 127.0.0.1 --port <port>
```

It then connects the renderer to:

```text
ws://127.0.0.1:<port>/api/ws?token=<dashboard-token>
```

Submissions are JSON-RPC calls:

```text
session.create
session.resume
prompt.submit
session.interrupt
```

Streaming arrives as ordered events:

```text
message.start
reasoning.delta
reasoning.available
message.delta
tool.start
tool.progress
tool.generating
tool.complete
message.complete
error
clarify.request
approval.request
sudo.request
secret.request
subagent.*
```

The app does not render one independent "streamed transcript" and then reconcile
that against an unrelated DB transcript. It keeps a per-runtime-session state:

```ts
interface ClientSessionState {
  storedSessionId: string | null
  messages: ChatMessage[]
  busy: boolean
  awaitingResponse: boolean
  streamId: string | null
  sawAssistantPayload: boolean
  interrupted: boolean
  needsInput: boolean
}
```

Live events mutate the in-flight assistant message's ordered `parts[]`:

```ts
type ChatMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown; result?: unknown }
```

The key invariant is boundary flushing:

- before a tool starts, flush any queued assistant/reasoning text;
- before a tool completes, flush queued text;
- before final completion, flush queued text;
- when a final stored transcript is loaded, preserve local errors but otherwise
  prefer the stable stored projection.

This is why Hermes Agent desktop can show:

```text
thought
tool call/result
assistant text
thought
tool call/result
assistant text
```

instead of:

```text
all tool calls
all tool results
all intermediate text appended at the end
```

### Why DB Polling Did Not Solve The Bug

We tried a mid-stream `state.db` polling bridge in the separate worktree. Manual
testing showed no visible streaming improvement. A DB dump after a tool-heavy
turn showed the rows appeared only near finalization, with effectively the same
timestamps. That means polling cannot recover live reasoning/tool-result order
when the backend does not persist those rows until the turn is done.

Polling may remain useful as a fallback for older backends, but it is not the
primary design.

### Why `/v1/runs` Is Not The Main Target

PR540/PR545 already used the `/v1/runs`/event transport path and still had
reconciliation bugs. It gives more structured events than `/v1/chat/completions`,
but it does not by itself remove the fragile merge architecture if the renderer
still reconciles synthetic rows against DB rows by content/key heuristics.

In this worktree, `/v1/runs` is now guarded behind:

```text
HERMES_DESKTOP_ENABLE_RUNS_TRANSPORT=1
```

Default development should not depend on it.

## Corrected Phased Implementation Plan

### Progress Note: 2026-06-07

Phase B is implemented in the separate worktree:

- `src/main/dashboard.ts` can start/stop/probe a local dashboard backend with a
  per-process `HERMES_DASHBOARD_SESSION_TOKEN`.
- Preload IPC exposes `dashboardStatus`, `startDashboard`, and `stopDashboard`.
- A sandbox smoke test confirmed `/api/status` accepts
  `X-Hermes-Session-Token` and that the dashboard command is available in the
  copied Hermes Agent install.

Phase C is partially implemented behind an explicit renderer flag:

- `src/renderer/src/screens/Chat/dashboardGatewayClient.ts` implements a small
  JSON-RPC WebSocket client and now matches upstream's notification envelope:
  `{"method":"event","params":{type,payload,session_id}}`.
- `src/renderer/src/screens/Chat/dashboardEventAdapter.ts` reduces ordered
  dashboard events into Hermes One's existing `ChatMessage[]` shape.
- `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts` can create
  or resume a dashboard runtime session and submit prompts through
  `prompt.submit`.
- The route is disabled by default and only used when
  `VITE_HERMES_DESKTOP_DASHBOARD_CHAT=1`.

Current limitations before making this the normal sandbox path:

- attachment submission still falls back to the existing HTTP transport;
- approval/clarify/sudo/secret events are not yet surfaced;
- runtime session ID and stored session ID are separated internally, but the
  surrounding Hermes One navigation/history model still needs a fuller stored
  session handoff;
- live manual testing with the flag enabled has not yet been completed.

### Upstream Refresh: 2026-06-09

`NousResearch/hermes-agent` `origin/main` was inspected at commit
`57775e9e1` on 2026-06-09. Upstream has moved enough that several of our
compatibility assumptions should change.

Useful upstream changes:

- Dashboard chat is now always enabled in `hermes_cli/web_server.py` via
  `_DASHBOARD_EMBEDDED_CHAT_ENABLED = True`. The old `embedded_chat` argument
  is gone from current `start_server(...)`.
- The old `hermes dashboard --no-open --tui ...` invocation is accepted for
  compatibility, but upstream Desktop now starts dashboard without `--tui`.
- `tui_gateway.server` exposes a `DESKTOP_BACKEND_CONTRACT` value. Current
  contract `2` means remote non-image file upload via `file.attach` is present.
- Current gateway RPCs include:
  - `session.create`
  - `session.resume`
  - `prompt.submit`
  - `image.attach`
  - `image.attach_bytes`
  - `file.attach`
  - `model.options`
  - `model.save_key`
- Current dashboard REST endpoints include:
  - `GET /api/model/options`
  - `GET /api/model/recommended-default`
  - `GET /api/model/auxiliary`
  - `POST /api/model/set`
- Remote OAuth gateways are first-class upstream:
  - `/api/status` reports `auth_required: true`;
  - REST auth uses cookies;
  - WebSocket auth uses a single-use ticket from `POST /api/auth/ws-ticket`;
  - static `?token=` is still used for legacy token-mode gateways.
- Upstream Desktop probes the actual `/api/ws` WebSocket, not just
  `/api/status`, before saying a remote connection is usable.
- Upstream Desktop syncs attachments before `prompt.submit`:
  - local image path -> `image.attach`;
  - remote image bytes -> `image.attach_bytes`;
  - local file path -> `file.attach`;
  - remote file bytes/data URL -> `file.attach`.
- Upstream Desktop retries `prompt.submit` once after a `session not found`
  error by calling `session.resume` on the durable stored session id, then
  submitting to the fresh live runtime id.
- Upstream event routing now intentionally accepts unscoped foreground turn
  events (`message.*`, `reasoning.*`, `tool.*`) as belonging to the active chat
  and drops only unscoped `subagent.*` events.
- Upstream has direct regression coverage for edge cases close to ours:
  - duplicate user messages in `state.db` on failure/fallback paths;
  - sleep/wake gateway restart recovery;
  - remote gateway file attachments;
  - background-window streaming stalls;
  - focused-chat unscoped event routing.

Immediate Hermes One adjustments from this refresh:

- The compatibility addon must treat `_DASHBOARD_EMBEDDED_CHAT_ENABLED = True`
  as already compatible. It should patch only older engines that still expose
  `embedded_chat: bool = False`.
- Local/SSH dashboard startup can keep passing `--tui` for older engines, but it
  should not depend on source patching after the bundled engine updates to the
  current dashboard shape.
- Remote/SSH model lists and model writes should prefer upstream
  `/api/model/options`, `model.options`, `model.save_key`, and
  `/api/model/set` instead of direct remote `models.json` editing whenever the
  backend supports them.
- Remote/SSH pasted attachments should move from Hermes One staging/fallback
  behavior to the upstream attach RPCs, especially `image.attach_bytes` and
  `file.attach`.
- Remote OAuth should be promoted from "unsupported warning" to the upstream
  cookie + `/api/auth/ws-ticket` flow.
- Connection tests should probe `/api/ws` with the same credential mode the
  renderer will use.
- We should add a Hermes One test matching upstream's submit recovery:
  `prompt.submit` returns `session not found` -> `session.resume` -> retry
  `prompt.submit` against the recovered live id.

Validation performed after this refresh:

- `npm test -- --run tests/hermes-agent-compat.test.ts tests/dashboard-remote.test.ts`
  passed.
- `npm run typecheck` passed.

### Phase A: Freeze The Existing Reconciliation Layer

Goal:

- stop expanding the PR540/545-style reconciliation path;
- keep current app behavior usable while we build the replacement path;
- protect manual testing from accidentally using `/v1/runs`.

Actions:

- keep the separate worktree and sandbox setup;
- use the sandboxed `Hermes One` app identity;
- keep config isolation and port isolation;
- make `/v1/runs` opt-in only;
- leave current DB refresh/reconciliation tests in place as regression coverage;
- document known limitations of the HTTP stream path:
  - no reliable live tool results;
  - no reliable live reasoning for some providers;
  - DB rows can appear only at finalization;
  - content-key reconciliation can misplace local errors and split text.

Acceptance criteria:

- the app builds and tests pass;
- normal chat still works through the existing HTTP path;
- `/v1/runs` is not selected unless explicitly enabled.

### Phase B: Add Dashboard Capability Discovery

Goal:

- detect whether the installed Hermes Agent supports dashboard WebSocket mode;
- do this without replacing the chat path yet.

Main-process additions:

- add a `DashboardConnection` descriptor:

```ts
interface DashboardConnection {
  baseUrl: string
  wsUrl: string
  token: string
  mode: "local" | "remote"
  profile?: string
  processPid?: number
}
```

- add IPC:

```text
dashboard:get-connection
dashboard:start
dashboard:stop-dev-only
dashboard:status
```

- for local mode, start:

```text
hermes dashboard --no-open --host 127.0.0.1 --port <sandbox-safe-port>
```

- pass:

```text
HERMES_DASHBOARD_SESSION_TOKEN=<random-token>
HERMES_HOME=<profile-or-sandbox-home>
```

- for remote/SSH mode, probe:

```text
/api/status
/api/ws ticket/token support
```

Open questions to answer during this phase:

- Does the Hermes One installed Hermes Agent version always ship
  `hermes dashboard`?
- For existing user installs, do we need to update Hermes Agent before the
  dashboard path is available?
- Can remote mode reuse the dashboard WebSocket, or only local mode initially?

Acceptance criteria:

- the app can start/probe dashboard without disturbing the existing gateway;
- dashboard uses sandbox ports in this worktree;
- dashboard logs are separate from the user's normal gateway logs;
- failure falls back to current HTTP chat.

### Phase C: Add A Renderer Gateway Client

Goal:

- establish a live JSON-RPC WebSocket in the renderer, matching Hermes Agent
  desktop's model.

Renderer additions:

- add a small `JsonRpcGatewayClient` or vendor/adapt the shared client if
  dependency layout permits;
- expose a typed event stream:

```ts
type GatewayEvent =
  | { type: "message.start"; session_id?: string; payload?: unknown }
  | { type: "message.delta"; session_id?: string; payload?: { text?: string; rendered?: string } }
  | { type: "reasoning.delta"; session_id?: string; payload?: { text?: string } }
  | { type: "reasoning.available"; session_id?: string; payload?: { text?: string } }
  | { type: "tool.start"; session_id?: string; payload?: GatewayToolPayload }
  | { type: "tool.progress"; session_id?: string; payload?: GatewayToolPayload }
  | { type: "tool.complete"; session_id?: string; payload?: GatewayToolPayload }
  | { type: "message.complete"; session_id?: string; payload?: { text?: string; rendered?: string; reasoning?: string; usage?: unknown } }
  | { type: "error"; session_id?: string; payload?: { message?: string } }
```

- implement request/response calls:

```text
session.create
session.resume
prompt.submit
session.interrupt
session.usage
model.options
```

Acceptance criteria:

- WebSocket reconnects cleanly;
- request timeouts are surfaced as UI errors;
- events are filtered by active runtime session;
- no chat rendering has switched yet.

### Phase D: Introduce An Ordered Turn Timeline

Goal:

- replace row-by-row live appends with a single active-turn state machine.

Do not migrate all rendering to Hermes Agent desktop's `parts[]` in one jump
unless it proves simpler. Hermes One can use an intermediate timeline and then
project to existing `ChatMessage` rows.

Suggested internal model:

```ts
type TimelinePart =
  | { type: "reasoning"; id: string; text: string; pending?: boolean }
  | { type: "text"; id: string; text: string; pending?: boolean }
  | { type: "tool"; id: string; callId: string; name: string; args: string; result?: string; status: "running" | "completed" | "failed" }
  | { type: "error"; id: string; error: string }

interface ActiveTimelineTurn {
  turnId: string
  userMessageId: string
  assistantMessageId: string
  parts: TimelinePart[]
  queuedText: string
  queuedReasoning: string
  interrupted: boolean
}
```

Boundary rules copied from Hermes Agent desktop:

- `message.delta`: append to `queuedText`, flush on animation/timer;
- `reasoning.delta`: append to `queuedReasoning`, flush on animation/timer;
- `tool.start`: flush queued text/reasoning, close reasoning segment, add tool;
- `tool.progress`: update the active tool by stable ID/name;
- `tool.complete`: flush queued text/reasoning, update matching tool with result;
- `message.complete`: flush everything, append final tail only, mark complete;
- `error`: flush partial content if useful, append local error, mark failed.

Projection to existing UI rows:

- reasoning part -> `ReasoningMessage`;
- tool part -> `ToolCallMessage` plus optional `ToolResultMessage`;
- text part -> agent `ChatBubbleMessage`;
- error part -> agent `ChatBubbleMessage` with `error`.

Acceptance criteria:

- pure unit tests prove event order is preserved;
- sequential tools render call/result pairs in event order;
- prose between tools stays between those tools;
- reasoning before/after tools stays in place;
- local errors stay attached to the failed user turn.

### Phase E: Route New Chats Through Dashboard Transport

Goal:

- make dashboard/WebSocket the default for local sandbox chat while preserving
  HTTP fallback.

Submission flow:

1. If no active runtime session:
   - call `session.create`;
   - store runtime session ID and stored session ID separately.
2. Optimistically insert the user message.
3. Call:

```text
prompt.submit { session_id, text }
```

4. Drive the active timeline entirely from WebSocket events.
5. On `message.complete`, optionally hydrate stored session once to align
   final artifacts.

Fallback:

- if dashboard connection fails before submit, use existing HTTP path;
- if dashboard fails mid-turn, render a local error anchored to that turn.

Acceptance criteria:

- "what time is it?" streams visibly;
- bad provider key displays an anchored local error;
- switching to a good provider in the same visible chat does not move/drop the
  failed turn;
- no local error text is sent back to the model as assistant context.

### Phase F: Restore Sessions Through The Same Projection

Goal:

- restored sessions and live sessions use the same visual representation.

Implementation:

- keep `getSessionMessages(sessionId)` as the stored transcript fetch;
- replace ad hoc DB row mapping with a normalizer equivalent to Hermes Agent
  desktop's `toChatMessages()`;
- merge tool-call assistant rows and `role="tool"` rows into one ordered
  assistant turn projection;
- preserve reasoning rows;
- preserve attachments/artifacts;
- preserve local-only errors only during the current app process unless an
  overlay store is explicitly added later.

Acceptance criteria:

- restored session shows:
  - user messages;
  - assistant messages;
  - reasoning/thoughts;
  - tool calls;
  - tool results;
  - errors persisted by Hermes Agent;
  - image/file artifacts and attachments;
- restored session no longer shows duplicated tool-call-only groups after a
  final assistant response.

### Phase G: Retire Whole-Transcript Text-Key Reconciliation

Goal:

- remove the bug-prone class of behavior.

Implementation:

- stop calling `reconcileStreamedWithDb()` for dashboard-driven active turns;
- use final DB hydration as:
  - full replacement when the active turn has completed and no local error is
    pending;
  - stable-ID/turn-ID preservation only for local errors and in-flight UI state;
- keep old reconciliation only for HTTP fallback mode.

Acceptance criteria:

- no content-prefix matching is needed for normal dashboard turns;
- DB hydration cannot move a local failed turn after a later successful turn;
- split assistant text is handled by the stored-session normalizer, not by
  post-hoc duplicate heuristics.

### Phase H: Manual Test Matrix

Run these in the sandboxed Hermes One instance, with the sandbox home and non-conflicting ports:

- simple no-tool prompt with visible streaming;
- invalid API key/provider failure;
- invalid key followed by good provider in the same visible chat;
- DeepSeek reasoning-heavy prompt;
- GPT reasoning-heavy prompt;
- image generation skill with:
  - reasoning before first tool;
  - multiple sequential tool calls;
  - tool results;
  - intermediate assistant prose;
  - final image artifact;
- restored session for each above case;
- app reload while a session is idle;
- app reload after failed provider turn;
- remote/SSH mode fallback.

### Phase I: Optional Persistent Local Error Overlay

Dashboard/Hermes Agent may not persist provider setup failures that happen
before a turn reaches the agent. If we want those local-only errors to survive
app restart, add a desktop-owned overlay store:

```text
<profile-home>/desktop/session-overlays.json
```

Shape:

```ts
interface SessionOverlayEvent {
  sessionId: string
  turnId: string
  afterUserId?: string
  afterUserText: string
  error: string
  createdAt: number
}
```

This should be a later phase because it is product behavior, not required for
live reconciliation correctness.

## Current Status In This Worktree

Already done:

- separate worktree for development;
- sandbox scripts/config/ports;
- sandbox app identity `Hermes One`;
- local error metadata and rendering;
- preliminary local-error preservation tests;
- selected PR545 display pieces for grouped tools/reasoning;
- DB polling experiment, shown not to solve live ordering;
- `/v1/runs` experiment, now opt-in only.

Next recommended phase:

- package the Hermes Agent dashboard compatibility changes as a managed desktop
  addon/overlay, then wire local, remote HTTP, and SSH deployment/checks through
  that same capability probe.

## 2026-06-09 Remaining Work After Dashboard Transport Stabilization

The dashboard/WebSocket path, remote HTTP path, and SSH-over-tunnel path are now
implemented in the sandboxed Hermes One instance and covered by unit/integration tests. Manual live
testing has also exercised:

- normal local and remote dashboard chat;
- bad provider/key failure followed by good-provider recovery;
- repeated failed/non-failed turns in one visible session;
- reasoning-heavy and tool-heavy turns;
- grouped tool calls and restored grouped tool calls;
- prompt-image attachments through dashboard transport;
- restored sessions with local desktop overlay rows;
- remote HTTP sessions and remote HTTP configured-model CRUD;
- SSH dashboard transport over a local tunnel.

The remaining work is now mostly operational hardening, not a change in the
chat-reconciliation architecture.

### 1. Final Regression Gate

Status: implemented as a repeatable gate.

Run the complete regression battery after every change in this final hardening
pass. The canonical manual and automated checklist now lives in:

```text
docs/reconciliation-regression-playbook.md
```

Automated command:

```powershell
npm run typecheck
npm test -- --run tests/remote-sessions.test.ts tests/remote-metadata.test.ts tests/remote-models.test.ts tests/dashboard-chat-transport.test.ts tests/dashboard-event-adapter.test.ts tests/live-tool-events.test.ts tests/live-reasoning-events.test.ts tests/tool-activity-group-title.test.ts tests/reconcile-streamed-with-db.test.ts tests/session-history-mapping.test.ts tests/sessions-history-items.test.ts tests/sessions-decode-content.test.ts src/renderer/src/screens/Chat/mediaUtils.test.ts src/renderer/src/screens/Chat/hooks/useChatIPC.test.tsx tests/chat-messages.test.ts tests/session-continuation-store.test.ts tests/dashboard-remote.test.ts tests/dashboard-launch.test.ts tests/dashboard-gateway-client.test.ts tests/hermes-agent-compat.test.ts tests/run-stream.test.ts src/renderer/src/screens/Sessions/Sessions.test.tsx
```

Current result on 2026-06-11:

- 21 focused test files passed;
- 231 focused tests passed;
- full suite passed: 102 test files, 1158 tests passed, 3 skipped;
- TypeScript node and web typechecks passed.

### 2. Hermes Agent Compatibility Addon/Overlay

Status: first implementation slice complete.

Hermes One currently depends on Hermes Agent dashboard capabilities that may not
be present, or may be present but not enabled correctly, in every installed or
remote Hermes Agent. We should not leave those fixes as manual source edits.

Package them as a desktop-managed compatibility addon/overlay with this shape:

- detect capabilities before patching:
  - `/api/status` reachable;
  - authenticated `/api/ws` accepts a WebSocket upgrade;
  - dashboard HTML advertises embedded chat support;
  - configured-model list/CRUD endpoints are available;
  - session list and session message endpoints are available;
- deploy only the missing compatibility pieces;
- record the applied addon version on the target Hermes Agent home;
- support local Hermes Agent install, remote HTTP target when writable/deployable,
  and SSH target;
- never modify provider credentials, user sessions, skills, memory, or model
  configuration while applying the addon;
- expose a clear Settings/diagnostics result when the target cannot be patched
  automatically.

For the embedded-chat compatibility issue found during live testing, the addon
should avoid depending on a one-off source edit. The target behavior is:

```text
hermes dashboard --no-open --host <host> --port <port> --tui
```

must produce a dashboard where:

```text
GET /api/status      -> authenticated success
GET /api/ws upgrade  -> 101 Switching Protocols
```

If the installed engine does not do that, the addon should either patch/wrap the
dashboard launch behavior or install a small compatibility module that makes the
dashboard default compatible with Hermes One.

Implemented first slice:

- `src/main/hermes-agent-compat.ts` owns a versioned compatibility patch for the
  reproduced embedded-dashboard-chat issue.
- Local Hermes Agent installs are checked before dashboard launch and after
  `hermes update`.
- SSH Hermes Agent targets are checked before dashboard probing/startup and
  after `hermes update` over SSH.
- The patch is intentionally narrow: it changes only the
  `embedded_chat: bool = False` default in `hermes_cli/web_server.py` to
  `True`.
- A diagnostic marker is written to:
  - local: `<HERMES_HOME>/desktop-compat/dashboard-embedded-chat.json`;
  - SSH: `~/.hermes/desktop-compat/dashboard-embedded-chat.json`.
- Plain remote HTTP is still probe-only. Hermes One cannot safely patch it
  without either SSH access or a future Hermes Agent deploy endpoint.

Current tests:

- `tests/hermes-agent-compat.test.ts` covers compatible, patchable, and unknown
  source shapes.
- The dashboard compatibility tests and full chat/session regression battery
  pass after the slice.

### 3. Active Transport Status Indicator

Status: already implemented.

The Settings UI has separate configuration choices for local/remote/SSH
dashboard behavior and reports the actual active path after probing. The probe
now checks the dashboard WebSocket, not only REST status, so a remote target with
healthy REST but disabled embedded chat is reported as unavailable instead of
silently pretending dashboard chat is usable.

Keep this item as a regression check, but no new design work is currently
needed.

### 4. Remote/SSH/Local Test Matrix

Status: agreed, continue as a gate.

Before merging, run the same user-visible cases across every transport that is
expected to work:

- local dashboard auto;
- local dashboard forced;
- local legacy fallback;
- remote HTTP dashboard auto;
- remote HTTP dashboard forced;
- remote HTTP legacy fallback;
- SSH dashboard auto;
- SSH dashboard forced;
- SSH legacy fallback.

For each transport, cover:

- simple no-tool prompt;
- bad provider/key failure;
- bad provider followed by good provider in the same session;
- image prompt attachment;
- tool-heavy image-generation turn where the image path is mentioned in text;
- restored session;
- continue restored session;
- model switch and configured-model list refresh.

Known upstream limitation from this pass:

- Gemini failures in the current lab were traced to Hermes Agent upstream
  behavior, not the Hermes One dashboard transport.

### 5. Reapply Addon After Engine Updates

Status: not yet implemented.

Yes: any Hermes Agent compatibility patch/addon must be rechecked after every
engine update, for both local and remote targets.

The update flow should become:

1. run the normal Hermes Agent update;
2. restart/probe the updated engine;
3. run the compatibility capability probe;
4. if required, reapply the addon/overlay;
5. restart/probe again;
6. surface the final state in Settings and diagnostics.

This applies to:

- Hermes One's bundled/local Hermes Agent install;
- remote HTTP targets when Hermes One is allowed to deploy an addon;
- SSH targets through the tunnel/SSH deployment path.

If the target cannot be modified, Hermes One should keep working in legacy mode
and clearly report why dashboard mode is unavailable.

### 6. Final Review And Upstreaming

Status: pending.

Before this leaves the worktree:

- split the work into reviewable commits/PRs;
- separate Hermes One changes from Hermes Agent compatibility changes;
- document the compatibility contract Hermes One expects from Hermes Agent;
- upstream the Hermes Agent embedded-chat/dashboard fix if possible;
- keep the addon/overlay path until the minimum supported Hermes Agent version
  contains the fix natively.

## Purpose

Hermes One currently merges two views of chat state:

- the renderer's streamed in-memory transcript
- the Hermes Agent `state.db` transcript loaded through `getSessionMessages()`

That merge is valuable because the database contains artifacts that may not arrive
over the OpenAI-compatible stream, especially reasoning rows, tool calls, tool
results, and attachment metadata. But the current whole-session reconciliation is
fragile for local-only failures. A provider/key error can create a local renderer
error bubble that has no DB equivalent; after a later successful turn, the global
DB merge can move that error to the wrong position, drop neighboring lines, or
send the synthetic error text back to the model as prior assistant content.

The implementation goal is to keep the useful DB artifact fill-in behavior while
making local failures explicitly modeled and anchored to their originating turn.

## Design Principle

Use different sources of truth for different phases:

- Cold load / restored session: `state.db` is canonical.
- Active streaming turn: renderer order is canonical.
- Successful turn completion: DB may fill missing persisted artifacts into the
  current visible transcript.
- Failed turn completion: local error state is canonical for that failed turn;
  do not run a global DB reconciliation that can reorder it.

In short:

> DB is canonical for restored sessions. During active chat, streamed UI is
> canonical for ordering; DB only fills missing persisted artifacts for
> successful turns.

## Current Hermes One Code Paths

### Message Shape

File: `src/renderer/src/screens/Chat/types.ts`

Current `ChatBubbleMessage` has:

- `id`
- optional `kind`
- `role: "user" | "agent"`
- `content`
- optional `attachments`

It does not have:

- `error`
- `pending`
- `localOnly`
- `turnId`
- an anchor to the user message that caused an assistant response/error

This means provider errors are represented as normal assistant text, which makes
them indistinguishable from model output during reconciliation and future request
history construction.

### Sending History

File: `src/renderer/src/screens/Chat/hooks/useChatActions.ts`

`sendToAgent()` currently sends:

```ts
messagesRef.current.filter(hasContent).map((m) => ({
  role: m.role,
  content: m.content,
}));
```

Because renderer-only errors are normal `role: "agent"` content bubbles, an error
like `Error: provider returned 401` can become part of the next provider's LLM
context. That is not only noisy; it can change model behavior in later turns.

### Streaming

File: `src/renderer/src/screens/Chat/hooks/useChatIPC.ts`

Current streaming handlers:

- `onChatChunk`: appends assistant text to the latest agent bubble or creates a
  new agent bubble.
- `onChatReasoningChunk`: creates/appends a reasoning row in the active turn,
  before assistant content when needed.
- `onChatToolEvent`: calls `upsertLiveToolEvent()`.
- `onChatDone`: fetches full DB transcript with `getSessionMessages()` and runs
  `reconcileStreamedWithDb(prev, dbMessages)`.
- `onChatError`: appends a new content bubble:

```ts
{
  id: `error-${Date.now()}`,
  role: "agent",
  content: `Error: ${error}`,
}
```

The error bubble has no relationship to the user turn that caused it.

### DB Mapping

File: `src/renderer/src/screens/Chat/sessionHistory.ts`

`dbItemsToChatMessages()` maps DB rows to renderer messages:

- `user` -> user bubble
- `assistant` -> agent bubble
- `reasoning` -> reasoning row
- `tool_call` -> tool call row
- `tool_result` -> tool result row

This is still the right path for cold load and restored sessions.

### Reconciliation

File: `src/renderer/src/screens/Chat/sessionHistory.ts`

`reconcileStreamedWithDb()` does a whole-session merge:

1. Builds a map of streamed rows by reconciliation key.
2. Walks DB rows in canonical DB order.
3. Preserves streamed IDs when DB rows match streamed equivalents.
4. Inserts DB-only rows, especially reasoning/tool rows.
5. Preserves unmatched streamed prefix/suffix rows.
6. Drops some concatenated assistant split artifacts.

This works for successful turns where all unmatched rows are either useful live
artifacts or benign duplicates. It is risky when unmatched rows are local errors,
because local errors may be appended as suffix rows after a later DB transcript.

### Restored Session Flow

File: `src/renderer/src/screens/Layout/Layout.tsx`

`handleResumeSession()` loads DB rows and calls `setMessages(dbItemsToChatMessages(items))`.
This should remain DB-only for now. It restores persisted user/assistant rows,
reasoning, tool calls, tool results, and attachments.

It will not restore purely local errors after app restart unless we add a
desktop-side overlay store or Hermes Agent itself persists failed turns.

## Upstream Hermes Agent Desktop Lessons

Source: `github.com/NousResearch/hermes-agent/apps/desktop`

The upstream desktop app avoids this exact class of bugs mostly by avoiding raw
SQLite reconciliation in the renderer. It is an Electron shell that talks to a
`hermes dashboard` backend over gateway APIs and reuses the embedded TUI path.

The relevant ideas to copy are local transcript invariants, not the full
dashboard architecture.

### Upstream Message Model

File: `apps/desktop/src/lib/chat-messages.ts`

Upstream `ChatMessage` includes:

- `id`
- `role`
- `parts`
- optional `timestamp`
- optional `pending`
- optional `error`
- optional `branchGroupId`
- optional `hidden`
- optional `attachmentRefs`

The important part for Hermes One is `error` as metadata, not as normal assistant
text.

### Upstream Error Handling

File: `apps/desktop/src/app/session/hooks/use-message-stream.ts`

Provider/gateway failures are converted into assistant error state by
`failAssistantMessage()`:

- reuse current stream assistant message if it exists
- otherwise create a local assistant message
- set `error`
- clear `pending`
- clear turn busy state

It does not append a normal assistant text bubble containing `Error: ...`.

Upstream also detects completion-shaped errors with `completionErrorText()`.
Errors such as provider/gateway failure text returned through `message.complete`
are converted to assistant errors.

### Upstream Hydration Guard

File: `apps/desktop/src/app/session/hooks/use-message-stream.ts`

At completion, upstream only hydrates from stored session data when:

- there is no completion error
- there is no inline assistant error
- there is no unresolved user tail
- and the stream did not produce useful assistant payload or final text

Hermes One should copy this invariant: failed turns should not trigger a broad DB
refresh/merge that can erase or reorder the local failure.

### Upstream Error Preservation

File: `apps/desktop/src/lib/chat-messages.ts`

`preserveLocalAssistantErrors(nextMessages, currentMessages)` preserves local
assistant errors when hydration omits failed turns:

- if a hydrated assistant reuses the same ID, carry over local `error`
- if a local assistant error has no hydrated equivalent, preserve it
- preserve the preceding local user when needed
- avoid duplicating the local user when the hydrated transcript already contains
  equivalent tail user content

Hermes One needs an adapted version that understands `content` bubbles rather
than upstream's `parts` model.

## Scope Decision

Do not migrate Hermes One to upstream's `parts[]` model in this fix. That would
touch rendering, transcript copying, history mapping, and live tool rendering all
at once.

Do not migrate Hermes One to the upstream dashboard/gateway architecture in this
fix. That is a larger product direction decision.

Instead:

- keep Hermes One's current `ChatMessage` union
- add minimal metadata to support local errors and anchoring
- wrap or replace the risky whole-session merge at completion boundaries
- preserve the DB-based cold load behavior

## Proposed Data Model Changes

### Extend `ChatBubbleMessage`

File: `src/renderer/src/screens/Chat/types.ts`

Add optional fields:

```ts
export interface ChatBubbleMessage {
  id: string;
  kind?: "user" | "assistant";
  role: "user" | "agent";
  content: string;
  attachments?: Attachment[];

  /**
   * Local or streamed assistant failure metadata. This must not be sent back
   * to the model as assistant content.
   */
  error?: string;

  /**
   * True while an optimistic assistant bubble is active. Useful for replacing
   * the pending row with final text or error state.
   */
  pending?: boolean;

  /**
   * True for renderer-only UI state with no canonical DB row, such as provider
   * setup/key failures.
   */
  localOnly?: boolean;

  /**
   * Renderer-local turn identity. Used only for preserving UI order and local
   * failures during a live session.
   */
  turnId?: string;
}
```

Keep these optional to preserve compatibility with existing tests and DB-loaded
messages.

### Active Turn State

Add a small renderer-local active turn structure:

```ts
interface ActiveTurn {
  turnId: string;
  userId: string;
  startIndex: number;
  status: "running" | "failed" | "completed";
}
```

This can live in `Chat.tsx` as a `useRef<ActiveTurn | null>` and be passed to
`useChatActions()` and `useChatIPC()`.

This does not need to be persisted. It is only for live-turn anchoring.

## New Helper Module

Create a helper module, for example:

`src/renderer/src/screens/Chat/chatMessages.ts`

Recommended helpers:

```ts
export function isBubbleMessage(m: ChatMessage): m is ChatBubbleMessage;
export function isHistoryArtifact(m: ChatMessage): boolean;
export function visibleBubbleText(m: ChatBubbleMessage): string;
export function normalizeMessageText(text: string): string;
export function shouldSendToAgent(m: ChatMessage): m is ChatBubbleMessage;
export function shouldCopyToTranscript(m: ChatMessage): boolean;
export function displayTextForTranscript(m: ChatMessage): string;
export function isAssistantError(m: ChatMessage): m is ChatBubbleMessage;
```

`shouldSendToAgent()` should return false for:

- non-bubble messages
- `localOnly`
- `error`
- hidden/future equivalent if added later
- empty content

It should return true for persisted or streamed user/assistant content bubbles
that are legitimate conversation context.

This helper should replace duplicated bubble checks in:

- `useChatActions.ts`
- `MessageList.tsx`
- `MessageRow.tsx`
- `transcriptUtils.ts`
- `sessionHistory.ts`
- possibly `liveToolEvents.ts`

Do this gradually; the first implementation can update only the paths needed for
the bug fix.

## Error Rendering Plan

### MessageList

File: `src/renderer/src/screens/Chat/MessageList.tsx`

Current filtering hides empty content bubbles:

```ts
return ((m.content as string) || "").trim().length > 0;
```

Change visible filtering so assistant error bubbles render even when content is
empty:

```ts
if (isBubble(m)) {
  return Boolean(m.error) || ((m.content as string) || "").trim().length > 0;
}
```

### MessageRow

File: `src/renderer/src/screens/Chat/MessageRow.tsx`

Add rendering for `msg.error`.

Suggested behavior:

- show a visually distinct error bubble
- display `msg.error`
- do not run normal media token parsing for error text
- do not show approval bar for error rows

Pseudo-flow:

```tsx
if (msg.role === "agent" && msg.error) {
  return (
    <div
      className="chat-bubble chat-bubble-agent chat-bubble-error"
      role="alert"
    >
      {msg.error}
    </div>
  );
}
```

Add CSS only if existing error styles are not enough.

## Sending History Plan

File: `src/renderer/src/screens/Chat/hooks/useChatActions.ts`

Replace:

```ts
messagesRef.current.filter(hasContent).map(...)
```

with:

```ts
messagesRef.current.filter(shouldSendToAgent).map((m) => ({
  role: m.role,
  content: m.content,
}));
```

This ensures local errors do not pollute future prompts.

Important: tool/reasoning rows are already excluded by `hasContent`, so this
should preserve current request-shaping behavior except for excluding local
assistant errors.

## Sending Turn Creation Plan

File: `src/renderer/src/screens/Chat/hooks/useChatActions.ts`

Change `pushUser()` from a void helper to a helper that returns the inserted
message metadata:

```ts
const pushUser = useCallback((content, idPrefix, attachments) => {
  const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userId = `${idPrefix}-${Date.now()}`;

  setMessages((prev) => [
    ...prev,
    {
      id: userId,
      role: "user",
      content,
      turnId,
      ...
    },
  ]);

  return { turnId, userId };
}, ...);
```

Better: avoid two `Date.now()` calls for `turnId` and `userId`; compute once.

In `handleSend()`:

```ts
setIsLoading(true);
const turn = pushUser(text, "user", attachments);
activeTurnRef.current = {
  ...turn,
  startIndex: messagesRef.current.length,
  status: "running",
};
onSessionStarted?.();
await sendToAgent(text, attachments);
```

The exact `startIndex` can be approximate because `setMessages` is async. It is
mostly useful for diagnostics and fallback; the stable `userId` and `turnId` are
more important.

Apply similar turn metadata to:

- `handleQuickAsk()`
- `handleApprove()`
- `handleDeny()`

If `/approve` and `/deny` should not be treated as normal chat turns, document
that and avoid active turn changes there. Current code pushes them as user rows,
so they likely should get turn IDs for consistency.

## Streaming Turn Update Plan

File: `src/renderer/src/screens/Chat/hooks/useChatIPC.ts`

Accept an optional `activeTurnRef` argument:

```ts
activeTurnRef: React.MutableRefObject<ActiveTurn | null>;
```

### `onChatChunk`

Current behavior appends to the latest agent bubble, regardless of turn. That can
remain for the first pass to avoid changing streaming behavior.

Optional improvement:

- when creating a new agent bubble, include `turnId: activeTurnRef.current?.turnId`
- when appending to an existing agent bubble, preserve `turnId`
- if latest agent bubble is an error, do not append content to it; create a new
  assistant bubble instead

This prevents a late chunk from accidentally mutating an error row.

### `onChatReasoningChunk`

Preserve current insertion behavior.

Add `turnId` to newly created reasoning rows only if we later add `turnId` to
history artifacts. Not required for this fix.

### `onChatToolEvent`

Preserve current `upsertLiveToolEvent()` behavior.

Do not change tool rendering or ordering in the first implementation.

### `onChatError`

Replace append-only behavior with an anchored helper:

```ts
setMessages((prev) => markActiveTurnFailed(prev, error, activeTurnRef.current));
```

`markActiveTurnFailed()` should:

1. Normalize message text:
   - raw stored `error` should not include a duplicated `Error: ` prefix unless
     the backend already supplied it.
2. If there is a pending/current assistant bubble for this turn:
   - set `error`
   - set `content: ""` unless there is useful partial content to preserve
   - set `pending: false`
   - set `localOnly: true`
3. Else insert an assistant error bubble immediately after the active user row.
4. If the active user row cannot be found:
   - append the error at the tail as a fallback
5. Set `activeTurnRef.current.status = "failed"`
6. Clear loading/tool progress as today.

Decision point: partial content plus error.

Recommended first behavior:

- if there is partial assistant content and then an error, keep `content` and set
  `error`
- render both in `MessageRow`: content first, then error status
- mark `localOnly: true` only if the assistant message has no DB equivalent

This avoids losing partial streamed output after a late provider failure.

### `onChatDone`

Before fetching DB:

```ts
const activeTurn = activeTurnRef.current;
if (activeTurn?.status === "failed") return;
```

After success:

- set loading false as today
- set active turn status to completed
- fetch DB as today
- call the safer reconciliation wrapper instead of raw `reconcileStreamedWithDb`
- clear `activeTurnRef.current` if it belongs to the completed session/turn

Do not skip DB refresh for successful turns yet; DB refresh is still needed to
fill reasoning/tool rows that may only exist in `state.db`.

## Reconciliation Plan

Do not delete `reconcileStreamedWithDb()` immediately. It already handles useful
cases:

- DB-only reasoning insertion
- future streamed reasoning ID preservation
- DB-only tool call/result insertion
- duplicate streamed content FIFO matching
- assistant split artifact removal
- DB attachments copied into streamed bubbles

Instead add a wrapper around it, likely in `sessionHistory.ts`:

```ts
export function reconcileAfterDbRefresh(
  current: ReadonlyArray<ChatMessage>,
  db: ReadonlyArray<ChatMessage>,
  options?: {
    activeTurn?: ActiveTurn | null;
  },
): ChatMessage[] {
  if (options?.activeTurn?.status === "failed") return [...current];

  const syncableCurrent = current.filter(isSyncableWithDb);
  const localOnly = current.filter(isLocalOnlyPreserved);

  const reconciled = reconcileStreamedWithDb(syncableCurrent, db);
  return preserveLocalAssistantErrors(reconciled, current);
}
```

### `isSyncableWithDb()`

Should return false for:

- assistant bubbles with `error`
- `localOnly`

Should return true for:

- user/assistant content bubbles without local error state
- reasoning/tool rows

Reasoning/tool rows may be local live artifacts and should continue to be
matched/deduped against DB where possible.

### `preserveLocalAssistantErrors()`

Adapt upstream's helper to Hermes One.

Input:

- `nextMessages`: DB-reconciled messages
- `currentMessages`: local current transcript

Algorithm:

1. Build `existingIds` from `nextMessages`.
2. Build a normalized tail-user matcher from `nextMessages`.
3. Find all local assistant error bubbles:
   - `role === "agent"`
   - `error` present
   - not hidden if hidden is later added
4. For each local error:
   - if `nextMessages` already contains same ID, merge `error` into that row
   - otherwise find nearest preceding visible user in `currentMessages`
   - find matching user in `nextMessages` by:
     - same `id`, if available
     - same `turnId`, if available
     - normalized content plus attachment refs/content
   - insert the error immediately after the matched user and any local/DB rows
     that belong before assistant response for that turn
   - if no matched DB user exists, preserve the local user+error pair together
5. Preserve order among multiple local failed turns.
6. Do not append all failures blindly to the end.

The hardest detail is where to insert error relative to DB rows that follow the
matched user. Recommended first pass:

- insert immediately after the matched user if the DB does not contain an
  assistant response before the next user
- if DB already has an assistant response for that same user, do not preserve the
  error unless it has the same ID as that assistant row

That avoids creating impossible turns like:

```text
user A
assistant success A
assistant error A
```

For the bad-key-then-good-provider case, DB likely contains:

```text
user good
assistant good
```

while current contains:

```text
user bad
assistant error bad
user good
assistant good
```

The result should be:

```text
user bad
assistant error bad
user good
assistant good
```

### Split Artifact Logic

Keep `buildDbAssistantSplitSequences()` and `isCoveredByDbBubbleSplit()` for now.
These fix a separate class of duplicated assistant text around tool calls.

But do not allow split-artifact logic to drop local error rows:

- local errors should be filtered out before split artifact checks
- error rows should have `reconciliationKey() === null`

### Reconciliation Key Changes

Update `reconciliationKey()`:

- if bubble has `error` or `localOnly`, return `null`
- otherwise keep current role/content matching

This prevents local errors from matching real assistant text.

## Completion Error Text Plan

Upstream detects provider/gateway errors that arrive as final assistant text.
Hermes One currently can surface errors through `onError`, but failures may also
arrive as normal completion content depending on API behavior.

Add a helper similar to upstream:

```ts
const COMPLETION_ERROR_PATTERNS = [
  /^API call failed after \d+ retries:/i,
  /^HTTP\s+\d{3}\b/i,
  /^(Provider|Gateway)\s+error:/i,
  /missing .*api.*key/i,
  /api key.*missing/i,
  /unauthorized|forbidden|invalid api key/i,
];
```

Use cautiously. False positives could turn legitimate assistant text into error
UI. Recommended phase:

- do not use this in the first patch unless there is a known repro where Hermes
  One receives provider errors as `chat-done` content
- add tests before enabling

## Restored Session Behavior

The proposed changes preserve restored session artifacts that are persisted in
`state.db`.

Cold restored sessions still flow through:

```text
getSessionMessages(sessionId)
  -> expandRowsToHistory()
  -> dbItemsToChatMessages()
  -> setMessages()
```

This restores:

- user messages
- assistant messages
- reasoning/thought rows
- tool call rows
- tool result rows
- DB-backed attachments

It does not restore local provider errors after app restart if Hermes Agent never
wrote them to `state.db`. That is already true today.

If restart-persistent local errors are required, add a separate phase:

### Optional Later Phase: Desktop Session Overlay

Persist local-only events to a desktop-owned overlay file, e.g.

```text
profileHome(activeProfile)/desktop/session-overlays.json
```

Shape:

```ts
interface SessionOverlay {
  sessionId: string;
  localEvents: Array<{
    id: string;
    turnId: string;
    afterUserContent: string;
    afterUserAttachments?: string[];
    role: "agent";
    error: string;
    createdAt: number;
  }>;
}
```

On restored session load:

- load DB transcript
- overlay local error events by matching the nearest user
- prune overlays when a session is deleted

Do not implement this in the first stabilization patch unless the product
requires failed provider rows to survive app restart.

## Streaming Behavior Expectations

Current streaming should remain mostly unchanged.

Preserved:

- assistant text still streams through `chat-chunk`
- reasoning still streams through `chat-reasoning-chunk`
- live tools still stream through `chat-tool-event`
- successful completion still fetches DB rows to fill missing artifacts
- session ID handling remains unchanged

Changed:

- failures become error metadata, not normal assistant content
- failed turns skip broad DB reconciliation
- local errors render even with empty content
- local errors are excluded from future LLM request history

Potential behavior improvement:

- partial output followed by error can be displayed as partial content plus
  error status, instead of losing one or the other

## Test Plan

### Unit Tests: Message Helpers

New or existing test file:

`tests/chat-message-helpers.test.ts`

Cases:

- `shouldSendToAgent()` includes normal user/assistant content.
- `shouldSendToAgent()` excludes local assistant error.
- `shouldSendToAgent()` excludes empty pending assistant.
- `shouldSendToAgent()` excludes reasoning/tool rows.
- transcript copying includes a readable error line if desired.

### Unit Tests: Error Preservation

New or existing file:

`tests/reconcile-streamed-with-db.test.ts`

Add cases:

1. Local failed turn before later successful DB turn:

```text
current: user bad, assistant error bad, user good, assistant good streamed
db:      user good, assistant good
expect:  user bad, assistant error bad, user good, assistant good
```

2. Local failed turn where DB has the user but no assistant:

```text
current: user bad, assistant error bad
db:      user bad
expect:  user bad, assistant error bad
```

3. Repeated prompt text:

```text
current: user "hi", error, user "hi", assistant "ok"
db:      user "hi", assistant "ok"
expect:  do not attach error after successful "hi"
```

This may require `turnId` or positional heuristics to pass robustly.

4. Existing DB artifacts still insert:

```text
current: user, assistant content
db:      user, reasoning, tool_call, tool_result, assistant content
expect:  reasoning/tools present, streamed IDs preserved
```

5. Local error is not dropped by split artifact logic.

6. Local error is not appended at the tail after unrelated later DB rows.

### Unit Tests: IPC/Error Flow

If the current test harness supports renderer hooks, add tests around
`useChatIPC()`:

- `onChatError` marks current active turn failed and inserts error after user.
- `onChatDone` skips DB reconciliation if active turn failed.
- `onChatDone` still reconciles if active turn succeeded.

If hook tests are expensive, keep this behavior in pure helper functions and
unit-test those helpers directly.

### Existing Tests To Keep Passing

Run:

```bash
npm test -- reconcile-streamed-with-db
npm test -- transcriptUtils
npm test -- session-history
npm test -- sessions-history-items
```

Then broader:

```bash
npm test
```

Adjust exact commands to the repo's configured Vitest filters.

## Manual QA Plan

### Scenario 1: Bad Provider Key Then Good Provider

1. Configure a provider with an invalid/missing key.
2. Send `hello with bad provider`.
3. Confirm visible transcript:
   - user prompt
   - assistant error directly after that prompt
4. Switch to a working provider in the same session.
5. Send `hello with good provider`.
6. Confirm visible transcript order:
   - bad user
   - bad assistant error
   - good user
   - good assistant response
7. Confirm the bad error did not move after the good response.
8. Confirm request history for the good provider did not include the bad
   provider error as assistant text.

### Scenario 2: Reasoning/Tool Successful Turn

1. Use a model/tool path that produces reasoning and tool calls.
2. Confirm live streaming still works.
3. Confirm DB refresh still inserts missing reasoning/tool results after done.
4. Confirm no duplicate assistant split text appears.

### Scenario 3: Partial Output Then Error

1. Force a stream that emits some text and then fails.
2. Confirm partial content remains visible if useful.
3. Confirm error status is visible and anchored.
4. Confirm next successful turn does not reorder the failed turn.

### Scenario 4: Restored Session

1. Open an existing persisted session.
2. Confirm user/assistant rows restore.
3. Confirm reasoning rows restore.
4. Confirm tool calls/results restore.
5. Confirm attachments restore.
6. Confirm local-only errors from before app restart are not expected unless the
   optional overlay phase is implemented.

## Phased Implementation Plan

This should be implemented in phases. The failure touches message typing,
streaming, rendering, request-history construction, and DB reconciliation. Doing
everything in one patch would make regressions hard to isolate.

Each phase should leave the app buildable and should preserve current streaming
behavior unless the phase explicitly changes it.

### Phase 0: Baseline Audit And Repro Tests

Goal:

- Capture the current bug as failing tests before changing behavior.
- Confirm the implementation agent understands the current boundaries.

Files to inspect:

- `src/renderer/src/screens/Chat/types.ts`
- `src/renderer/src/screens/Chat/hooks/useChatActions.ts`
- `src/renderer/src/screens/Chat/hooks/useChatIPC.ts`
- `src/renderer/src/screens/Chat/sessionHistory.ts`
- `src/renderer/src/screens/Chat/MessageList.tsx`
- `src/renderer/src/screens/Chat/MessageRow.tsx`
- `tests/reconcile-streamed-with-db.test.ts`

Implementation work:

- Add tests for the known bad-key-then-good-provider ordering bug.
- Add tests proving local error text is currently preserved but lands in the
  wrong place, if that is the existing behavior.
- Add tests showing existing successful DB artifact insertion still works:
  reasoning, tool calls, tool results, and split assistant dedupe.

Recommended test cases:

```text
current: user bad, assistant local error, user good, assistant good streamed
db:      user good, assistant good
expect:  user bad, assistant local error, user good, assistant good
```

```text
current: user bad, assistant local error
db:      user bad
expect:  user bad, assistant local error
```

```text
current: user "hi", assistant local error, user "hi", assistant good
db:      user "hi", assistant good
expect:  error remains attached to first "hi", not the later successful "hi"
```

Acceptance criteria:

- At least one new test fails on the current implementation and describes the
  real reported bug.
- Existing reconciliation tests still pass before behavior changes, except for
  any newly added bug repro tests.

Stop/rollback guidance:

- If the bug cannot be reproduced in a pure function, do not proceed directly to
  UI changes. First extract the currently implicit merge behavior into a helper
  that can be tested.

### Phase 1: Add Message Metadata Without Behavior Changes

Goal:

- Make the type system capable of representing local errors as metadata.
- Avoid changing runtime behavior yet.

Primary files:

- `src/renderer/src/screens/Chat/types.ts`

Implementation work:

- Add optional fields to `ChatBubbleMessage`:
  - `error?: string`
  - `pending?: boolean`
  - `localOnly?: boolean`
  - `turnId?: string`
- Keep all fields optional.
- Do not change `onChatError` yet.
- Do not change reconciliation yet.

Acceptance criteria:

- TypeScript still compiles.
- No renderer behavior changes.
- Existing tests pass.

Stop/rollback guidance:

- If adding these fields creates type noise in many places, keep them limited to
  `ChatBubbleMessage`; do not add metadata to reasoning/tool rows in this phase.

### Phase 2: Centralize Chat Message Helpers

Goal:

- Stop spreading ad hoc checks like `"content" in m` and `!kind` across critical
  paths before changing error semantics.

Primary files:

- new `src/renderer/src/screens/Chat/chatMessages.ts`
- `src/renderer/src/screens/Chat/hooks/useChatActions.ts`
- `src/renderer/src/screens/Chat/MessageList.tsx`
- `src/renderer/src/screens/Chat/transcriptUtils.ts`

Implementation work:

- Add helper functions:
  - `isBubbleMessage()`
  - `isAssistantError()`
  - `normalizeMessageText()`
  - `visibleBubbleText()`
  - `shouldSendToAgent()`
  - `shouldCopyToTranscript()`
  - `displayTextForTranscript()`
- Initially wire only low-risk paths, or use the helpers in tests first.
- `shouldSendToAgent()` must exclude:
  - assistant errors
  - `localOnly` messages
  - empty bubbles
  - reasoning/tool rows

Tests:

- Add unit tests for helper behavior.
- Include a local assistant error and prove it is not sendable.

Acceptance criteria:

- No visible UI changes yet.
- Request-history filtering can be changed in a later phase by swapping to the
  helper.

Stop/rollback guidance:

- If helper adoption becomes too broad, only adopt `shouldSendToAgent()` in
  `useChatActions.ts` and leave display helpers for later.

### Phase 3: Exclude Local Errors From Future LLM History

Goal:

- Fix the context pollution issue independently from UI ordering.

Primary file:

- `src/renderer/src/screens/Chat/hooks/useChatActions.ts`

Implementation work:

- Replace the current history construction:

```ts
messagesRef.current.filter(hasContent).map(...)
```

with:

```ts
messagesRef.current.filter(shouldSendToAgent).map(...)
```

- Keep the outgoing shape unchanged:

```ts
{
  role: m.role,
  content: m.content,
}
```

Tests:

- Unit-test `shouldSendToAgent()`.
- If practical, add a hook-level test that verifies a local assistant error is
  not included in `window.hermesAPI.sendMessage()` history.

Acceptance criteria:

- Normal user/assistant content is still sent.
- Reasoning/tool rows are still excluded.
- Local assistant errors are excluded.

Stop/rollback guidance:

- If hook-level testing is expensive, keep this phase covered by helper tests and
  one focused manual check.

### Phase 4: Track Active Turns

Goal:

- Give local errors an anchor so they can be inserted near the user prompt that
  caused them.

Primary files:

- `src/renderer/src/screens/Chat/Chat.tsx`
- `src/renderer/src/screens/Chat/hooks/useChatActions.ts`
- `src/renderer/src/screens/Chat/hooks/useChatIPC.ts`

Implementation work:

- Add `activeTurnRef` in `Chat.tsx`:

```ts
const activeTurnRef = useRef<ActiveTurn | null>(null);
```

- Define `ActiveTurn` near chat types or in a local hook module:

```ts
interface ActiveTurn {
  turnId: string;
  userId: string;
  startIndex: number;
  status: "running" | "failed" | "completed";
}
```

- Pass `activeTurnRef` into `useChatActions()` and `useChatIPC()`.
- Change `pushUser()` to create and return stable `{ turnId, userId }`.
- Set `activeTurnRef.current` immediately before sending to the agent.
- Add `turnId` to the optimistic user bubble.

Important constraints:

- Do not change streaming chunk behavior in this phase.
- Do not change error rendering in this phase.

Tests:

- If helpers are extracted, test `createTurnIds()` or equivalent.
- Otherwise rely on Phase 5 behavior tests.

Acceptance criteria:

- Sending messages still works.
- Queued messages still drain.
- `/approve`, `/deny`, and `/btw` behavior is unchanged except for optional
  `turnId` metadata.

Stop/rollback guidance:

- If passing `activeTurnRef` through hooks creates too much churn, put turn state
  in a small `useActiveChatTurn()` hook and pass only the needed callbacks.

### Phase 5: Render Error Metadata

Goal:

- Make the UI capable of showing assistant error metadata before switching
  `onChatError` to produce it.

Primary files:

- `src/renderer/src/screens/Chat/MessageList.tsx`
- `src/renderer/src/screens/Chat/MessageRow.tsx`
- possibly chat CSS files

Implementation work:

- Update `MessageList` filtering so empty-content error bubbles remain visible.
- Update `MessageRow` so `msg.error` renders as an error state.
- Ensure approval detection does not run on error rows.
- Ensure media parsing does not treat error text as normal assistant markdown
  unless intentionally desired.

Tests:

- Add render test if existing setup makes it easy.
- Otherwise unit-test visibility helper if `MessageList` filtering is extracted.

Acceptance criteria:

- A message with `{ role: "agent", content: "", error: "OpenRouter 403" }`
  renders visibly.
- Empty non-error assistant placeholders remain hidden.

Stop/rollback guidance:

- If styling becomes contentious, render error text inside the existing agent
  bubble first, with a class hook for later visual polish.

### Phase 6: Replace Loose Error Append With Anchored Error Metadata

Goal:

- Fix the local error model.

Primary file:

- `src/renderer/src/screens/Chat/hooks/useChatIPC.ts`

Supporting helper:

- `markActiveTurnFailed(messages, error, activeTurn)`

Implementation work:

- Replace `onChatError` append-only behavior with `markActiveTurnFailed()`.
- The helper should:
  - find the active user row by `activeTurn.userId` or `turnId`
  - find an existing assistant bubble in the active turn if present
  - preserve partial content if present
  - set `error`
  - set `pending: false`
  - set `localOnly: true` when there is no DB equivalent
  - insert the error immediately after the active user if no assistant row exists
  - append as fallback only when no anchor can be found
- Set `activeTurnRef.current.status = "failed"`.
- Preserve existing `setToolProgress(null)` and `setIsLoading(false)`.

Tests:

- Pure helper tests for:
  - no assistant yet -> insert after active user
  - partial assistant exists -> mark partial assistant as errored
  - active user missing -> append fallback
  - repeated user text -> use ID/turnId rather than text

Acceptance criteria:

- Provider error appears directly after the prompt that caused it.
- Error is not represented as normal `content: "Error: ..."` assistant text.

Stop/rollback guidance:

- If preserving partial content complicates rendering, first support empty-content
  error rows. Add partial-content preservation in a follow-up.

### Phase 7: Add Safe DB Refresh Wrapper

Goal:

- Keep DB artifact fill-in for successful turns while protecting local-only
  errors from global reordering.

Primary file:

- `src/renderer/src/screens/Chat/sessionHistory.ts`

Implementation work:

- Add `reconcileAfterDbRefresh(current, db, options)`.
- Keep `reconcileStreamedWithDb()` intact initially.
- The wrapper should:
  - return current unchanged if `activeTurn.status === "failed"`
  - remove local-only/error bubbles from the DB-syncable input
  - run `reconcileStreamedWithDb(syncableCurrent, db)`
  - call `preserveLocalAssistantErrors(reconciled, current)`
- Update `reconciliationKey()` so local error bubbles return `null`.

Tests:

- Existing reconciliation tests must still pass.
- New failed-turn tests must pass.
- DB-only reasoning/tool insertion tests must still pass.

Acceptance criteria:

- Successful turns still get DB-only reasoning/tool rows.
- Failed local errors do not move to the tail after later successful DB refresh.

Stop/rollback guidance:

- If the wrapper reveals too many edge cases, keep raw
  `reconcileStreamedWithDb()` as an escape hatch and gate the wrapper only around
  transcripts that contain local errors.

### Phase 8: Wire Safe Reconciliation Into `onChatDone`

Goal:

- Change the runtime completion path after the pure reconciliation behavior is
  tested.

Primary file:

- `src/renderer/src/screens/Chat/hooks/useChatIPC.ts`

Implementation work:

- In `onChatDone`:
  - set session ID as today
  - clear loading/tool progress as today
  - if active turn is failed, skip DB fetch/reconciliation
  - otherwise fetch DB messages
  - call `reconcileAfterDbRefresh(prev, dbMessages, { activeTurn })`
  - mark active turn completed/clear it

Tests:

- Hook-level tests if feasible.
- Otherwise rely on pure helper tests and manual QA.

Acceptance criteria:

- Successful turns still refresh artifacts.
- Failed turns do not trigger a DB merge that can reorder local errors.

Stop/rollback guidance:

- If skipping DB fetch on failed turn hides something important, change the guard
  to fetch DB but run only `preserveLocalAssistantErrors()` without full
  reconciliation.

### Phase 9: Restored Session Verification

Goal:

- Confirm cold/restored sessions are not regressed.

Primary files:

- `src/renderer/src/screens/Layout/Layout.tsx`
- `src/renderer/src/screens/Chat/sessionHistory.ts`
- `src/main/sessions.ts`
- `src/main/ssh-remote.ts`

Implementation work:

- Prefer no code changes in this phase.
- Verify `handleResumeSession()` still uses pure DB:

```ts
setMessages(dbItemsToChatMessages(items));
```

Tests:

- `session-history-mapping`
- `sessions-history-items`
- any SSH session history tests if present

Acceptance criteria:

- Persisted reasoning rows restore.
- Persisted tool calls restore.
- Persisted tool results restore.
- Persisted prompt image attachments restore.
- Local-only provider errors are not expected to survive restart unless the
  optional overlay phase is later implemented.

Stop/rollback guidance:

- If users require restart-persistent error rows, do not overload
  `state.db` reconciliation. Add the optional desktop overlay phase separately.

### Phase 10: Manual QA Gate

Goal:

- Exercise real IPC/streaming behavior that unit tests may not cover.

Manual scenarios:

- Bad provider key, then good provider in same session.
- Missing key error, then same prompt after switching provider.
- Successful reasoning-heavy model response.
- Successful tool-heavy response.
- Partial stream followed by failure.
- Resume existing session with reasoning/tools/attachments.
- Queue messages while one turn is loading.
- Abort a turn.
- `/approve` and `/deny` if approval flow is active.

Acceptance criteria:

- No error rows jump to the bottom after a later success.
- No missing user/assistant lines.
- No duplicate split assistant artifacts.
- Reasoning/tool rows still appear.
- Local error text is not included in subsequent model context.
- Restored sessions still show persisted artifacts.

Stop/rollback guidance:

- If normal streaming regresses, first revert only Phase 8 wiring and keep the
  type/helper/test work. That should restore current runtime behavior while
  preserving most preparatory work.

## Optional Later Phase: Persistent Local Error Overlay

This is not required for the first stabilization fix.

Goal:

- Preserve local-only provider errors across app restart, even when Hermes Agent
  never wrote a failed turn to `state.db`.

Possible storage:

```text
profileHome(activeProfile)/desktop/session-overlays.json
```

Possible event shape:

```ts
interface LocalErrorOverlayEvent {
  id: string;
  sessionId: string;
  turnId: string;
  afterUserContent: string;
  afterUserAttachmentIds?: string[];
  error: string;
  createdAt: number;
}
```

Implementation notes:

- Write overlay event when a local provider error is created.
- On restored session load, load DB transcript first.
- Overlay local errors by matching the nearest user row.
- Prune overlay events when sessions are deleted.
- Keep this separate from DB reconciliation so synthetic desktop UI state does
  not pretend to be canonical Hermes Agent history.

## Risks and Mitigations

### Risk: Error Rows Disappear Because Empty Bubbles Are Filtered

Mitigation:

- Update `MessageList` visibility filter before changing `onChatError`.
- Add test for empty-content error rendering.

### Risk: Local Error Is Sent Back To Model

Mitigation:

- Centralize request-history filtering in `shouldSendToAgent()`.
- Unit-test it.

### Risk: Successful Reasoning/Tool Artifacts Stop Appearing

Mitigation:

- Keep `reconcileStreamedWithDb()` for successful turns.
- Add regression test with DB-only reasoning/tool rows.

### Risk: Duplicate User Rows With Same Text

Mitigation:

- Prefer `id` and `turnId` over text matching when possible.
- Use text matching only as fallback.
- Add repeated-prompt tests.

### Risk: Partial Assistant Output Followed By Error Gets Lost

Mitigation:

- Preserve partial `content` when marking a pending assistant as errored.
- Render content plus error status.

### Risk: Too Many Files Change At Once

Mitigation:

- Implement in phases.
- Keep upstream `parts[]` model out of scope.
- Keep restored-session DB mapping unchanged.

## Success Criteria

The implementation is successful when:

- A provider/key failure creates an anchored assistant error, not a loose text
  bubble.
- A later successful turn in the same session does not move, drop, or duplicate
  the failed turn.
- Local error text is not sent as assistant history to the next model/provider.
- Successful turns still receive DB-only reasoning, tool calls, tool results,
  and attachment metadata.
- Restored sessions still load all persisted DB artifacts.
- Existing split-assistant/tool-call deduplication behavior remains intact.
- The fix is covered by unit tests that reproduce the bad-provider-then-good-
  provider case.
