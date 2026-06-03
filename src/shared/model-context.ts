/**
 * Model context-length lookup (idea A3 / Phase 0c).
 *
 * The repo has no model-metadata source, so a context-fill gauge needs its own
 * model → max-context-window map. This module provides:
 *   - a curated table of known model families,
 *   - a family heuristic fallback (so unseen-but-recognizable ids still work),
 *   - an optional override map (e.g. resolved from gateway config / models.dev),
 *   - and fill-percentage math.
 *
 * Pure and dependency-free so it can be unit tested and reused in either
 * process.
 */

/** Used when a model is completely unrecognized. Deliberately conservative. */
export const DEFAULT_CONTEXT_LENGTH = 128_000;

/**
 * Curated exact/substring table, checked after normalization. Keys are matched
 * as substrings of the normalized model id, longest key first so that more
 * specific ids (e.g. "gpt-4o-mini") win over shorter ones ("gpt-4o").
 */
const KNOWN_CONTEXT_LENGTHS: Record<string, number> = {
  // Anthropic Claude — 200k across the 4.x line
  "claude-opus": 200_000,
  "claude-sonnet": 200_000,
  "claude-haiku": 200_000,
  "claude-3": 200_000,
  claude: 200_000,
  // OpenAI
  "gpt-5": 400_000,
  "gpt-4.1": 1_000_000,
  "gpt-4o-mini": 128_000,
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  o1: 200_000,
  o3: 200_000,
  // Google Gemini
  "gemini-3": 1_000_000,
  "gemini-2.5": 1_000_000,
  "gemini-1.5-pro": 2_000_000,
  "gemini-1.5": 1_000_000,
  gemini: 1_000_000,
  // DeepSeek
  "deepseek-v3": 128_000,
  "deepseek-r1": 128_000,
  deepseek: 64_000,
  // Qwen / Alibaba
  qwen3: 128_000,
  "qwen2.5": 128_000,
  qwen: 32_000,
  // Meta Llama
  "llama-4": 1_000_000,
  "llama-3.1": 128_000,
  "llama-3": 8_000,
  // Mistral
  "mistral-large": 128_000,
  mistral: 32_000,
  // Moonshot / Kimi
  kimi: 200_000,
  moonshot: 128_000,
  // MiniMax
  minimax: 1_000_000,
};

/**
 * Family heuristics applied only when the table misses. Broad, last-resort
 * matches keyed by a substring of the normalized id.
 */
const FAMILY_FALLBACKS: Array<[string, number]> = [
  ["claude", 200_000],
  ["gemini", 1_000_000],
  ["gpt", 128_000],
  ["llama", 128_000],
  ["qwen", 32_000],
  ["mistral", 32_000],
];

/** Lowercase, trim, and collapse separators for stable matching. */
export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
}

/** Strip a provider prefix ("anthropic/claude-…" → "claude-…"). */
function withoutProvider(normalized: string): string {
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export interface ContextLengthOpts {
  /** Override map (raw or normalized model id → context tokens). Wins over all. */
  overrides?: Record<string, number>;
}

/**
 * Resolve a model's max context window. Resolution order:
 *   1. override map (exact, then normalized, then provider-stripped),
 *   2. curated table (substring match, longest key first),
 *   3. family heuristic,
 *   4. DEFAULT_CONTEXT_LENGTH.
 */
export function getContextLength(
  model: string | undefined | null,
  opts?: ContextLengthOpts,
): number {
  if (!model) return DEFAULT_CONTEXT_LENGTH;
  const normalized = normalizeModelId(model);
  const bare = withoutProvider(normalized);

  const overrides = opts?.overrides;
  if (overrides) {
    for (const key of [model, normalized, bare]) {
      const hit = overrides[key];
      if (typeof hit === "number" && Number.isFinite(hit) && hit > 0) {
        return hit;
      }
    }
  }

  const keysByLength = Object.keys(KNOWN_CONTEXT_LENGTHS).sort(
    (a, b) => b.length - a.length,
  );
  for (const key of keysByLength) {
    if (bare.includes(key)) return KNOWN_CONTEXT_LENGTHS[key];
  }

  for (const [needle, len] of FAMILY_FALLBACKS) {
    if (bare.includes(needle)) return len;
  }

  return DEFAULT_CONTEXT_LENGTH;
}

/** True when the model was matched explicitly (not via DEFAULT fallback). */
export function isKnownModel(
  model: string | undefined | null,
  opts?: ContextLengthOpts,
): boolean {
  if (!model) return false;
  const normalized = normalizeModelId(model);
  const bare = withoutProvider(normalized);
  if (opts?.overrides) {
    for (const key of [model, normalized, bare]) {
      const hit = opts.overrides[key];
      if (typeof hit === "number" && hit > 0) return true;
    }
  }
  if (Object.keys(KNOWN_CONTEXT_LENGTHS).some((k) => bare.includes(k))) {
    return true;
  }
  return FAMILY_FALLBACKS.some(([needle]) => bare.includes(needle));
}

/**
 * Fraction of the context window consumed, clamped to [0, 1]. Returns 0 for
 * non-positive usage and never exceeds 1 (overflow shows as full).
 */
export function contextFillFraction(
  usedTokens: number,
  model: string | undefined | null,
  opts?: ContextLengthOpts,
): number {
  if (!Number.isFinite(usedTokens) || usedTokens <= 0) return 0;
  const limit = getContextLength(model, opts);
  if (limit <= 0) return 0;
  return Math.min(1, usedTokens / limit);
}

/** Fill as an integer percentage in [0, 100]. */
export function contextFillPercent(
  usedTokens: number,
  model: string | undefined | null,
  opts?: ContextLengthOpts,
): number {
  return Math.round(contextFillFraction(usedTokens, model, opts) * 100);
}
