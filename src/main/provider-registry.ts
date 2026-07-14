/**
 * Canonical inference base URLs for built-in providers — mirrors
 * hermes-agent's `PROVIDER_REGISTRY` defaults.
 *
 * Lives in its own module (not in `model-discovery.ts` or `config.ts`)
 * to avoid a circular import: `model-discovery` already depends on
 * `config` for `readEnv`, and `config` needs this lookup for
 * `setModelConfig` to write the right `base_url:` when the user picks a
 * built-in provider entry that doesn't carry a baseUrl of its own.
 *
 * Only providers whose `/v1/chat/completions` endpoint we trust are
 * listed; anything else (`custom`, `auto`, OAuth-only providers,
 * user-defined entries) falls back to caller-supplied baseUrl.
 */
export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  "ollama-cloud": "https://ollama.com/v1",
  aimlapi: "https://api.aimlapi.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  atlascloud: "https://api.atlascloud.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  perplexity: "https://api.perplexity.ai",
  huggingface: "https://router.huggingface.co/v1",
  // The agent's default is the INTERNATIONAL endpoint — this entry must
  // mirror it: setModelConfig fills an empty base_url from this registry,
  // so a CN value here would silently repoint existing intl users' keys at
  // the mainland endpoint. The mainland-first choice lives in the UI picker
  // (DASHSCOPE_ENDPOINTS in renderer constants), which writes base_url
  // explicitly when the user selects it.
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  xiaomi: "https://api.xiaomimimo.com/v1",
  zai: "https://api.z.ai/api/paas/v4",
  anthropic: "https://api.anthropic.com/v1",
  lmstudio: "http://localhost:1234/v1",
  atomicchat: "http://localhost:1337/v1",
  ollama: "http://localhost:11434/v1",
  vllm: "http://localhost:8000/v1",
  llamacpp: "http://localhost:8080/v1",
};

/**
 * Look up the canonical inference base URL for a built-in provider id.
 * Returns null when the provider isn't in the registry (e.g. `custom`,
 * `auto`, or anything user-defined).
 */
export function canonicalProviderBaseUrl(provider: string): string | null {
  const direct = PROVIDER_BASE_URLS[provider.toLowerCase()];
  return direct ?? null;
}
