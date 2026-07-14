// ── Shared Types ────────────────────────────────────────

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  hint: string;
}

export interface SectionDef {
  title: string;
  items: FieldDef[];
}

export const DASHSCOPE_ENDPOINTS = [
  {
    id: "cn",
    name: "constants.dashscopeChinaEndpoint",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "intl",
    name: "constants.dashscopeIntlEndpoint",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
] as const;

// UI-picker default only (mainland-first for the DashScope user base).
// Deliberately NOT the agent's canonical default, which is the intl
// endpoint — mirrored in main's PROVIDER_BASE_URLS (provider-registry.ts)
// and used to fill an empty base_url on save. The picker writes base_url
// explicitly, so this default never overrides a config silently.
export const DEFAULT_DASHSCOPE_BASE_URL = DASHSCOPE_ENDPOINTS[0].baseUrl;

// ── Providers ───────────────────────────────────────────

export const PROVIDERS = {
  // Ordered for the Providers / model-picker dropdown.  Each value must
  // match a provider name `hermes-agent` recognises (see
  // hermes_cli/auth.py::resolve_provider — _PROVIDER_ALIASES + PROVIDER_REGISTRY)
  // so the gateway routes correctly when the user picks the entry.  The
  // catch-all `custom` stays last for unlisted OpenAI-compatible endpoints.
  options: [
    { value: "auto", label: "constants.autoDetect" },
    // Aggregators
    { value: "openrouter", label: "constants.openrouterName" },
    { value: "aimlapi", label: "constants.aimlapiName" },
    // First-party API providers
    { value: "anthropic", label: "constants.anthropicName" },
    { value: "openai", label: "constants.openaiName" },
    { value: "openai-codex", label: "constants.openaiCodexName" },
    { value: "ollama-cloud", label: "constants.ollamaCloudName" },
    { value: "google", label: "constants.googleName" },
    { value: "xai", label: "constants.xaiName" },
    { value: "xiaomi", label: "Xiaomi MiMo" },
    { value: "mistral", label: "Mistral" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "groq", label: "Groq" },
    { value: "together", label: "Together AI" },
    { value: "fireworks", label: "Fireworks AI" },
    { value: "cerebras", label: "Cerebras" },
    { value: "perplexity", label: "Perplexity" },
    { value: "huggingface", label: "Hugging Face" },
    { value: "nvidia", label: "NVIDIA NIM" },
    { value: "zai", label: "Z.ai / GLM" },
    { value: "alibaba", label: "Alibaba DashScope" },
    { value: "minimax", label: "MiniMax" },
    { value: "nous", label: "constants.nousName" },
    // Local OpenAI-compatible servers. Keep these explicit so users
    // looking for "Ollama" or "LM Studio" do not have to discover the
    // generic custom-provider path first.
    { value: "lmstudio", label: "constants.lmstudio" },
    { value: "atomicchat", label: "constants.atomicchat" },
    { value: "ollama", label: "constants.ollama" },
    { value: "vllm", label: "constants.vllm" },
    { value: "llamacpp", label: "constants.llamacpp" },
    // Subscription / OAuth plans
    // openai-codex is listed once above (first-party group) via #102 —
    // not repeated here to avoid a duplicate <option> value.
    { value: "xai-oauth", label: "xAI Grok (OAuth)" },
    { value: "qwen-oauth", label: "Qwen (OAuth)" },
    { value: "google-gemini-cli", label: "Gemini (CLI OAuth)" },
    { value: "minimax-oauth", label: "MiniMax (OAuth)" },
    { value: "kimi-coding", label: "Kimi (Coding Plan)" },
    // Catch-all for any other OpenAI-compatible endpoint or local LLM
    { value: "custom", label: "constants.customOpenAICompatibleName" },
  ],

  labels: {
    hermesone: "Hermes One",
    atlascloud: "AtlasCloud",
    openrouter: "constants.openrouterName",
    aimlapi: "constants.aimlapiName",
    anthropic: "constants.anthropicName",
    openai: "constants.openaiName",
    "openai-codex": "constants.openaiCodexName",
    "ollama-cloud": "constants.ollamaCloudName",
    google: "constants.googleName",
    xai: "constants.xaiName",
    xiaomi: "Xiaomi MiMo",
    mistral: "Mistral",
    deepseek: "DeepSeek",
    groq: "Groq",
    together: "Together AI",
    fireworks: "Fireworks AI",
    cerebras: "Cerebras",
    perplexity: "Perplexity",
    huggingface: "Hugging Face",
    nvidia: "NVIDIA NIM",
    zai: "Z.ai / GLM",
    alibaba: "Alibaba DashScope",
    minimax: "MiniMax",
    nous: "constants.nousName",
    lmstudio: "constants.lmstudio",
    atomicchat: "constants.atomicchat",
    ollama: "constants.ollama",
    vllm: "constants.vllm",
    llamacpp: "constants.llamacpp",
    "xai-oauth": "xAI Grok (OAuth)",
    "qwen-oauth": "Qwen (OAuth)",
    "google-gemini-cli": "Gemini (CLI OAuth)",
    "minimax-oauth": "MiniMax (OAuth)",
    "kimi-coding": "Kimi (Coding Plan)",
    custom: "OpenAI Compatible / Local",
  } as Record<string, string>,

  setup: [
    {
      // Hermes One's own inference gateway — shown first. OpenAI-compatible, so
      // it routes through `custom` + base_url (like the `openai` card); the key
      // is stored/host-derived as HERMESONE_API_KEY (see url-key-map.ts).
      id: "hermesone",
      name: "Hermes One",
      desc: "Hermes One Inference — pay-per-token with AI Credits",
      tag: "Recommended",
      envKey: "HERMESONE_API_KEY",
      url: "https://console.hermesone.org/credits",
      placeholder: "hs-live-...",
      configProvider: "custom",
      baseUrl: "https://inference.hermesone.org/v1",
      needsKey: true,
    },
    {
      id: "openrouter",
      name: "constants.openrouterName",
      desc: "constants.openrouterDesc",
      tag: "constants.openrouterTag",
      envKey: "OPENROUTER_API_KEY",
      url: "https://openrouter.ai/keys",
      placeholder: "sk-or-v1-...",
      configProvider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      needsKey: true,
    },
    {
      id: "anthropic",
      name: "constants.anthropicName",
      desc: "constants.anthropicDesc",
      tag: "",
      envKey: "ANTHROPIC_API_KEY",
      url: "https://console.anthropic.com/settings/keys",
      placeholder: "sk-ant-...",
      configProvider: "anthropic",
      baseUrl: "",
      needsKey: true,
    },
    {
      id: "openai",
      name: "constants.openaiName",
      desc: "constants.openaiDesc",
      tag: "",
      envKey: "OPENAI_API_KEY",
      url: "https://platform.openai.com/api-keys",
      placeholder: "sk-...",
      // Routed through the `custom` provider with an explicit base_url:
      // hermes-agent's resolve_provider does not recognise a bare `openai`
      // provider id (issue #294). The `custom` + api.openai.com path is
      // accepted, and the OpenAI key is picked up via the known-host
      // base-URL mapping.
      configProvider: "custom",
      baseUrl: "https://api.openai.com/v1",
      needsKey: true,
    },
    {
      id: "openai-codex",
      name: "constants.openaiCodexName",
      desc: "constants.openaiCodexDesc",
      tag: "constants.openaiCodexTag",
      envKey: "",
      url: "",
      placeholder: "",
      configProvider: "openai-codex",
      baseUrl: "",
      needsKey: false,
    },
    {
      id: "ollama-cloud",
      name: "constants.ollamaCloudName",
      desc: "constants.ollamaCloudDesc",
      tag: "constants.ollamaCloudTag",
      envKey: "OLLAMA_API_KEY",
      url: "https://ollama.com/settings/keys",
      placeholder: "ollama_...",
      configProvider: "ollama-cloud",
      baseUrl: "https://ollama.com/v1",
      needsKey: true,
    },
    {
      id: "google",
      name: "constants.googleName",
      desc: "constants.googleDesc",
      tag: "",
      envKey: "GOOGLE_API_KEY",
      url: "https://aistudio.google.com/app/apikey",
      placeholder: "AIza...",
      configProvider: "google",
      baseUrl: "",
      needsKey: true,
    },
    {
      id: "alibaba",
      name: "Alibaba DashScope",
      desc: "constants.dashscopeDesc",
      tag: "",
      envKey: "DASHSCOPE_API_KEY",
      url: "https://bailian.console.aliyun.com/?apiKey=1",
      placeholder: "sk-...",
      configProvider: "alibaba",
      baseUrl: DEFAULT_DASHSCOPE_BASE_URL,
      needsKey: true,
    },
    {
      id: "xai",
      name: "constants.xaiName",
      desc: "constants.xaiDesc",
      tag: "",
      envKey: "XAI_API_KEY",
      url: "https://console.x.ai",
      placeholder: "xai-...",
      configProvider: "xai",
      baseUrl: "",
      needsKey: true,
    },
    {
      id: "xiaomi",
      name: "Xiaomi MiMo",
      desc: "MiMo models",
      tag: "",
      envKey: "XIAOMI_API_KEY",
      url: "https://platform.xiaomimimo.com",
      placeholder: "sk-...",
      configProvider: "xiaomi",
      baseUrl: "https://api.xiaomimimo.com/v1",
      needsKey: true,
    },
    {
      id: "nous",
      name: "constants.nousName",
      desc: "constants.nousDesc",
      tag: "constants.nousTag",
      envKey: "",
      url: "",
      placeholder: "",
      configProvider: "nous",
      baseUrl: "",
      needsKey: false,
    },
    {
      id: "local",
      name: "constants.localName",
      desc: "constants.localDesc",
      tag: "constants.localTag",
      envKey: "",
      url: "",
      placeholder: "sk-...",
      configProvider: "custom",
      baseUrl: "http://localhost:1234/v1",
      needsKey: false,
    },
  ],
};

// Subscription / OAuth-plan providers — these authenticate through an
// interactive browser login (`hermes auth add <id> --type oauth`) rather
// than a static API key. The Providers screen renders a "Sign in" card
// for each. Values must match hermes-agent's provider registry.
export interface OAuthProviderDef {
  id: string;
  name: string;
  desc: string;
}

export const OAUTH_PROVIDERS: OAuthProviderDef[] = [
  {
    id: "openai-codex",
    name: "ChatGPT (Codex Plan)",
    desc: "providers.oauth.codexDesc",
  },
  {
    id: "xai-oauth",
    name: "xAI Grok (OAuth)",
    desc: "providers.oauth.xaiDesc",
  },
  { id: "qwen-oauth", name: "Qwen (OAuth)", desc: "providers.oauth.qwenDesc" },
  {
    id: "google-gemini-cli",
    name: "Gemini (CLI OAuth)",
    desc: "providers.oauth.geminiDesc",
  },
  {
    id: "minimax-oauth",
    name: "MiniMax (OAuth)",
    desc: "providers.oauth.minimaxDesc",
  },
  // Nous Portal OAuth — issue #367 Bug 2. The engine's
  // PROVIDER_REGISTRY registers `nous` with auth_type="oauth_device_code";
  // without this card the only way to trigger the sign-in flow was
  // `hermes auth add nous --type oauth` from PowerShell.
  {
    id: "nous",
    name: "Nous Portal (OAuth)",
    desc: "providers.oauth.nousDesc",
  },
];

export interface LocalPreset {
  id: string;
  name: string;
  baseUrl: string;
  group: "local" | "remote";
  envKey?: string;
}

// Card grid for the Providers tab's model-provider picker (a friendlier
// replacement for the long <select>). Every native provider is a card; the
// terminal `local` card reveals the LOCAL_PRESETS chips (local servers + remote
// OpenAI-compatible endpoints). `openai` is a card but routes as `custom` (see
// OPENAI_COMPATIBLE_BASE_URLS). Distinct from PROVIDERS.setup, which stays the
// curated first-run set.
export const PROVIDER_CARDS: { id: string; name: string }[] = [
  { id: "hermesone", name: "Hermes One" },
  { id: "openrouter", name: "constants.openrouterName" },
  { id: "anthropic", name: "constants.anthropicName" },
  { id: "openai", name: "constants.openaiName" },
  { id: "openai-codex", name: "constants.openaiCodexName" },
  { id: "ollama-cloud", name: "constants.ollamaCloudName" },
  { id: "google", name: "constants.googleName" },
  { id: "xai", name: "constants.xaiName" },
  { id: "xiaomi", name: "Xiaomi MiMo" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "nvidia", name: "NVIDIA NIM" },
  { id: "zai", name: "Z.ai / GLM" },
  { id: "minimax", name: "MiniMax" },
  { id: "huggingface", name: "Hugging Face" },
  { id: "alibaba", name: "Alibaba DashScope" },
  { id: "nous", name: "constants.nousName" },
  // "Local / Others" — this chip covers both local servers and any remote
  // OpenAI-compatible endpoint, so it isn't labelled just "Local".
  { id: "local", name: "Local / Others" },
];

// Provider dropdown ids the bundled agent does NOT resolve natively — there is
// no plugin in hermes-agent/plugins/model-providers/ and no alias in
// resolve_provider (hermes_cli/auth.py), so passing the id raises
// "Unknown provider". They are OpenAI-compatible endpoints, so we route them
// through the `custom` provider with this base_url; the gateway then
// host-derives the API key (runtime_provider._host_derived_api_key), e.g.
// api.groq.com -> GROQ_API_KEY. Native providers (openrouter, anthropic, xai,
// deepseek, gemini/google, xiaomi, nvidia, zai, minimax, huggingface, nous,
// ollama-cloud, openai-codex, lmstudio, …) are intentionally absent: the
// gateway hardcodes their base_url.
// Every id offered as a LOCAL_PRESETS chip must appear here so the Providers
// picker routes it consistently (autofill base_url + persist as `custom`).
// Keep this in sync with LOCAL_PRESETS below.
export const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  hermesone: "https://inference.hermesone.org/v1",
  openai: "https://api.openai.com/v1",
  aimlapi: "https://api.aimlapi.com/v1",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  cerebras: "https://api.cerebras.ai/v1",
  atlascloud: "https://api.atlascloud.ai/v1",
  perplexity: "https://api.perplexity.ai",
  lmstudio: "http://localhost:1234/v1",
  atomicchat: "http://localhost:1337/v1",
  ollama: "http://localhost:11434/v1",
  vllm: "http://localhost:8000/v1",
  llamacpp: "http://localhost:8080/v1",
};

