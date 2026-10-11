# Model context window

A model id can carry an optional manual context-window override (tokens), for providers that don't advertise `context_length` over `/models` — without it the desktop can't size the context gauge or the agent's auto-compaction.

The override is a **shared model definition** keyed by model id, so it is entered once and reused across every provider serving that id.

The same value fixes two symptoms at once: the context gauge showing a wrong heuristic size (e.g. 32k for a 64k model), and the agent never auto-compacting. hermes-agent auto-compacts at `context_length × compression.threshold` (default 0.50, enabled by default), so a correct `context_length` re-enables compaction without any extra UI.

## Storage and propagation

The override lives once per model id in `model-definitions.json` (a [[src/main/models.ts#ModelDefinition]] keyed by `model`), not per attachment row.

`models.json` rows are pure provider attachments; [[src/main/models.ts#readModels]] merges the matching definition's `contextLength` (and display `name`/capabilities) onto every row at read time, so `resolveLibraryModelEntry` and the pickers still see a flat `contextLength`. Writers use [[src/main/models.ts#readModelsRaw]] so merged fields are never persisted back onto a row. Legacy per-row `contextLength` is hoisted into definitions once by [[src/main/models.ts#ensureModelDefinitionsMigrated]] (larger window wins on conflict), run from `listModels()`.

The value is entered via the per-model-chip **pencil** editor in [[src/renderer/src/components/ProviderKeysSection.tsx#ProviderModelsManager]] (writing `setModelDefinition`), or captured from the registry on pick. On activation, [[src/main/config.ts#setModelConfig]] writes or clears `config.yaml`'s `model.context_length` from the (merged) library entry — the single value both the gauge and the agent read; an absent override clears any stale value left by a previously-active model. Definitions are local-only, so Remote/SSH activation does not propagate them. Instead, the desktop reads the active remote profile's own `model.context_length`: [[src/main/ssh-remote.ts#sshGetModelConfig]] reads it directly for legacy SSH, while the dashboard compatibility endpoint scopes its library path and config load to the requested `?profile=` before exposing the active model row for SSH Dashboard and Remote connections.

## Gauge resolution order

The context gauge resolves its window size as: connection-owned config override (active model) → provider `/models` `context_length` → static heuristic.

For local connections, [[src/main/model-discovery.ts#getModelContextWindow]] consults [[src/main/config.ts#getModelContextLengthOverride]]. For SSH and Remote connections, the IPC route reads the active model config from that connection and [[src/main/model-context.ts#resolveActiveModelContextWindow]] applies its override only when the requested model still matches, so a delayed response cannot leak the previous model's context window. Missing or invalid overrides fall through to the existing `/models` lookup and finally the renderer heuristic. DeepSeek V4 identifiers have a 1M static fallback; older DeepSeek aliases retain their 128K fallback.

## Dashboard default profile isolation

An explicit `default` query reads both the root model library and root config, even when the Dashboard process runs from a named profile. Omitted or `current` queries retain that process's profile.

The compatibility handler uses upstream's context-local Hermes home override for every explicit profile, including `default`, and resets it after successful or failed config reads. [[tests/hermes-agent-compat-profiles.test.ts]] executes the injected handlers with separate root and named-profile files to verify matching library/config scope, endpoint-aware writes, and recovery after a read failure.

## Occupancy estimate when the provider omits usage

The gauge's numerator resolves as: exact payload counts (`context_used`, else prompt tokens) → a chars/4 transcript estimate → the previous turn's value. Without the estimate the gauge went blank on providers that return no usage at all (#789).

The gauge only renders when `contextTokens` is set (see `contextUsage` in [[src/renderer/src/screens/Chat/Chat.tsx]]), so on `message.complete` the transport fills it in even when `usageFromPayload` returns null. [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#estimateContextTokens]] sums the transcript's characters — bubbles, reasoning text, tool call args, and tool results all occupied the prompt loop — and excludes the just-completed assistant reply bubble, because `contextTokens` means prompt-side occupancy and the reply was generated output. The estimate is a floor: system prompt, tool schemas, and attachments aren't visible to the renderer.

A failed turn with no usage record does not fabricate an estimate — nothing new entered the context, and the previous gauge value stays.

## Status bar session usage

The bottom status bar shows the visible chat's context fill and token totals, scoped to its connection, profile and conversation. See [[src/renderer/src/screens/Layout/sessionUsage.ts#formatSessionUsage]].

[[src/renderer/src/screens/Chat/Chat.tsx]] reports usage upward per run (like loading and title), the shell keeps it on the run, and the bar shows it only on the chat tab. The chip turns to a warning at 80% of the window, using the unrounded ratio.

### Saved and live totals

An idle session-row read captures its live counter baseline at admission. Starting or completing a turn invalidates pending reads; a late response cannot prove which turn the row included.

The last confirmed row remains available while the next turn runs or metadata is unavailable. [[src/renderer/src/screens/Layout/sessionUsage.ts#combineUsageTotals]] adds only subsequent live gains. A connection/profile/config revision excludes both old live counters and saved metadata immediately. The status bar reads model, mode and skill metadata through a captured profile-editor target, rejecting superseded poll replies. A retained tab on a nonselected connection keeps its totals but omits unavailable connection metadata; it cannot claim the selected machine's state or imply an unknown gateway is offline.

Metadata requires the requested profile's own row. A missing row clears earlier metadata without falling back to another active profile or discarding the visible conversation's token totals.

Each captured footer target has at most one metadata read in flight. Poll ticks wait for slow reads to finish; changing the connection, profile or private authority starts a separate lifetime and rejects its old replies.

Failed or missing profile reads release the polling slot. Metadata remains unknown until a later read succeeds, while conversation usage stays visible.

Restoring an already selected profile preserves concurrent Chat usage and title updates. A no-op profile transition does not replace the run with an older snapshot.

[[remote-profiles#Tests#Missing profile footer cannot borrow default status]] exercises the actual Remote profile mapping through the captured footer target, including a saved name that disappears without changing Desktop's selection.

### Native Dashboard usage

The Agent's native `usage.input` and `usage.output` are cumulative runtime-session counters. Resume/create `info.usage` establishes the baseline before submitting a new prompt.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#dashboardUsageDelta]] converts native snapshots to increments per runtime session, ignores duplicate snapshots and accepts a lowered counter as a new counter generation. Legacy OpenAI `prompt_tokens`/`completion_tokens` payloads remain turn increments. Context occupancy stays the latest exact snapshot, independent of token-total arithmetic. Account revisions also fence [[src/main/remote-session-usage.ts#remoteGetSessionUsage]] replies.

## Tests

Actual chat, shell and status-bar regressions verify saved totals, native Agent counters and scoped metadata without changing the Agent API.

### Saved totals and delayed completed turns

A resumed conversation's metadata reply may arrive after completion. The real Chat→Layout→StatusBar path retains saved totals, refreshes the confirmed row and adds the next native cumulative turn once, even if later metadata fails.

### Saved totals follow the visible scope

Configuration changes discard pending saved metadata. Connection/profile switches show only the visible run's totals; retained nonselected tabs omit unavailable metadata while keeping their totals, including the same session ID on different machines.

### Refused prompts do not add usage

A pending authority check may refuse a prompt before dispatch. The actual composer retains the unsent text, no user turn or transport request is added, and confirmed session totals remain unchanged.

### Native cumulative counters and legacy deltas

Native usage snapshots produce per-runtime increments, deduplicate repeats and accept reset counters. Context stays exact and legacy OpenAI turn deltas retain their additive behavior.

### Passive roster resume retains native usage baseline

A passive roster read may reattach a live session before the next prompt. Its admitted native counters seed accounting without adding usage; completed turns then contribute only their new tokens.

### Usage metadata keeps account ownership

Session-row reads use an immutable connection snapshot and the requested profile. An OAuth account revision during the read rejects its late result rather than showing another account's totals.

### Status metadata rejects superseded reads

The status bar requests an explicit connection/profile target and rejects a delayed old read after switching scope, preserving the new model and connection mode.

### Slow status reads finish before another poll

Remote and SSH metadata can take longer than several polling ticks. The actual footer accepts that slow reply, avoids overlapping reads and resumes polling after it settles.

### Slow status replies cannot cross authority lifetimes

Changing connection, profile or private revision starts a fresh footer read even while the old request is pending. Its late reply cannot replace the current model or gateway state.

### Failed status reads release the poll slot

A delayed rejected request leaves connection metadata unknown but retains conversation usage. The next poll can succeed because the in-flight slot was released.

### Missing profile metadata stays unknown

A missing requested profile cannot borrow another active profile's model or gateway state. Actual footer rendering retains that conversation's usage and omits unavailable metadata.

### Current profile removal clears metadata

A current successful profile poll that no longer contains the requested profile clears old model and gateway chips. Session usage remains visible while profile metadata is unavailable.
