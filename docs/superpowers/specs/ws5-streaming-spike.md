# WS5 spike — can we retire the `state.db` post-stream merge?

**Status:** findings + recommendation only (no code). Part of the
"adopt-worthwhile-Hermes-Desktop-ideas" work. Companion to WS2–WS4 (shipped).

## The problem this investigates

Desktop chat streams over the gateway's OpenAI-compatible endpoint
`POST /v1/chat/completions` (see `src/main/hermes.ts` `sendMessageViaApi`). That
endpoint streams **assistant text deltas only** — it does _not_ stream the
agent's reasoning or its tool-call / tool-result rows. To show those, the
renderer does a **post-stream reconciliation**: on `onChatDone`, `useChatIPC.ts`
reloads the turn from the gateway's `state.db` via `getSessionMessages()` and
merges in the `reasoning` / `tool_call` / `tool_result` rows.

Costs of that design:

- Reasoning + tool activity appear only **after** the turn finishes, not live.
- A whole reconciliation path (and the `X-Hermes-Session-Id` correlation it
  depends on — note the `desk-…` id workaround in `hermes.ts` for the gateway's
  fingerprint-collision bug, upstream #7484) exists purely to paper over the
  streaming gap.
- The WS2 preview pane only updates when the screenshot tool-result lands in the
  merged history — i.e. after the stream, not while the agent browses.

## What the gateway actually offers

Confirmed against `gateway/platforms/api_server.py` (upstream `main`):

| Endpoint                                  | Streams                                                                                             | Tool events                                                           | Reasoning                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| `POST /v1/chat/completions` (what we use) | text deltas                                                                                         | only `hermes.tool.progress` (name/emoji/status — **no args/results**) | ✗                                        |
| `POST /api/sessions/{id}/chat/stream`     | **granular SSE**                                                                                    | `tool.started` (name, args), `tool.completed`, `tool.failed`          | `tool.progress` w/ `reasoning.available` |
| `GET /v1/runs/{id}/events`                | "SSE stream of structured lifecycle events" (handler truncated in source view — needs confirmation) | likely                                                                | likely                                   |

The session `chat/stream` event vocabulary (verified): `run.started`,
`message.started`, `assistant.delta` (`message_id` + `delta`), `tool.started`,
`tool.completed`, `tool.failed`, `tool.progress`, `assistant.completed`,
`run.completed`, `error`, `done`.

**Conclusion:** the gateway already emits first-class reasoning + tool lifecycle
events live on `/api/sessions/{id}/chat/stream`. The data we reconstruct from
`state.db` is available _as a stream_. The official desktop app sidesteps our
merge entirely because it consumes the gateway/dashboard surface rather than the
OpenAI-compat one.

## Recommendation

**Migrate desktop chat from `/v1/chat/completions` to
`/api/sessions/{id}/chat/stream`, and retire the `state.db` post-stream merge.**
Worth doing — but it's a real migration, not a patch. Stage it:

1. **Spike (½–1 day):** point a throwaway client at `/api/sessions/{id}/chat/stream`
   and capture a real event transcript for a turn that browses (screenshot) and
   reasons. **Confirm the open question:** does `tool.completed` carry the full
   result body **and image attachments**? If yes, WS2's preview pane upgrades to
   _live_ updates for free. If not, we still need a result fetch for attachments.
2. **Map events → our `ChatMessage` union** (`screens/Chat/types.ts`):
   `assistant.delta`→bubble append, `tool.started`→`ToolCallMessage`,
   `tool.completed`→`ToolResultMessage`, `tool.progress`(reasoning)→
   `ReasoningMessage`. Correlate by `message_id` instead of the `desk-…`
   session-id workaround.
3. **Swap the transport** in `hermes.ts` behind the existing IPC so the renderer
   barely changes; delete the `onChatDone` → `getSessionMessages` merge once the
   live path is at parity.
4. **Keep `state.db` reads for history load** (resuming a past session) — only
   the _live-turn_ merge goes away.

### Risks / why it's staged, not a quick win

- Session lifecycle differs (create/fork/delete under `/api/sessions`) — more
  surface than the stateless completions call.
- Auth + the body-framing / `Content-Length` carefulness in `hermes.ts`
  (#405 chunked-encoding note) must be re-verified on the new path.
- The OpenAI-compat path is also what remote/SSH and third-party gateways speak;
  confirm `/api/sessions/*` exists on the versions we target before hard cutover,
  or feature-detect via `/v1/capabilities`.
- Golden parity: a turn rendered via the new stream must match the current
  merged rendering before we delete the merge.

### Effort / payoff

- **Payoff:** live reasoning + tool activity, live preview-pane updates, deletion
  of a fragile reconciliation path and its session-id workaround.
- **Effort:** ~3–5 days (transport swap + event mapping + parity tests +
  capability feature-detect). Net **negative** line count once the merge goes.

**Verdict:** highest-leverage _architectural_ follow-up from the whole exercise.
Recommend scheduling the 1-day spike (step 1) next; gate the full migration on
its transcript confirming `tool.completed` carries results + attachments.