/**
 * Reverse-map a stored (provider, baseUrl) back to its display brand id.
 *
 * OpenAI-compatible providers (Hermes One, Groq, DeepSeek, …) are persisted as
 * `provider: "custom"` + their base URL because the agent can't resolve their
 * brand id. For display — grouping in the chat model picker, the provider
 * summary/logo — map that base URL back to the brand id via
 * `OPENAI_COMPATIBLE_BASE_URLS`, so e.g. an `inference.hermesone.org` model shows
 * under "Hermes One" instead of the generic "OpenAI Compatible / Local" bucket.
 *
 * Routing is unaffected: callers keep the raw `provider`/`baseUrl` for
 * `setModelConfig`; only the label/grouping uses the returned brand.
 */
export function displayBrandFromConfig(
  provider: string,
  baseUrl: string,
): string {
  // Legacy configs store `qwen` (the pre-#825 grid id); the agent aliases
  // qwen → alibaba, so land those on the DashScope brand.
  if (provider === "qwen") return "alibaba";
  if (provider !== "custom" || !baseUrl) return provider;
  const norm = (u: string): string =>
    (u || "").trim().replace(/\/+$/, "").toLowerCase();
  const target = norm(baseUrl);
  const match = Object.entries(OPENAI_COMPATIBLE_BASE_URLS).find(
    ([, url]) => norm(url) === target,
  );
  return match ? match[0] : provider;
}

