# Session model override

The in-chat (bottom) model picker selects a model for the **current conversation only** — it never rewrites `config.yaml`, so the Settings global default is preserved (#688), and carries the full model identity so cross-provider switches route correctly.

The override is held in renderer state on each `<Chat>` run ([[src/renderer/src/screens/Chat/Chat.tsx]]), persisted by session id, and sent with every message; it is cleared when the conversation is cleared/reset and is absent on a fresh chat, so new conversations start on the global default. This is distinct from the persisted [[model-context]] default that non-chat surfaces read.

## Full identity, not just the model name

The override is a `SessionModelOverride` (`{provider, model, baseUrl}`), not a bare model string — because switching across providers must change routing, not only the `model` field.

The picker builds it via [[src/renderer/src/screens/Chat/hooks/useModelConfig.ts#effectiveOverrideBaseUrl]], the same baseUrl rule `selectModel` applies (keep the URL only for `custom`/`ollama-cloud`; clear it for named providers that have a canonical base URL), so the session pick and a persisted save can't drift. It is threaded renderer → preload IPC → main `sendMessage` as `modelOverride`.

## Desktop-only persistence

The selected model/provider is saved in a desktop-owned table keyed by session id, without storing API keys.

[[src/main/session-model-override-store.ts]] holds `desktop_session_model_overrides` with `provider`, `model`, and `base_url` only. [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] restores the saved value for a resumed session, applies it to the local picker with `persist:false`, and saves later changes once a gateway session id exists. Deleting a session removes the row through [[src/main/sessions.ts#deleteSessionRows]].

## Text-only legacy fallback routes via CLI

Text-only legacy turns can use the CLI fallback when a session override changes provider or base URL away from `config.yaml`.

The upstream desktop model applies the session switch on the active gateway session with `/model <model> --provider <provider>`, then attaches media and submits on that same session. Hermes Desktop's dashboard transport follows that path; [[src/main/hermes.ts#shouldForceCliForSessionOverride]] keeps the CLI escape hatch only for text-only legacy fallback, where it can pass `-m <model>` and `--provider` without dropping attachments. Same-provider model swaps stay on the gateway/API path, where the new `model` string is sufficient. Remote (SSH) mode has no local CLI transport, so it remains limited to the model string.

## Attachment turns stay on session transport

Attachment turns must not be forced through the CLI override fallback because the CLI path cannot carry multimodal input.

[[src/main/hermes.ts#sendMessageViaCli]] can inline text-file attachments but ignores images, while the gateway/API path preserves image parts and path refs through [[src/main/hermes.ts#buildUserContent]]. When a session override is active and the user sends attachments, [[src/main/hermes.ts#shouldForceCliForSessionOverride]] leaves the turn eligible for the dashboard/gateway or API transport instead of silently dropping media.
