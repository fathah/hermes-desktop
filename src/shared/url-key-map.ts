/**
 * Single source of truth for "given an OpenAI-compatible base URL, which
 * env var holds the provider's API key?"
 *
 * Used in three places that were previously each maintaining their own
 * copy of this table:
 *   - Main process: gateway spawn env hydration (hermes.ts)
 *   - Renderer: Edit Model dialog (Models.tsx)
 *   - Renderer: Setup wizard's custom-host path (Setup.tsx)
 *
 * The patterns intentionally match by hostname substring (case-insensitive)
 * so paths like `/v1`, `/openai/v1`, `/api/codex/v1` all resolve to the
 * same provider. Order matters only for overlapping hosts (none today).
 *
 * The fallback `CUSTOM_API_KEY` is what we write for any base URL the
 * desktop doesn't recognise — e.g. a self-hosted reverse proxy or a
 * brand-new provider that we haven't taught the URL_KEY_MAP about yet.
 */

export interface UrlKeyMapping {
  pattern: RegExp;
  envKey: string;
}

export const URL_KEY_MAP: ReadonlyArray<UrlKeyMapping> = [
  { pattern: /openrouter\.ai/i, envKey: "OPENROUTER_API_KEY" },
  { pattern: /anthropic\.com/i, envKey: "ANTHROPIC_API_KEY" },
  { pattern: /openai\.com/i, envKey: "OPENAI_API_KEY" },
  { pattern: /huggingface\.co/i, envKey: "HF_TOKEN" },
  { pattern: /api\.groq\.com/i, envKey: "GROQ_API_KEY" },
  { pattern: /api\.deepseek\.com/i, envKey: "DEEPSEEK_API_KEY" },
  { pattern: /api\.together\.xyz/i, envKey: "TOGETHER_API_KEY" },
  { pattern: /api\.fireworks\.ai/i, envKey: "FIREWORKS_API_KEY" },
  { pattern: /api\.cerebras\.ai/i, envKey: "CEREBRAS_API_KEY" },
  { pattern: /api\.mistral\.ai/i, envKey: "MISTRAL_API_KEY" },
  { pattern: /api\.perplexity\.ai/i, envKey: "PERPLEXITY_API_KEY" },
];

export const CUSTOM_API_KEY_ENV = "CUSTOM_API_KEY";

/**
 * Resolve the env var name that should hold the API key for `url`.
 * Returns `CUSTOM_API_KEY` if the URL doesn't match any known provider.
 *
 * Empty / null URL returns `CUSTOM_API_KEY` (a safe writable default for
 * uninitialised forms — callers can still detect "no URL" upstream).
 */
export function expectedEnvKeyForUrl(url: string | null | undefined): string {
  if (!url) return CUSTOM_API_KEY_ENV;
  for (const { pattern, envKey } of URL_KEY_MAP) {
    if (pattern.test(url)) return envKey;
  }
  return CUSTOM_API_KEY_ENV;
}

/**
 * `true` iff the URL points at a known commercial OpenAI-compatible
 * provider that we have a dedicated env var for. Useful for "do we have
 * a canonical key location for this URL or are we falling back to the
 * generic CUSTOM_API_KEY bucket?" checks (e.g. health-audit warnings).
 */
export function isKnownProviderUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return URL_KEY_MAP.some(({ pattern }) => pattern.test(url));
}

/**
 * `true` iff the URL points at a local/private host that commonly runs
 * without provider API-key auth (LM Studio, Ollama, LAN gateways, etc.).
 */
export function isLocalBaseUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(
    url,
  );
}

/**
 * Provider ids the runtime routes through its OpenAI-compatible "custom
 * endpoint" path (see sendMessageViaCli in hermes.ts). For these, the gateway
 * resolves the upstream key from a fallback chain — URL-specific key →
 * CUSTOM_PROVIDER_<name>_KEY → CUSTOM_API_KEY → OPENAI_API_KEY — rather than
 * insisting on the URL-derived key. Single source of truth so the gateway
 * spawn, the pre-send readiness check, and the config-health audit all agree
 * on which providers get that treatment.
 *
 * The remote entries must stay in sync with the `id` of remote-group entries
 * in the renderer's `LOCAL_PRESETS`.
 */
export const OPENAI_COMPAT_PROVIDERS: ReadonlySet<string> = new Set([
  // Generic
  "custom",
  // Local LLMs
  "lmstudio",
  "ollama",
  "vllm",
  "llamacpp",
  // Built-in remote OpenAI-compatible providers
  "groq",
  "deepseek",
  "together",
  "fireworks",
  "cerebras",
  "mistral",
]);