export const LOCAL_PRESETS: LocalPreset[] = [
  {
    id: "lmstudio",
    name: "constants.lmstudio",
    baseUrl: "http://localhost:1234/v1",
    group: "local",
  },
  {
    id: "atomicchat",
    name: "constants.atomicchat",
    baseUrl: "http://localhost:1337/v1",
    group: "local",
  },
  {
    id: "ollama",
    name: "constants.ollama",
    baseUrl: "http://localhost:11434/v1",
    group: "local",
  },
  {
    id: "vllm",
    name: "constants.vllm",
    baseUrl: "http://localhost:8000/v1",
    group: "local",
  },
  {
    id: "llamacpp",
    name: "constants.llamacpp",
    baseUrl: "http://localhost:8080/v1",
    group: "local",
  },
  {
    id: "groq",
    name: "constants.groq",
    baseUrl: "https://api.groq.com/openai/v1",
    group: "remote",
    envKey: "GROQ_API_KEY",
  },

  {
    id: "deepseek",
    name: "constants.deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    group: "remote",
    envKey: "DEEPSEEK_API_KEY",
  },
  {
    id: "together",
    name: "constants.together",
    baseUrl: "https://api.together.xyz/v1",
    group: "remote",
    envKey: "TOGETHER_API_KEY",
  },
  {
    id: "fireworks",
    name: "constants.fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    group: "remote",
    envKey: "FIREWORKS_API_KEY",
  },
  {
    id: "cerebras",
    name: "constants.cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    group: "remote",
    envKey: "CEREBRAS_API_KEY",
  },
  {
    id: "atlascloud",
    name: "constants.atlascloud",
    baseUrl: "https://api.atlascloud.ai/v1",
    group: "remote",
    envKey: "ATLASCLOUD_API_KEY",
  },
  {
    id: "mistral",
    name: "constants.mistral",
    baseUrl: "https://api.mistral.ai/v1",
    group: "remote",
    envKey: "MISTRAL_API_KEY",
  },
  {
    id: "aimlapi",
    name: "constants.aimlapi",
    baseUrl: "https://api.aimlapi.com/v1",
    group: "remote",
    envKey: "AIMLAPI_API_KEY",
  },
];

