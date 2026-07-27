# Provider setup

The first-run screen where the user picks an AI provider and enters credentials before the app is usable. Rendered by [[src/renderer/src/screens/Setup/Setup.tsx]], it writes the chosen provider/base-URL via `setModelConfig` and any key via `setEnv`.

The provider list is data-driven from `PROVIDERS.setup` in [[src/renderer/src/constants.ts]]. Each entry carries an `envKey`, `configProvider`, `baseUrl`, and `needsKey`; selecting a card drives which form fields show (API key, or the Local server/base-URL flow).

## Hermes One is the first-priority provider

**Hermes One Inference** (`https://inference.hermesone.org/v1`) is Hermes One's own OpenAI-compatible gateway, listed **first** in `PROVIDERS.setup`, `PROVIDER_CARDS`, and the `SETTINGS_SECTIONS` "LLM Providers" items — so it leads the Add-provider picker.

It is not a canonical agent provider, so it routes through `custom` + `base_url` exactly like the `openai` card, with its key stored/host-derived as `HERMESONE_API_KEY` (`inference.hermesone.org` → `HERMESONE_API_KEY` in [[src/shared/url-key-map.ts]], and `hermesone` in `OPENAI_COMPAT_PROVIDERS`). It appears in `OPENAI_COMPATIBLE_BASE_URLS` so `displayProviderFromConfig` reverse-maps it back to the Hermes One card on reload, and its logo (`detectBrand` → `hermesone`, the `hermes-icon.svg` mark) shows in the grids. Users get a key from the console's Credits → API keys.

## Top grid mirrors the agent's native providers

The top provider grid shows only providers the upstream agent supports natively; generic OpenAI-compatible endpoints live in the Local presets instead.

The source of truth is `CANONICAL_PROVIDERS` in the bundled agent (`hermes-agent/hermes_cli/models.py`) — the registry of providers with first-class auth/base-URL handling (nous, openrouter, anthropic, openai-codex, openai-api, gemini, xai, xiaomi, ollama-cloud, deepseek, …). A card belongs in the top grid only if it maps to a canonical slug. `aimlapi` was removed from the grid because it has no canonical entry; it remains reachable as a **Local → Remote OpenAI-Compatible APIs** preset.

DashScope API-key traffic uses the agent's native `alibaba` provider. The agent itself aliases `qwen` (and `dashscope`, `aliyun`, `alibaba-cloud`) to `alibaba`; only `qwen-oauth` is the Qwen Portal OAuth provider. DashScope hosts resolve to `alibaba` and `DASHSCOPE_API_KEY`, and legacy configs that still say `provider: qwen` keep working: the install-gate env map covers every alias, and `displayProviderFromConfig` lands them on the DashScope card.

DashScope users choose between the mainland China and international endpoints during first-run setup ([[src/renderer/src/screens/Setup/Setup.tsx]]). Both choices keep `provider: alibaba`; only `base_url` changes. The **Setup picker** defaults to mainland China (`DEFAULT_DASHSCOPE_BASE_URL`) and always writes `base_url` explicitly, but the **canonical registry** ([[src/main/provider-registry.ts]] `PROVIDER_BASE_URLS`) stays on the international endpoint because it mirrors the agent's own default and is what `setModelConfig` fills into an empty `base_url` — a CN value there would silently repoint existing international users. The Providers tab has no endpoint field anymore (the active model is picked from configured providers), so `confirmModelPick` preserves the current `base_url` when re-picking an `alibaba` model — dropping it to empty would let the canonical fill flip a mainland user to the intl endpoint.

## OpenAI-compatible endpoints route through Local

Endpoints the agent does not natively support (Groq, DeepSeek, Together, Fireworks, Cerebras, AtlasCloud, Mistral, AIML, …) are offered as `LOCAL_PRESETS` chips under the `local` card, not as top-level cards.

