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