// How to persist a model saved "under" a given LLM-provider key. The env key
// (a "LLM Providers" FieldDef `key`, e.g. HERMESONE_API_KEY) is the anchor the
// UI has; a saved model needs a routing pair instead: native providers keep
// their agent slug (the gateway hardcodes the base URL), while OpenAI-compatible
// providers route as `provider: "custom"` + explicit `baseUrl` (host-derives the
// key). We DERIVE the pair from the existing registries rather than re-listing
// slugs: `PROVIDERS.setup` already carries `{envKey, configProvider, baseUrl}`
// and `LOCAL_PRESETS` carries `{envKey, baseUrl}` (always custom-routed). This
// keeps the per-provider Models manager saving entries exactly the way the
// Models screen / Providers tab would. Unknown keys fall back to a bare `custom`
// route so any provider can still hold models.
export function providerRouteForEnvKey(envKey: string): {
  provider: string;
  baseUrl: string;
} {
  // The setup array is a heterogeneous literal (not every entry carries
  // configProvider/baseUrl), so read it through a partial shape.
  type SetupRoute = {
    id: string;
    envKey?: string;
    configProvider?: string;
    baseUrl?: string;
  };
  const setup = (PROVIDERS.setup as ReadonlyArray<SetupRoute>).find(
    (p) => p.envKey === envKey,
  );
  if (setup) {
    return {
      provider: setup.configProvider ?? setup.id,
      baseUrl: setup.baseUrl ?? "",
    };
  }
  const preset = LOCAL_PRESETS.find((p) => p.envKey === envKey);
  if (preset) return { provider: "custom", baseUrl: preset.baseUrl ?? "" };
  return { provider: "custom", baseUrl: "" };
}

// ── Theme ───────────────────────────────────────────────

export type ThemeAppearance = "dark" | "light";

