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

The picker is a flex-wrap **chip grid** (driven by `PROVIDER_CARDS` in [[src/renderer/src/constants.ts]]) rather than a dropdown: every native provider is a chip, and a terminal `local` ("Local / Others") chip reveals the `LOCAL_PRESETS` rows (local servers + remote OpenAI-compatible endpoints). `selectProvider` is the shared click handler for the provider chips and the preset chips.

Once a provider is configured the grid collapses to a read-only summary (logo + provider label + model/base-URL); a **Change** button in the section header (`editingProvider` state) re-opens the full chip grid and the editable model/base-URL fields. An unconfigured (`auto`) selection always shows the grid.

For compatible/custom endpoints, an inline **API Key** field appears under Base URL, stored under the host-derived env var (`resolveCompatEnvKey`: preset `envKey` else `expectedEnvKeyForUrl`, e.g. AtlasCloud → `ATLASCLOUD_API_KEY`). It shares the `env` state with the lower LLM-provider key cards, so either entry point stays in sync.

Ids the agent can't resolve by id are listed in `OPENAI_COMPATIBLE_BASE_URLS` ([[src/renderer/src/constants.ts]]) — openai, perplexity, and every `LOCAL_PRESETS` chip (local servers + remote endpoints like groq, deepseek, atlascloud, mistral, …). This map MUST contain every preset id, or selecting that chip mis-routes; a test in `tests/constants.test.ts` enforces it. Selecting one autofills its base URL and shows the base-URL field; on save it is persisted as `provider: custom` + `base_url`, which the gateway accepts and uses to host-derive the API key (`runtime_provider._host_derived_api_key`, e.g. `api.groq.com` → `GROQ_API_KEY`). `displayProviderFromConfig` reverse-maps a stored `custom` + known base URL back to the brand id so the dropdown re-selects it on load. Native providers (the gateway hardcodes their base URL) clear the field instead.

## Models library: per-provider keys for unknown URLs

Custom providers in the Models library ([[src/renderer/src/screens/Models/Models.tsx]]) that point at an unrecognized base URL each get their own env key instead of sharing one bucket, and that key is cleaned up when the provider is renamed or deleted.

`expectedEnvKeyForUrl` falls back to the shared `CUSTOM_API_KEY` for any host not in [[src/shared/url-key-map.ts]], which meant every unknown-URL custom provider overwrote the same env var. [[src/renderer/src/screens/Models/Models.tsx#customProviderEnvKey]] derives `CUSTOM_PROVIDER_<NAME>_KEY` from the provider's display name in that case, used by `openEditModal` (read, with a `CUSTOM_API_KEY` fallback for entries saved before this existed) and `handleSave` (write). [[src/main/config.ts#customEndpointKeyResolvable]] mirrors the same derivation — via a call-time `require("./models")` to avoid a static import cycle — so the config-health audit checks every model sharing that base URL, not just the first `readModels()` match.

Renaming a custom provider or deleting it changes or removes its derived key; `handleSave` and `handleDelete` call the new [[src/main/config.ts#deleteEnvValue]] (through `hermesAPI.deleteEnv` → the `delete-env` IPC handler, mirroring `setEnv`/`set-env`) to remove the old `CUSTOM_PROVIDER_<OLDNAME>_KEY` line so it doesn't linger in `.env`. [[src/main/ssh-remote.ts#sshDeleteEnvValue]] is the remote-mode equivalent, selected by the same `conn.mode === "ssh"` branch `set-env` already uses.

### Cleanup never deletes a key another entry still resolves to

Before either cleanup path deletes a key, [[src/renderer/src/screens/Models/Models.tsx#envKeyUsedByOtherModel]] checks whether another entry still resolves to it, and skips the delete if so.

Two entries can legitimately derive the *same* key: two custom providers on the same known vendor host both fall back to that vendor's shared key (e.g. `GROQ_API_KEY`), or two unknown-host providers with the same display name derive the same per-name key. `envKeyUsedByOtherModel` scans the in-memory `models` list, excluding the entry being edited/deleted, for any other entry resolving to that key — without this guard, renaming or removing one entry would silently wipe the vendor key a sibling entry still depends on.

## Provider icons

Each card's logo is resolved by [[src/renderer/src/components/common/BrandLogo.tsx]] from the provider id, falling back to a generic robot for unknown ids.

`detectBrand` matches the provider/model string to a `BrandKey`, and `matchTheme` flattens every logo to a single white/black tint so colored and `currentColor` SVGs render uniformly in the grid's logo tiles.

The Local/Remote preset chips are also branded: each renders the same `BrandLogo` (by preset id) to the left of its name in a row. `llama.cpp` is mapped off the Meta logo to the generic API mark (the `/llama/` substring would otherwise tag it, and Ollama, as Meta); any preset without a bundled logo falls back to the generic mark.
