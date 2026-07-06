# Provider setup

The first-run screen where the user picks an AI provider and enters credentials before the app is usable. Rendered by [[src/renderer/src/screens/Setup/Setup.tsx]], it writes the chosen provider/base-URL via `setModelConfig` and any key via `setEnv`.

The provider list is data-driven from `PROVIDERS.setup` in [[src/renderer/src/constants.ts]]. Each entry carries an `envKey`, `configProvider`, `baseUrl`, and `needsKey`; selecting a card drives which form fields show (API key, or the Local server/base-URL flow).

## Top grid mirrors the agent's native providers

The top provider grid shows only providers the upstream agent supports natively; generic OpenAI-compatible endpoints live in the Local presets instead.

The source of truth is `CANONICAL_PROVIDERS` in the bundled agent (`hermes-agent/hermes_cli/models.py`) — the registry of providers with first-class auth/base-URL handling (nous, openrouter, anthropic, openai-codex, openai-api, gemini, xai, xiaomi, ollama-cloud, deepseek, …). A card belongs in the top grid only if it maps to a canonical slug. `aimlapi` was removed from the grid because it has no canonical entry; it remains reachable as a **Local → Remote OpenAI-Compatible APIs** preset.

## OpenAI-compatible endpoints route through Local

Endpoints the agent does not natively support (Groq, DeepSeek, Together, Fireworks, Cerebras, AtlasCloud, Mistral, AIML, …) are offered as `LOCAL_PRESETS` chips under the `local` card, not as top-level cards.

Selecting a preset sets the base URL; the API-key env var is resolved by `resolveCustomEnvKey` — first an exact `LOCAL_PRESETS.envKey` match, then [[src/shared/url-key-map.ts]] by host. So a compatible provider configures correctly without a dedicated card (e.g. `api.aimlapi.com` → `AIMLAPI_API_KEY`).

## Providers tab routes OpenAI-compatible ids through `custom`

The Providers tab ([[src/renderer/src/screens/Providers/Providers.tsx]]) picks the model provider, but the agent only resolves native providers — selecting an unsupported id otherwise makes the gateway raise `Unknown provider`.

The screen is organized as three tabs: Providers, Models, and Auxiliary Tasks. Providers owns the active provider/model credentials, while Models and Auxiliary Tasks embed [[src/renderer/src/screens/Models/Models.tsx]] so the saved model library and per-task model overrides live beside the provider configuration instead of as a separate sidebar destination.

The picker is a flex-wrap **chip grid** (driven by `PROVIDER_CARDS` in [[src/renderer/src/constants.ts]]) rather than a dropdown: every native provider is a chip, and a terminal `local` ("Local / Others") chip reveals the `LOCAL_PRESETS` rows (local servers + remote OpenAI-compatible endpoints). `selectProvider` is the shared click handler for the provider chips and the preset chips.

Selecting the `local` card only opens the preset group — it sets `provider=custom` but must **not** seed a base URL. Preset chips mark active via `modelBaseUrl === preset.baseUrl`, so seeding LM Studio's localhost URL would preselect it (and the debounced autosave would persist it) before the user picks. To match that, `saveModelConfig` skips persisting a `custom` selection whose `base_url` is still empty, so opening the group neither preselects nor saves a provider until the user clicks a preset or types a URL. The skip applies **only while config.yaml holds no custom endpoint yet** (tracked by the `persistedCustomUrl` ref, refreshed on load and after each save): when a configured custom Base URL is cleared, the empty value IS persisted — otherwise the UI shows an empty endpoint while config.yaml silently keeps the old one across navigation/relaunch.

Once a provider is configured the grid collapses to a read-only summary (logo + provider label + model/base-URL); a **Change** button in the section header (`editingProvider` state) re-opens the full chip grid and the editable model/base-URL fields. An unconfigured (`auto`) selection always shows the grid.

