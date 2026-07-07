export const PROVIDERS_WITHOUT_API_KEYS = new Set([
  "custom",
  "lmstudio",
  "ollama",
  "vllm",
  "llamacpp",
  "openai-codex",
  "xai-oauth",
  "qwen-oauth",
  "google-gemini-cli",
  "minimax-oauth",
  "vertex",
]);

export function providerDoesNotNeedApiKey(provider: string): boolean {
  return PROVIDERS_WITHOUT_API_KEYS.has(provider);
}