Selecting a preset sets the base URL; the API-key env var is resolved by `resolveCustomEnvKey` — first an exact `LOCAL_PRESETS.envKey` match, then [[src/shared/url-key-map.ts]] by host. So a compatible provider configures correctly without a dedicated card (e.g. `api.aimlapi.com` → `AIMLAPI_API_KEY`).

## Active model is picked from configured providers

The Providers tab ([[src/renderer/src/screens/Providers/Providers.tsx]]) sets the default (active) model by choosing from what's already configured, not by free-form entry — there's no more provider chip grid, manual model/base-URL fields, or inline API-key input.

The screen is organized as two tabs: Providers and Auxiliary Tasks. There is no longer a standalone Models tab — models are managed only under each provider card (see "Models live under each provider" below), since the provider owns the base URL and key a per-model editor would otherwise duplicate. The Auxiliary Tasks tab renders [[src/renderer/src/components/AuxiliaryTasksSection.tsx]] (per-task model overrides), and a **Browse Registry** button in the model-section header opens [[src/renderer/src/components/RegistryBrowserModal.tsx]] to pick curated models into the library. A registry pick captures the model's context window/capabilities into a definition, then adds the attachment; its "already added" state is keyed by provider + endpoint + model id — matching [[src/main/models.ts#addModel]]'s dedup — so the same model id offered by two different custom endpoints can be added from each.

