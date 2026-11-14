# Session model override

The in-chat (bottom) model picker selects a model for the **current conversation only** — it never rewrites `config.yaml`, so the Settings global default is preserved (#688), and carries the full model identity so cross-provider switches route correctly.

The override is held in renderer state on each `<Chat>` run ([[src/renderer/src/screens/Chat/Chat.tsx]]), persisted by session id, and sent with every message; it is cleared when the conversation is cleared/reset and is absent on a fresh chat, so new conversations start on the global default. This is distinct from the persisted [[model-context]] default that non-chat surfaces read.

Pre-send readiness uses the same active override. [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] passes the current picker `{provider, model, baseUrl}` into [[src/main/validation.ts#validateChatReadiness]], so a session-scoped pick does not keep showing "No model selected" just because the global `config.yaml` default is empty.

## Two-pane picker grouped by display brand

The bottom [[src/renderer/src/screens/Chat/ModelPicker.tsx]] dropdown is a two-pane layout: a left **provider rail** filters a right **flat model list**, with a top search box (leading magnifier icon) narrowing both.

The panel is styled as a floating native surface — translucent glass (`backdrop-filter`) lifted on a soft ambient shadow rather than a hard border, a recessed search field, and a filled-tint selection instead of an outlined row — so it reads as a desktop popover, not a web form. Depth comes from light (elevation, highlight, inset), not strokes; all radii use `var(--radius-*)` so the squared-corners theme toggle is respected.

The rail has an "All models" entry plus one row per brand (logo + model count); each list row shows the model title, a `Provider · model-id` subtitle, and a check on the active model. The currently-selected model is sorted **first** within whatever filter is shown (exact provider+model+baseUrl match, then same provider+model), leaving the rest of the list in its original order.

Models are grouped by **display brand**, not the raw stored provider, so OpenAI-compatible providers persisted as `custom` (Hermes One, Groq, DeepSeek, …) get their own rail entry instead of one generic "OpenAI Compatible / Local" bucket. [[src/renderer/src/screens/Chat/hooks/useModelConfig.ts#groupModelsByProvider]] derives each group's key/label from [[src/renderer/src/constants.ts#displayBrandFromConfig]], which reverse-maps a `custom` model's `baseUrl` to a brand id via `OPENAI_COMPATIBLE_BASE_URLS` (same reverse-map the [[provider-setup]] active-model picker uses). A `custom` endpoint not in the map stays under "OpenAI Compatible / Local".

Crucially, each model row keeps its **raw** `provider`/`baseUrl` for selection — only the rail grouping/label is branded — so routing and the active-model check (`currentModel === m.model && currentProvider === m.provider`) are unchanged. The rail brand filter is display-only React state; picking "All models" or a brand never rewrites config. The rail logo is the brand's [[src/renderer/src/components/common/BrandLogo.tsx]] (`matchTheme`), with a generic fallback for unknown brands.

A **Configure** button is pinned at the bottom of the provider rail (below the scrollable brand list), replacing the old free-text model input: it closes the picker and dispatches the `navigation:goto` window event (detail `"providers"`) that [[src/renderer/src/screens/Layout/Layout.tsx]] listens for, taking the user to the Providers screen to manage keys and the model library.

## Remote picker catalog

Remote and SSH pickers combine the profile's saved model library with the current provider's models from `/api/model/options`, keeping saved labels first and deduplicating by routing identity.

This matters for fresh named profiles: `/api/model/library` may contain only the active model until shortcuts are saved, while the provider options still advertise every model that the CLI can select. If options discovery is unavailable, the saved library remains usable. When saved rows already exist, options enrichment is limited to 5 seconds so stalled discovery cannot hide those rows for the normal 60-second discovery window. Providers that are merely authenticated but neither current nor user-defined stay hidden, preserving the configured-only picker policy.

### Named profiles keep the current provider catalog

A named remote profile whose saved library contains only its active model still lists the other models advertised by that active provider, and both dashboard requests retain the profile query parameter.

### Legacy gateway read-only inventory

An explicitly selected Remote Legacy transport can read its gateway's default model catalog through authenticated HTTP without enabling Dashboard-only model-library mutations.

The actual raw Agent server exposes authenticated `GET /api/model/options` and can omit `/api/model/library`. [[src/main/remote-models.ts#remoteListModels]] keeps its existing library-to-options fallback, and the registered `list-models` callback admits this read for the default/server profile. The preload call carries no explicit profile argument; this repair does not add named raw-server routing.

### Named Legacy selection is not a default catalog

An explicitly selected named Remote Legacy profile is refused before HTTP dispatch rather than silently reading the gateway's default or process-profile catalog.

[[src/main/remote-profile-selection.ts#getRemoteSelectedProfile]] resolves the selected profile for the captured active connection. Named Dashboard requests continue using their existing profile query; raw Agent named-profile routes require `/p/<profile>` and are outside this read-only repair.

### Legacy inventory failure stays remote

Unauthorized, absent, or non-JSON inventory replies remain visible failures and never substitute a local model library, profile, or credential.

The actual IPC callback tests use the real Remote HTTP adapter against a Bearer-only loopback fixture with a missing library route and authenticated options inventory. They verify 401, 404, and HTML failures without local reads.

### Legacy model mutations stay refused

Allowing Legacy catalog reads leaves add, remove, and update model-library IPC refused because those operations still require Dashboard transport.

The regression invokes each registered mutation callback and verifies that no Remote or Local mutation helper and no HTTP endpoint is called.

## Full identity, not just the model name

The override is a `SessionModelOverride` (`{provider, model, baseUrl}`), not a bare model string — because switching across providers must change routing, not only the `model` field.

The picker builds it via [[src/renderer/src/screens/Chat/hooks/useModelConfig.ts#effectiveOverrideBaseUrl]], the same baseUrl rule `selectModel` applies (keep the URL only for `custom`/`ollama-cloud`; clear it for named providers that have a canonical base URL), so the session pick and a persisted save can't drift. It is threaded renderer → preload IPC → main `sendMessage` as `modelOverride`.

## Desktop-only persistence

The selected model/provider is saved in a desktop-owned table keyed by session id, without storing API keys.

[[src/main/session-model-override-store.ts]] holds `desktop_session_model_overrides` with `provider`, `model`, and `base_url` only. [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] restores the saved value for a resumed session, applies it to the local picker with `persist:false`, and saves later changes once a gateway session id exists. Deleting a session removes the row through [[src/main/sessions.ts#deleteSessionRows]].

## Live model reconciliation

Before submitting a Dashboard prompt, the selected provider and model are checked against fresh runtime options even when the selection was already applied to that session.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] reapplies `/model` when the live identity drifts, such as after an automatic provider fallback. It validates the refreshed options before submission and retains the existing provider-alias equivalence rules.

### Fallback drift is reconciled before submission

A completed turn can leave the runtime on a different provider, model, or both. The next send switches and validates that same runtime before submitting its prompt, without first requiring a failed send or replacing the conversation.

### Matching runtime preserves the no-op path

An already-applied selection that still matches fresh options needs no additional `/model` command or second options read.

### Refused drift repair cannot submit to the fallback

A busy rejection or deferred switch that leaves the wrong live identity fails through the existing transport error path. It cannot submit the new prompt to the fallback, replay the previous prompt, or interrupt another running turn.

## Text-only legacy fallback routes via CLI

Text-only legacy turns can use the CLI fallback when a session override changes provider or base URL away from `config.yaml`.

The upstream desktop model applies the session switch on the active gateway session with `/model <model> --provider <provider>`, then attaches media and submits on that same session. Hermes Desktop's dashboard transport follows that path; [[src/main/hermes.ts#shouldForceCliForSessionOverride]] keeps the CLI escape hatch only for text-only legacy fallback, where it can pass `-m <model>` and `--provider` without dropping attachments. Same-provider model swaps stay on the gateway/API path, where the new `model` string is sufficient. Remote (SSH) mode has no local CLI transport, so it remains limited to the model string.

## Attachment turns stay on session transport

Attachment turns must not be forced through the CLI override fallback because the CLI path cannot carry multimodal input.

[[src/main/hermes.ts#sendMessageViaCli]] can inline text-file attachments but ignores images, while the gateway/API path preserves image parts and path refs through [[src/main/hermes.ts#buildUserContent]]. When a session override is active and the user sends attachments, [[src/main/hermes.ts#shouldForceCliForSessionOverride]] leaves the turn eligible for the dashboard/gateway or API transport instead of silently dropping media.

## Readiness follows chat routing

Pre-send validation uses the chat’s effective model and connection, so a valid picker selection is not blocked by unrelated local defaults or credentials.

[[src/main/validation.ts#validateChatReadiness]] uses a nonempty picker selection as a complete model identity. An empty selection falls back to the local profile only in Local mode. Remote and SSH validation never reads local model defaults, environment keys, or OAuth credentials; their server owns credential validation. The IPC call carries the chat connection ID and reruns when its mode changes.

### Picker identity and empty selections

A selected model replaces the local default without inheriting another provider’s URL. An empty local picker uses the persisted profile’s model and credentials.

### Remote credential boundary

Remote and SSH selections remain usable without local provider secrets. Missing remote model selections cannot be filled from an unrelated local default.
