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
  [/claude/i, 200000],
  // Google
  [/gemini-1\.5|gemini-2|gemini-3/i, 1048576],
  // Other OpenAI-compatible providers
  [/deepseek/i, 65536],
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