`showEditor = !isConfigured || editingProvider`, so picking a provider from the grid would otherwise collapse the form the instant `isConfigured` flips true (selecting from the `auto` grid, where `editingProvider` is still false) — closing it before a custom base URL / API key could be entered. To prevent that, `selectProvider` sets `editingProvider` true on every selection: the editor stays open after a pick until the user explicitly clicks **Done**.

For compatible/custom endpoints, an inline **API Key** field appears under Base URL, stored under the host-derived env var (`resolveCompatEnvKey`: preset `envKey` else `expectedEnvKeyForUrl`, e.g. AtlasCloud → `ATLASCLOUD_API_KEY`). It shares the `env` state with the lower LLM-provider key cards, so either entry point stays in sync.

Ids the agent can't resolve by id are listed in `OPENAI_COMPATIBLE_BASE_URLS` ([[src/renderer/src/constants.ts]]) — openai, perplexity, and every `LOCAL_PRESETS` chip (local servers + remote endpoints like groq, deepseek, atlascloud, mistral, …). This map MUST contain every preset id, or selecting that chip mis-routes; a test in `tests/constants.test.ts` enforces it. Selecting one autofills its base URL and shows the base-URL field; on save it is persisted as `provider: custom` + `base_url`, which the gateway accepts and uses to host-derive the API key (`runtime_provider._host_derived_api_key`, e.g. `api.groq.com` → `GROQ_API_KEY`). `displayProviderFromConfig` reverse-maps a stored `custom` + known base URL back to the brand id so the dropdown re-selects it on load. Native providers (the gateway hardcodes their base URL) clear the field instead.

## Switching providers rewrites the transport (`api_mode`)

Activating a model must rewrite or clear `model.api_mode`, or a stale protocol from the previous model routes the new endpoint over the wrong transport — dropping connections when switching OpenAI- and Anthropic-compatible custom endpoints.

The gateway's runtime-provider resolver honors a persisted `model.api_mode` (`anthropic_messages` vs `chat_completions`, …) for `custom`/compatible providers, and only auto-detects from the base URL (`/anthropic` suffix, `api.openai.com`, …) when the key is absent. So a leftover `anthropic_messages` would keep an OpenAI-compatible endpoint pointed at `/v1/messages` (404 / lost connection).

[[src/main/config.ts#setModelConfig]] takes an optional `apiMode` argument, handled exactly like `context_length`: a non-empty string sets `model.api_mode`, `null`/empty removes it (so auto-detection resumes), `undefined` leaves it untouched. The `set-model-config` IPC handler ([[src/main/ipc/register.ts]]) resolves it from the activated model's `apiMode` library field ([[src/main/models.ts#SavedModel]]) — `null` when the entry has none — alongside the `contextLength` mirror, on both the pure-local and remote-fallback local writes. Custom-provider library entries carry `apiMode` because `loadCustomProviders` reads `api_mode` from each `custom_providers:` block.

The library lookup runs through [[src/main/ipc/register.ts#resolveLibraryModelEntry]], which disambiguates by base URL when several entries share the same provider+model — e.g. two `custom` endpoints exposing the same model id over different transports. A bare provider+model match would return the first entry and persist its `api_mode` for the other endpoint, routing it over the wrong protocol; matching the base URL too keeps each endpoint's transport correct. Single-entry activations are unaffected.

## Provider icons

Each card's logo is resolved by [[src/renderer/src/components/common/BrandLogo.tsx]] from the provider id, falling back to a generic robot for unknown ids.

`detectBrand` matches the provider/model string to a `BrandKey`, and `matchTheme` flattens every logo to a single white/black tint so colored and `currentColor` SVGs render uniformly in the grid's logo tiles.

The Local/Remote preset chips are also branded: each renders the same `BrandLogo` (by preset id) to the left of its name in a row. `llama.cpp` is mapped off the Meta logo to the generic API mark (the `/llama/` substring would otherwise tag it, and Ollama, as Meta); any preset without a bundled logo falls back to the generic mark.