The **MODEL** section shows a read-only summary (logo + provider label + model). A **Change** button opens a picker modal with a **provider** picker (a custom `LogoSelect` — the brand logo renders inside the control and each option, which a native `<select>` can't do) and a native **model** dropdown. Confirming sets `modelProvider`/`modelName`/`modelBaseUrl`, which the existing debounced auto-save persists to `config.yaml` via `setModelConfig` (compat providers as `custom` + base_url). The **API key is resolved automatically** at runtime — the picker never asks for it.

That modal (`model-select-modal`) is styled **light-based** (no strokes): the container border, header/footer dividers, and control outlines are dropped in favor of filled controls (`--bg-elevated`, `--bg-hover` on hover/open) — matching the branded config modal's treatment. Crucially it sets `overflow: visible` (the base `.models-modal` clips with `overflow: hidden`), so the `LogoSelect` dropdown — which is absolutely positioned and can extend past the modal — isn't clipped; the menu itself caps at `max-height` and scrolls internally when the provider list is long. Without the override the lower providers were hidden and unreachable.

The provider list (`pickerProviders`) is sourced from the **configured providers** — the same set shown as LLM cards — NOT from which providers happen to have saved models: keyed FieldDef providers (`env[f.key]` set, in FieldDef order so Hermes One leads) plus named custom providers whose `customProviderEnvKey(label)` is set. So a freshly-keyed provider with no models yet still appears.

### Native keys without a setup card still route

Native-provider keys with no `PROVIDERS.setup` card carrying them (or only the OAuth variant, `envKey: ""`) must still resolve to their agent slug, or the picker silently drops them even with a key set — the Nous-missing-from-Change-modal bug.

[[src/renderer/src/constants.ts#providerRouteForEnvKey]] consults an explicit `NATIVE_ENV_KEY_ROUTES` table after the setup/preset lookups: `NOUS_API_KEY → nous`, `GLM_API_KEY → zai`, `KIMI_API_KEY → kimi-coding`, `MINIMAX_API_KEY → minimax`, `MINIMAX_CN_API_KEY → minimax-cn`, `NVIDIA_API_KEY → nvidia`, `OPENCODE_ZEN_API_KEY → opencode-zen`, `OPENCODE_GO_API_KEY → opencode-go`, `HF_TOKEN → huggingface`, and `PERPLEXITY_API_KEY → custom` + its compat base URL. Slugs and env vars mirror hermes-agent's own registry (`plugins/model-providers/*`). A test enforces the invariant that **no** LLM-section FieldDef falls through to the dead `custom` + empty-base-URL fallback (`tests/constants.test.ts`).

The **model** dropdown merges that provider's saved models with live discovery ([[src/renderer/src/hooks/useDiscoveredModels.ts#useDiscoveredModels]]) so a just-configured provider is immediately usable. On confirm, a discovered-only model is persisted via `addModel` first (so its key resolves and it reappears), and compat providers store `custom` + their `OPENAI_COMPATIBLE_BASE_URLS` base URL.

The debounced auto-save keeps a guard from the grid era that still applies: `saveModelConfig` skips persisting a `custom` selection whose `base_url` is empty (writing it would clobber config.yaml with a dead endpoint) — **unless** config.yaml already holds a custom endpoint, tracked by the `persistedCustomUrl` ref (refreshed on load and after each save). In that case the empty value IS persisted, so deliberately clearing a configured custom endpoint doesn't leave the UI (empty) and config.yaml (old URL) disagreeing after navigation/relaunch.

## LLM-provider keys are configured-only, via modals

The `SETTINGS_SECTIONS` "LLM Providers" section no longer renders a static key card for every known provider (an overwhelming wall of empty inputs). It shows only providers with a key set, plus an **Add provider** action.

[[src/renderer/src/components/ProviderKeysSection.tsx#ProviderKeysSection]] renders the configured cards + an Add tile; Add opens a searchable picker modal (logo per provider) → a per-provider config modal (key input with show/hide, **Remove provider**). It's a presentation layer over the same `env` state + `handleChange`/`handleBlur`/`handleRemove` handlers in [[src/renderer/src/screens/Providers/Providers.tsx]], so persistence is unchanged (`setEnv`); removing clears the env var.

Card and picker titles show the **plain provider name** ("Hermes One"), not the FieldDef's "… API Key" label — the section is a list of providers, and suffix-stripping the label isn't locale-safe. [[src/renderer/src/constants.ts#providerNameForEnvKey]] derives the display brand from the env key (via `providerRouteForEnvKey` + `displayBrandFromConfig`) and returns its `PROVIDERS.labels` entry, falling back to the FieldDef label for brandless keys; the picker search matches both the name and the full label. A test asserts every LLM-section key resolves to a name (`tests/constants.test.ts`).

### Branded config modal

The per-provider config modal (a keyed brand like Hermes One, not the custom flow) leads with the **provider logo tile + name + a verification pill** in the header, replacing the old key-icon-prefixed title.

The pill's text/tone comes from the same live discovery the models list uses, lifted out of the body: `ProviderModelsManager` takes `showStatus={false}` and reports `{tone,text}` + the saved-model count up via `onStatusChange`/`onModelCountChange`, so there's one discovery hook and no duplicate status line.

The **API key** shows as a masked preview (`maskKeyPreview` — leading scheme segment + last 4, dots between) with **Show** / **Replace** actions and a "used by N models" meta line, rather than a raw always-editable input. `replacingKey` state governs edit vs. preview: a keyed provider opens in preview (Replace swaps to the input), a fresh one opens straight in the input. Closing the modal (Done, ✕, or overlay click) flushes the key through `onBlur` first. The **Models** list drops the separate add row for a **+ Add model ID** pill that swaps to an inline autocomplete input (Enter/blur commits, Escape cancels), and each model chip's id is itself the click target for the definition editor. Only the first `MODELS_COLLAPSED` (10) chips render; the rest collapse behind a **+N more** toggle (`showAllModels`) so a large catalog doesn't flood the modal.

Visually the modal is **stroke-free**: the logo tile, status pill, API-key field, model chips, and the add/more pills are all differentiated by fill/elevation (`--bg-elevated`/`--bg-hover`), not borders — only the header/footer keep a hairline divider for structure. Chip and control fonts are small (11–13px).

The cards and picker are **ordered by display priority**, not the FieldDef declaration order (which groups providers by when they were added, surfacing niche endpoints like AIML API near the top). [[src/renderer/src/constants.ts#providerKeyRank]] ranks each env key: `PROVIDER_KEY_ORDER` front-loads the well-known providers (Hermes One first), unlisted keys keep their FieldDef order in the middle, and `PROVIDER_KEY_DEMOTED` (AIML API) sinks to the end. `ProviderKeysSection` sorts `keyItems` with a **stable** sort on the rank, so both the configured cards and the Add-provider picker share the ordering. A test pins Hermes One first and AIML last.

The section is rendered **standalone, above the credential pool** rather than in the `SETTINGS_SECTIONS.map` position — it's the primary surface for configuring providers and the models the top active-model selector picks from, so it sits before the advanced multi-key pool. The map skips the `constants.sectionLlmProviders` entry (an inline title check returning null); other `SETTINGS_SECTIONS` (non-LLM) still render inline in place, after the pool.

### Named custom providers

The picker offers a **Custom provider** tile (last) for any OpenAI-compatible endpoint not covered by a built-in card. You can add **multiple**, each with a distinct name, base URL, and its own key.

A custom provider's **identity** (name + base URL) is a first-class record in the desktop's per-profile store [[src/main/providers-store.ts]] (`providers.json`, plaintext — it holds no secrets, only name + base URL). Its **key** still lives in the profile `.env` and its **models** in `models.json`; the store is *additive* so a provider renders as a card the moment it is saved, independent of whether any model has been added. This fixed the prior gap where a keyed-but-modelless provider was invisible.

The config modal collects **Name**, **Base URL**, and an API key. On save (modal close) the identity is upserted via `upsertCustomProvider` ([[src/main/providers-store.ts#upsertCustomProvider]]), deduped by the derived env-key anchor so a re-save updates in place. The key is stored under the provider's dedicated env var, [[src/shared/url-key-map.ts#customProviderEnvKey]]`(name)` → `CUSTOM_PROVIDER_<SANITISED_NAME>_KEY` — so two custom providers never share a key. Models are added through the same [[src/renderer/src/components/ProviderKeysSection.tsx#ProviderModelsManager]] with an explicit `{ provider: "custom", baseUrl }` route plus `providerLabel = name`; that label is persisted on each [[src/main/models.ts#SavedModel]] (`providerLabel`) via [[src/main/models.ts#addModel]] (whose dedup now includes base URL, so the same model id can exist under two endpoints).

Configured custom-provider cards are the **union** of three sources, deduped by env-key anchor (in [[src/renderer/src/components/ProviderKeysSection.tsx#ProviderKeysSection]]): (1) the authoritative `providers.json` records via `listCustomProviders`; (2) back-compat — `provider: "custom"` models in `models.json` whose host resolves to `CUSTOM_API_KEY` (known compat hosts like groq/hermesone are excluded — they own dedicated key cards), grouped by `providerLabel`; (3) **orphan recovery** — any `CUSTOM_PROVIDER_*_KEY` env var with a value but no record/model, surfaced with an empty base URL so the user can complete or remove it. The active-model picker in [[src/renderer/src/screens/Providers/Providers.tsx]] unions (1) with the models-derived labels too, so a keyed custom provider is selectable before a model is saved; it prefers the authoritative `providers.json` base URL over a saved model's URL, so editing an existing provider's endpoint reroutes newly picked models instead of pinning them to the stale URL (a saved model's URL is used only for legacy/orphan records whose stored base URL is blank). **Remove provider** deletes its models, drops its `providers.json` record (`removeCustomProvider`), and clears its `CUSTOM_PROVIDER_*` key. The runtime is unchanged: [[src/main/hermes.ts]] still looks up the base-URL-matched model and derives `customProviderEnvKey(providerLabel ?? name)`, so every model under a provider shares that provider's key.

### Adding a curated partner provider

Sponsor/partner providers (and Hermes One itself) are OpenAI-compatible custom endpoints under the hood but are presented **first-class** — curated in-app, exactly like `hermesone`, with their own host-derived key and branding.

To add one, mirror the Hermes One entries: a card in `PROVIDERS.setup` + `PROVIDER_CARDS` + a base URL in `OPENAI_COMPATIBLE_BASE_URLS` ([[src/renderer/src/constants.ts]]), a `URL_KEY_MAP` entry giving it a dedicated `<PARTNER>_API_KEY` in [[src/shared/url-key-map.ts]], and a `detectBrand` rule + logo in [[src/renderer/src/components/common/BrandLogo.tsx]].

## Agent config sync for named providers

Named OpenAI-compatible providers sync both ways between the desktop and the agent's config.yaml — a CLI-added provider appears in the desktop UI, and a desktop-added one is visible to `hermes model` / `--provider <slug>`.

The agent reads two user-config shapes (`hermes-agent/hermes_cli/providers.py`): the `providers:` dict (`{slug: {name, base_url, key_env, transport}}`, resolved by `resolve_user_provider`) and the legacy `custom_providers:` list. [[src/main/agent-config-providers.ts]] is the bridge: it parses and text-edits those blocks with offset/line splicing (like `config.ts`), so user comments and unrelated keys survive round-trips.

The agent's config scaffold writes an inline empty dict (`providers: {}`), which the line-based block parser can't index — the upsert rewrites that line into block form instead of appending (a second `providers:` key would make the YAML ambiguous; this miss silently disabled the Hermes One mirror on real configs). Any other unparseable flow-dict form is left untouched rather than risking a duplicate key.

Sync is read-repair plus write-mirroring, all in the main process — the renderer needed no changes:

- **Import (terminal → desktop)**: every [[src/main/providers-store.ts#listCustomProviders]] read first runs the import — each config.yaml `providers:` entry is upserted into `providers.json` (skipping hosts that own a dedicated brand card), and a terminal `key_env`'s value is aliased additively to the derived `CUSTOM_PROVIDER_<NAME>_KEY` so the desktop key field and the runtime's label-derived lookup resolve unchanged. Similarly [[src/main/models.ts#syncAgentConfigModels]] merges `custom_providers:` model entries into `models.json` on every [[src/main/models.ts#listModels]] call (not just first seed), deduped by provider + model id + base URL, tagging rows with `providerLabel` so cards group correctly.
- **Mirror (desktop → terminal)**: [[src/main/providers-store.ts#upsertCustomProvider]] upserts a matching `providers:` entry (`name`/`base_url`/`key_env: CUSTOM_PROVIDER_<NAME>_KEY`) via [[src/main/agent-config-providers.ts#upsertAgentUserProvider]] — matching an existing entry by `key_env` then slug, and patching field values in place so a terminal user's extra fields (e.g. `transport:`) survive. [[src/main/providers-store.ts#removeCustomProvider]] removes the entry from **both** config.yaml shapes so the next read can't re-import a deleted provider.

Config.yaml is effectively the shared source of truth: desktop edits land there, and imports copy it back into the desktop stores. All writes are best-effort (an unwritable config.yaml never breaks the desktop store) and idempotent (unchanged content is never rewritten).

### Parses the agent's providers dict

`listAgentUserProviders` reads `providers:` entries with the same `base_url`/`api`/`url` alias precedence and `key_env` handling as the agent's `resolve_user_provider`, scoped by indentation so nested maps can't shadow the identity fields.

### Desktop saves mirror into config.yaml

`upsertAgentUserProvider` appends a `providers:` block (creating config.yaml or the block when missing) and round-trips through the parser; unrelated top-level keys are untouched.

### Store upserts propagate to the agent config

A desktop `upsertCustomProvider` leaves a terminal-visible `providers:` entry carrying the provider's derived `CUSTOM_PROVIDER_<NAME>_KEY` as `key_env`.

### Terminal-added providers import on read

A config.yaml `providers:` entry surfaces as a desktop provider card/record on the next list read, with its custom `key_env` value aliased additively into the derived env var; entries pointing at dedicated-brand hosts (e.g. Groq) are skipped.

### Model library merges custom_providers on every read

`custom_providers:` entries added from the terminal **after** the library was first seeded appear via `listModels`, exactly once (idempotent dedup), with their API key persisted under the derived env var.

### Desktop deletion cleans the agent config

Removing a provider in the desktop also deletes its `providers:` entry, so it stays deleted instead of re-importing on the next read.

### Legacy custom_providers removal

`removeAgentCustomProviderEntry` drops a `custom_providers:` list item by display name while leaving sibling items and following top-level blocks intact.

### First-party brands mirror as user providers

A keyed Hermes One is mirrored into config.yaml as `providers: hermesone:` ([[src/main/agent-config-providers.ts#mirrorFirstPartyAgentProviders]], run on every model-library / provider-list read) — without creating a custom card, since the brand owns a dedicated key card.

This exists because desktop models on `inference.hermesone.org` are saved as bare `custom` + base URL, and the agent resolves `/model … --provider custom` against the **session's current** base URL — a session sitting on another provider (e.g. Nous) would send the Hermes One model to the wrong endpoint (the hermesone-swift → Nous-proxy 404). The named entry gives the switch a slug that always carries the right URL and `HERMESONE_API_KEY`; the dashboard transport's [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#resolveDashboardProviderForModel]] correspondingly matches **any** gateway provider row by base URL (named user providers included, not just `custom:*` rows) before ever falling back to bare `custom`.

## Models live under each provider (OpenCode-style)

A provider's config modal manages the models it serves — the **only** place models are added/edited, since there is no standalone Models screen. The provider→models hierarchy lives in one place instead of a separate flat list.

[[src/renderer/src/components/ProviderKeysSection.tsx#ProviderModelsManager]] renders below the key field in the config modal: a key-status line, the model pills, and an add-input. It reads/writes the same `models.json` library the chat picker reads (`listModels`/`addModel`/`removeModel`, and re-syncs on `onModelLibraryChanged`), so added models immediately appear in the chat model picker. Models show as chips with a remove button and a **pencil** that opens a small editor for the model's shared definition (display name + context window — see [[model-context]]); because the definition is keyed by model id, editing it under one provider reflects under every provider serving that id. The add-input autocompletes off live discovery and strips whitespace as typed/pasted (model IDs never contain spaces, so `"hello there"` can't be saved).

The single [[src/renderer/src/hooks/useDiscoveredModels.ts#useDiscoveredModels]] call does double duty: it feeds the add-input's `<datalist>` **and** drives the "Connected · key verified" status line — a `status: "ok"` means the endpoint accepted the key and returned a model list, so the "verified" claim is truthful. `unsupported`/`unknown-host` degrade to a plain "Connected" (key set, list not exposed), `error` to "Couldn't verify key", and an empty key to "Add a key to connect".

The env key is the only anchor the modal has, so persistence routing is derived from it by [[src/renderer/src/constants.ts#providerRouteForEnvKey]]: it scans `PROVIDERS.setup` (returning `{provider: configProvider ?? id, baseUrl}`) then `LOCAL_PRESETS` (always `custom` + `baseUrl`), falling back to a bare `custom` route. Native providers keep their agent slug (the gateway hardcodes the base URL); OpenAI-compatible providers save as `provider: "custom"` + explicit `baseUrl` — the same routing the Providers tab's active-model picker applies, so entries stay consistent regardless of where they were added.

DashScope is a native provider rather than a compatible/custom endpoint, but it follows the same inline editing pattern: the endpoint selector writes either `dashscope.aliyuncs.com` or `dashscope-intl.aliyuncs.com` to `base_url`, and the key field writes `DASHSCOPE_API_KEY`.

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