export interface ThemeDef {
  /** Value written to localStorage and the `data-theme` attribute. */
  id: string;
  /** Display name shown in the picker (proper names are not translated). */
  name: string;
  /** Whether the palette is dark or light (drives the "System" fallback). */
  appearance: ThemeAppearance;
}

/**
 * Registry of selectable themes. Each entry must have a matching
 * `[data-theme="<id>"]` block in `assets/main.css`. To add a theme, append an
 * entry here and define its CSS variables there — nothing else is required.
 */
export const THEMES: ThemeDef[] = [
  { id: "dark", name: "Dark", appearance: "dark" },
  { id: "light", name: "Light", appearance: "light" },
  { id: "dracula", name: "Dracula", appearance: "dark" },
  { id: "nord", name: "Nord", appearance: "dark" },
  { id: "one-dark", name: "One Dark", appearance: "dark" },
  { id: "github-dark", name: "GitHub Dark", appearance: "dark" },
  { id: "monokai", name: "Monokai", appearance: "dark" },
  { id: "solarized-dark", name: "Solarized Dark", appearance: "dark" },
  { id: "gruvbox-dark", name: "Gruvbox Dark", appearance: "dark" },
  { id: "tokyo-night", name: "Tokyo Night", appearance: "dark" },
  { id: "github-light", name: "GitHub Light", appearance: "light" },
  { id: "solarized-light", name: "Solarized Light", appearance: "light" },
];

/**
 * Legacy options retained for older callers/tests that only distinguish between
 * OS-following, light, and dark modes. New theme pickers should use THEMES.
 */
export const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Themes used by the "System" setting when following the OS preference. */
export const DEFAULT_DARK_THEME = "dark";
export const DEFAULT_LIGHT_THEME = "light";

export const THEME_STORAGE_KEY = "hermes-theme";

// ── Font ────────────────────────────────────────────────

// Each option maps to a full font-family stack assigned to `--font-sans`.
// "manrope" is the bundled default; the rest fall back to OS-installed
// families with a sane sans-serif chain so something always renders.
export interface FontOption {
  value: string;
  label: string;
  stack: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    value: "manrope",
    label: "settings.font.manrope",
    stack:
      '"Cairo", "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    value: "system",
    label: "settings.font.system",
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, Cantarell, "Helvetica Neue", sans-serif',
  },
];

export const DEFAULT_FONT = "manrope";

export const FONT_STORAGE_KEY = "hermes-font";

// ── Settings API Key Sections ───────────────────────────

