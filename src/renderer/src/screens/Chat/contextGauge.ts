/**
 * Pure helpers for the context-budget gauge and compression marker (idea A3).
 * Kept dependency-free for unit testing; the model→context-length math lives in
 * renderer lib/model-context.
 */

import { contextFillPercent, getContextLength } from "../../lib/model-context";

/** Compact token count: 1500 → "1.5k", 200000 → "200k". */
export function formatTokensShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return k >= 100 || Number.isInteger(k)
    ? `${Math.round(k)}k`
    : `${k.toFixed(1)}k`;
}

export type ContextLevel = "ok" | "warn" | "high";

/** Threshold buckets driving the gauge color (mirror gateway 70%/90% warnings). */
export function contextLevel(percent: number): ContextLevel {
  if (percent >= 90) return "high";
  if (percent >= 70) return "warn";
  return "ok";
}

export interface ContextGaugeInfo {
  percent: number;
  limit: number;
  level: ContextLevel;
  label: string;
}

/** Derive everything the gauge needs from the latest prompt token count. */
export function contextGaugeInfo(
  promptTokens: number,
  model: string | undefined | null,
): ContextGaugeInfo {
  const percent = contextFillPercent(promptTokens, model);
  const limit = getContextLength(model);
  return {
    percent,
    limit,
    level: contextLevel(percent),
    label: `${percent}% of ${formatTokensShort(limit)}`,
  };
}

/**
 * Heuristic: does this assistant/system text look like a compression summary?
 * The gateway inserts a structured summary (Goal / Progress / Decisions /
 * Files / Next Steps) when it compacts context. Conservative — requires the
 * word "summary" plus at least two of the known section headers — so ordinary
 * messages that happen to say "summary" don't get flagged.
 */
export function isCompressionSummary(text: string): boolean {
  if (!text) return false;
  if (!/summary/i.test(text)) return false;
  const sections = [
    /goal/i,
    /progress/i,
    /decisions/i,
    /files/i,
    /next steps/i,
  ];
  const hits = sections.filter((re) => re.test(text)).length;
  return hits >= 2;
}
