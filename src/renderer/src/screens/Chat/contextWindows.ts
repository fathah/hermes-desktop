/**
 * Best-effort context-window sizes (in tokens) for the models the desktop
 * commonly targets. Used by the context gauge to turn the latest turn's
 * prompt-token count into a "% of context used" figure.
 *
 * This is a heuristic lookup, not authoritative — the gateway doesn't surface
 * the active model's context window over the chat API, so we map by a
 * case-insensitive substring of the model id (first match wins) and fall back
 * to a sane default for anything we haven't catalogued.
 */
const CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  // Groq's production lineup (Llama 3.1/3.3, GPT-OSS) — all 131,072.
  [/llama-3\.[13]/i, 131072],
  [/llama-4/i, 131072],
  [/gpt-oss/i, 131072],
  [/mixtral/i, 32768],
  // OpenAI
  [/gpt-4o|gpt-4\.1|gpt-4-turbo|^o[1-4]|gpt-5/i, 128000],
  [/gpt-3\.5/i, 16385],
  // Anthropic
  // Mythos-class named models (claude-fable-5, …) — 1M context. Must come
  // before the generic /claude/ rule (first match wins).
  [/claude-fable/i, 1000000],
  [/claude/i, 200000],
  // Google
  [/gemini-1\.5|gemini-2|gemini-3/i, 1048576],
  // Other OpenAI-compatible providers
  // DeepSeek's API models (deepseek-chat / deepseek-reasoner, V3.x) advertise
  // a 128K context — not 64K (the old "65.5k" the gauge wrongly showed) nor 1M.
  // Issue #597. Providers that expose `context_length` over /models override
  // this via authoritative detection; this is only the fallback.
  [/deepseek/i, 131072],
  [/agnes/i, 262144],
  // Moonshot's Kimi K2 family — 256K context.
  [/kimi|moonshot/i, 262144],
  [/qwen/i, 32768],
  [/mistral/i, 32768],
];

/** Fallback when the model id doesn't match any known family. */
export const DEFAULT_CONTEXT_WINDOW = 131072;

export function contextWindowForModel(model?: string | null): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  for (const [pattern, size] of CONTEXT_WINDOWS) {
    if (pattern.test(model)) return size;
  }
  return DEFAULT_CONTEXT_WINDOW;
}
