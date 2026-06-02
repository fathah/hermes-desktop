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
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  cerebras: "https://api.cerebras.ai/v1",
  perplexity: "https://api.perplexity.ai",
  huggingface: "https://router.huggingface.co/v1",
  "kimi-coding": "https://api.moonshot.ai/v1",
  zai: "https://api.z.ai/api/paas/v4",
  glm: "https://api.z.ai/api/paas/v4",
  anthropic: "https://api.anthropic.com/v1",
  xai: "https://api.x.ai/v1",
  "xai-oauth": "https://api.x.ai/v1",
  "qwen-oauth": "https://portal.qwen.ai/v1",
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
