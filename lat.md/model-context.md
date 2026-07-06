# Model context window

A model can carry an optional manual context-window override (tokens), for providers that don't advertise `context_length` over `/models` — without it the desktop can't size the context gauge or the agent's auto-compaction.

The same value fixes two symptoms at once: the context gauge showing a wrong heuristic size (e.g. 32k for a 64k model), and the agent never auto-compacting. hermes-agent auto-compacts at `context_length × compression.threshold` (default 0.50, enabled by default), so a correct `context_length` re-enables compaction without any extra UI.

## Storage and propagation

The override is stored per-model in `models.json` as `contextLength` and mirrored into `config.yaml`'s `model.context_length` whenever a model is activated — the single value both the gauge and the agent read.

Per-model storage (set in the Models add/edit dialog) survives switching between models. On activation, [[src/main/config.ts#setModelConfig]] writes or clears `model.context_length` from the activated model's library entry; an absent override clears any stale value left by a previously-active model. Remote/SSH activation does not propagate the override yet (local-mode only).

## Gauge resolution order

The context gauge resolves its window size as: config override (active model) → provider `/models` `context_length` → static heuristic.

[[src/main/model-discovery.ts#getModelContextWindow]] consults [[src/main/config.ts#getModelContextLengthOverride]] first, returning it only when it targets the model being asked about (so a stale value can't leak onto a different model id), before falling through to the authoritative `/models` lookup and finally the renderer's substring heuristic.

## Occupancy estimate when the provider omits usage

The gauge's numerator resolves as: exact payload counts (`context_used`, else prompt tokens) → a chars/4 transcript estimate → the previous turn's value. Without the estimate the gauge went blank on providers that return no usage at all (#789).

The gauge only renders when `contextTokens` is set (see `contextUsage` in [[src/renderer/src/screens/Chat/Chat.tsx]]), so on `message.complete` the transport fills it in even when `usageFromPayload` returns null. [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#estimateContextTokens]] sums the transcript's characters — bubbles, reasoning text, tool call args, and tool results all occupied the prompt loop — and excludes the just-completed assistant reply bubble, because `contextTokens` means prompt-side occupancy and the reply was generated output. The estimate is a floor: system prompt, tool schemas, and attachments aren't visible to the renderer.

A failed turn with no usage record does not fabricate an estimate — nothing new entered the context, and the previous gauge value stays.