export const SETTINGS_SECTIONS: SectionDef[] = [
  {
    title: "constants.sectionLlmProviders",
    items: [
      // Hermes One's own inference gateway — first-class + first in the list.
      // Custom under the hood (routes as `custom` + inference.hermesone.org),
      // keyed by HERMESONE_API_KEY via URL_KEY_MAP.
      {
        key: "HERMESONE_API_KEY",
        label: "constants.hermesoneApiKey",
        type: "password",
        hint: "constants.hermesoneHint",
      },
      {
        key: "OPENROUTER_API_KEY",
        label: "constants.openrouterApiKey",
        type: "password",
        hint: "constants.openrouterHint",
      },
      {
        key: "OPENAI_API_KEY",
        label: "constants.openaiApiKey",
        type: "password",
        hint: "constants.openaiHint",
      },
      {
        key: "OLLAMA_API_KEY",
        label: "constants.ollamaCloudApiKey",
        type: "password",
        hint: "constants.ollamaCloudHint",
      },
      {
        key: "AIMLAPI_API_KEY",
        label: "constants.aimlapiApiKey",
        type: "password",
        hint: "constants.aimlapiHint",
      },
      {
        key: "ANTHROPIC_API_KEY",
        label: "constants.anthropicApiKey",
        type: "password",
        hint: "constants.anthropicHint",
      },
      {
        key: "GROQ_API_KEY",
        label: "constants.groqApiKey",
        type: "password",
        hint: "constants.groqHint",
      },
      {
        key: "GLM_API_KEY",
        label: "constants.glmApiKey",
        type: "password",
        hint: "constants.glmHint",
      },
      {
        key: "KIMI_API_KEY",
        label: "constants.kimiApiKey",
        type: "password",
        hint: "constants.kimiHint",
      },
      {
        key: "DASHSCOPE_API_KEY",
        label: "constants.dashscopeApiKey",
        type: "password",
        hint: "constants.dashscopeHint",
      },
      {
        key: "MINIMAX_API_KEY",
        label: "constants.minimaxApiKey",
        type: "password",
        hint: "constants.minimaxHint",
      },
      // Nous Portal API-key variant — the OAuth variant has its own
      // card in the OAuth section below. Missing-API-key-card was
      // issue #367 Bug 1.
      {
        key: "NOUS_API_KEY",
        label: "constants.nousApiKey",
        type: "password",
        hint: "constants.nousHint",
      },
      {
        key: "MINIMAX_CN_API_KEY",
        label: "constants.minimaxCnApiKey",
        type: "password",
        hint: "constants.minimaxCnHint",
      },
      {
        key: "OPENCODE_ZEN_API_KEY",
        label: "constants.opencodeZenApiKey",
        type: "password",
        hint: "constants.opencodeZenHint",
      },
      {
        key: "OPENCODE_GO_API_KEY",
        label: "constants.opencodeGoApiKey",
        type: "password",
        hint: "constants.opencodeGoHint",
      },
      {
        key: "HF_TOKEN",
        label: "constants.hfToken",
        type: "password",
        hint: "constants.hfHint",
      },
      {
        key: "DEEPSEEK_API_KEY",
        label: "constants.deepseekApiKey",
        type: "password",
        hint: "constants.deepseekHint",
      },
      {
        key: "TOGETHER_API_KEY",
        label: "constants.togetherApiKey",
        type: "password",
        hint: "constants.togetherHint",
      },
      {
        key: "FIREWORKS_API_KEY",
        label: "constants.fireworksApiKey",
        type: "password",
        hint: "constants.fireworksHint",
      },
      {
        key: "CEREBRAS_API_KEY",
        label: "constants.cerebrasApiKey",
        type: "password",
        hint: "constants.cerebrasHint",
      },
      {
        key: "ATLASCLOUD_API_KEY",
        label: "constants.atlascloudApiKey",
        type: "password",
        hint: "constants.atlascloudHint",
      },
      {
        key: "MISTRAL_API_KEY",
        label: "constants.mistralApiKey",
        type: "password",
        hint: "constants.mistralHint",
      },
      {
        key: "PERPLEXITY_API_KEY",
        label: "constants.perplexityApiKey",
        type: "password",
        hint: "constants.perplexityHint",
      },
      {
        key: "NVIDIA_API_KEY",
        label: "constants.nvidiaApiKey",
        type: "password",
        hint: "constants.nvidiaHint",
      },
      {
        key: "CUSTOM_API_KEY",
        label: "constants.customApiKey",
        type: "password",
        hint: "constants.customHint",
      },
      {
        key: "GOOGLE_API_KEY",
        label: "constants.googleApiKey",
        type: "password",
        hint: "constants.googleHint",
      },
      {
        key: "XAI_API_KEY",
        label: "constants.xaiApiKey",
        type: "password",
        hint: "constants.xaiHint",
      },
      {
        key: "XIAOMI_API_KEY",
        label: "constants.xiaomiApiKey",
        type: "password",
        hint: "constants.xiaomiHint",
      },
    ],
  },
  {
    title: "constants.sectionToolApiKeys",
    items: [
      {
        key: "EXA_API_KEY",
        label: "constants.exaApiKey",
        type: "password",
        hint: "constants.exaHint",
      },
      {
        key: "PARALLEL_API_KEY",
        label: "constants.parallelApiKey",
        type: "password",
        hint: "constants.parallelHint",
      },
      {
        key: "TAVILY_API_KEY",
        label: "constants.tavilyApiKey",
        type: "password",
        hint: "constants.tavilyHint",
      },
      {
        key: "FIRECRAWL_API_KEY",
        label: "constants.firecrawlApiKey",
        type: "password",
        hint: "constants.firecrawlHint",
      },
      {
        key: "FAL_KEY",
        label: "constants.falKey",
        type: "password",
        hint: "constants.falHint",
      },
      {
        key: "HONCHO_API_KEY",
        label: "constants.honchoApiKey",
        type: "password",
        hint: "constants.honchoHint",
      },
    ],
  },
  {
    title: "constants.sectionBrowserAutomation",
    items: [
      {
        key: "BROWSERBASE_API_KEY",
        label: "constants.browserbaseApiKey",
        type: "password",
        hint: "constants.browserbaseHint",
      },
      {
        key: "BROWSERBASE_PROJECT_ID",
        label: "constants.browserbaseProjectId",
        type: "text",
        hint: "constants.browserbaseProjectHint",
      },
    ],
  },
  {
    title: "constants.sectionVoiceStt",
    items: [
      {
        key: "VOICE_TOOLS_OPENAI_KEY",
        label: "constants.voiceOpenaiKey",
        type: "password",
        hint: "constants.voiceOpenaiHint",
      },
    ],
  },
  {
    title: "constants.sectionResearchTraining",
    items: [
      {
        key: "TINKER_API_KEY",
        label: "constants.tinkerApiKey",
        type: "password",
        hint: "constants.tinkerHint",
      },
      {
        key: "WANDB_API_KEY",
        label: "constants.wandbKey",
        type: "password",
        hint: "constants.wandbHint",
      },
    ],
  },
];

// ── Gateway Sections ────────────────────────────────────

export const GATEWAY_SECTIONS: SectionDef[] = [
  {
    title: "constants.gatewayMessagingPlatforms",
    items: [
      {
        key: "TELEGRAM_BOT_TOKEN",
        label: "constants.telegramBotToken",
        type: "password",
        hint: "constants.telegramBotHint",
      },
      {
        key: "TELEGRAM_ALLOWED_USERS",
        label: "constants.telegramAllowedUsers",
        type: "text",
        hint: "constants.telegramUsersHint",
      },
      {
        key: "DISCORD_BOT_TOKEN",
        label: "constants.discordBotToken",
        type: "password",
        hint: "constants.discordBotHint",
      },
      {
        key: "DISCORD_ALLOWED_CHANNELS",
        label: "constants.discordAllowedChannels",
        type: "text",
        hint: "constants.discordChannelsHint",
      },
      {
        key: "SLACK_BOT_TOKEN",
        label: "constants.slackBotToken",
        type: "password",
        hint: "constants.slackBotHint",
      },
      {
        key: "SLACK_APP_TOKEN",
        label: "constants.slackAppToken",
        type: "password",
        hint: "constants.slackAppHint",
      },
      {
        key: "WHATSAPP_API_URL",
        label: "constants.whatsappApiUrl",
        type: "text",
        hint: "constants.whatsappUrlHint",
      },
      {
        key: "WHATSAPP_API_TOKEN",
        label: "constants.whatsappApiToken",
        type: "password",
        hint: "constants.whatsappTokenHint",
      },
      {
        key: "SIGNAL_PHONE_NUMBER",
        label: "constants.signalPhoneNumber",
        type: "text",
        hint: "constants.signalPhoneHint",
      },
      {
        key: "MATRIX_HOMESERVER",
        label: "constants.matrixHomeserver",
        type: "text",
        hint: "constants.matrixHomeHint",
      },
      {
        key: "MATRIX_USER_ID",
        label: "constants.matrixUserId",
        type: "text",
        hint: "constants.matrixUserHint",
      },
      {
        key: "MATRIX_ACCESS_TOKEN",
        label: "constants.matrixAccessToken",
        type: "password",
        hint: "constants.matrixTokenHint",
      },
      {
        key: "MATTERMOST_URL",
        label: "constants.mattermostUrl",
        type: "text",
        hint: "constants.mattermostUrlHint",
      },
      {
        key: "MATTERMOST_TOKEN",
        label: "constants.mattermostToken",
        type: "password",
        hint: "constants.mattermostTokenHint",
      },
      {
        key: "EMAIL_IMAP_SERVER",
        label: "constants.emailImapServer",
        type: "text",
        hint: "constants.emailImapHint",
      },
      {
        key: "EMAIL_SMTP_SERVER",
        label: "constants.emailSmtpServer",
        type: "text",
        hint: "constants.emailSmtpHint",
      },
      {
        key: "EMAIL_ADDRESS",
        label: "constants.emailAddress",
        type: "text",
        hint: "constants.emailAddrHint",
      },
      {
        key: "EMAIL_PASSWORD",
        label: "constants.emailPassword",
        type: "password",
        hint: "constants.emailPassHint",
      },
      {
        key: "SMS_PROVIDER",
        label: "constants.smsProvider",
        type: "text",
        hint: "constants.smsProviderHint",
      },
      {
        key: "TWILIO_ACCOUNT_SID",
        label: "constants.twilioAccountSid",
        type: "text",
        hint: "constants.twilioSidHint",
      },
      {
        key: "TWILIO_AUTH_TOKEN",
        label: "constants.twilioAuthToken",
        type: "password",
        hint: "constants.twilioTokenHint",
      },
      {
        key: "TWILIO_PHONE_NUMBER",
        label: "constants.twilioPhoneNumber",
        type: "text",
        hint: "constants.twilioPhoneHint",
      },
      {
        key: "BLUEBUBBLES_URL",
        label: "constants.bluebubblesUrl",
        type: "text",
        hint: "constants.bluebubblesUrlHint",
      },
      {
        key: "BLUEBUBBLES_PASSWORD",
        label: "constants.bluebubblesPassword",
        type: "password",
        hint: "constants.bluebubblesPassHint",
      },
      {
        key: "DINGTALK_APP_KEY",
        label: "constants.dingtalkAppKey",
        type: "password",
        hint: "constants.dingtalkKeyHint",
      },
      {
        key: "DINGTALK_APP_SECRET",
        label: "constants.dingtalkAppSecret",
        type: "password",
        hint: "constants.dingtalkSecretHint",
      },
      {
        key: "FEISHU_APP_ID",
        label: "constants.feishuAppId",
        type: "text",
        hint: "constants.feishuIdHint",
      },
      {
        key: "FEISHU_APP_SECRET",
        label: "constants.feishuAppSecret",
        type: "password",
        hint: "constants.feishuSecretHint",
      },
      {
        key: "WECOM_CORP_ID",
        label: "constants.wecomCorpId",
        type: "text",
        hint: "constants.wecomCorpHint",
      },
      {
        key: "WECOM_AGENT_ID",
        label: "constants.wecomAgentId",
        type: "text",
        hint: "constants.wecomAgentHint",
      },
      {
        key: "WECOM_SECRET",
        label: "constants.wecomSecret",
        type: "password",
        hint: "constants.wecomSecretHint",
      },
      {
        key: "WEIXIN_BOT_TOKEN",
        label: "constants.weixinBotToken",
        type: "password",
        hint: "constants.weixinTokenHint",
      },
      {
        key: "WEBHOOK_SECRET",
        label: "constants.webhookSecret",
        type: "password",
        hint: "constants.webhookHint",
      },
      {
        key: "HASS_URL",
        label: "constants.haUrl",
        type: "text",
        hint: "constants.haUrlHint",
      },
      {
        key: "HASS_TOKEN",
        label: "constants.haToken",
        type: "password",
        hint: "constants.haTokenHint",
      },
    ],
  },
];

export interface PlatformDef {
  key: string;
  label: string;
  description: string;
  fields: string[]; // env keys that belong to this platform
}

export const GATEWAY_PLATFORMS: PlatformDef[] = [
  {
    key: "telegram",
    label: "constants.platformTelegram",
    description: "constants.platformTelegramDesc",
    fields: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS"],
  },
  {
    key: "discord",
    label: "constants.platformDiscord",
    description: "constants.platformDiscordDesc",
    fields: ["DISCORD_BOT_TOKEN", "DISCORD_ALLOWED_CHANNELS"],
  },
  {
    key: "slack",
    label: "constants.platformSlack",
    description: "constants.platformSlackDesc",
    fields: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
  },
  {
    key: "whatsapp",
    label: "constants.platformWhatsapp",
    description: "constants.platformWhatsappDesc",
    fields: ["WHATSAPP_API_URL", "WHATSAPP_API_TOKEN"],
  },
  {
    key: "signal",
    label: "constants.platformSignal",
    description: "constants.platformSignalDesc",
    fields: ["SIGNAL_PHONE_NUMBER"],
  },
  {
    key: "matrix",
    label: "constants.platformMatrix",
    description: "constants.platformMatrixDesc",
    fields: ["MATRIX_HOMESERVER", "MATRIX_USER_ID", "MATRIX_ACCESS_TOKEN"],
  },
  {
    key: "mattermost",
    label: "constants.platformMattermost",
    description: "constants.platformMattermostDesc",
    fields: ["MATTERMOST_URL", "MATTERMOST_TOKEN"],
  },
  {
    key: "email",
    label: "constants.platformEmail",
    description: "constants.platformEmailDesc",
    fields: [
      "EMAIL_IMAP_SERVER",
      "EMAIL_SMTP_SERVER",
      "EMAIL_ADDRESS",
      "EMAIL_PASSWORD",
    ],
  },
  {
    key: "sms",
    label: "constants.platformSms",
    description: "constants.platformSmsDesc",
    fields: [
      "SMS_PROVIDER",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
    ],
  },
  {
    key: "bluebubbles",
    label: "constants.platformImessage",
    description: "constants.platformImessageDesc",
    fields: ["BLUEBUBBLES_URL", "BLUEBUBBLES_PASSWORD"],
  },
  {
    key: "dingtalk",
    label: "constants.platformDingtalk",
    description: "constants.platformDingtalkDesc",
    fields: ["DINGTALK_APP_KEY", "DINGTALK_APP_SECRET"],
  },
  {
    key: "feishu",
    label: "constants.platformFeishu",
    description: "constants.platformFeishuDesc",
    fields: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
  },
  {
    key: "wecom",
    label: "constants.platformWecom",
    description: "constants.platformWecomDesc",
    fields: ["WECOM_CORP_ID", "WECOM_AGENT_ID", "WECOM_SECRET"],
  },
  {
    key: "weixin",
    label: "constants.platformWeixin",
    description: "constants.platformWeixinDesc",
    fields: ["WEIXIN_BOT_TOKEN"],
  },
  {
    key: "webhooks",
    label: "constants.platformWebhooks",
    description: "constants.platformWebhooksDesc",
    fields: ["WEBHOOK_SECRET"],
  },
  {
    key: "home_assistant",
    label: "constants.platformHomeAssistant",
    description: "constants.platformHomeAssistantDesc",
    fields: ["HASS_URL", "HASS_TOKEN"],
  },
];

// ── Install ─────────────────────────────────────────────

export const UNIX_INSTALL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash";
export const INSTALL_CMD_UNIX = UNIX_INSTALL_CMD;
export const WINDOWS_INSTALL_CMD =
  "powershell -NoProfile -ExecutionPolicy Bypass -c \"$hermesHome = Join-Path $env:USERPROFILE '.hermes'; $installDir = Join-Path $hermesHome 'hermes-agent'; $installer = [ScriptBlock]::Create((irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 -UseBasicParsing)); & $installer -SkipSetup -HermesHome $hermesHome -InstallDir $installDir\"";
export const INSTALL_CMD =
  typeof window !== "undefined" &&
  window.electron?.process?.platform === "win32"
    ? WINDOWS_INSTALL_CMD
    : UNIX_INSTALL_CMD;

export const INSTALL_CMD_WIN = WINDOWS_INSTALL_CMD;

export function getInstallCmd(): string {
  return window.electron?.process?.platform === "win32"
    ? WINDOWS_INSTALL_CMD
    : UNIX_INSTALL_CMD;
}

// Helper to resolve i18n key or return as-is
export function tk(t: (key: string) => string, value: string): string {
  if (value.startsWith("constants.")) {
    return t(value);
  }
  return value;
}
