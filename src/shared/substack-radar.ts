export interface SubstackRadarVisibleSignals {
  subscriberText?: string;
  badgeText?: string;
  postCountText?: string;
  recommendationText?: string;
}

export type SubstackRadarRunStatus = "running" | "complete" | "failed";
export type SubstackRadarCandidateStatus = "new" | "approved" | "rejected";

export interface SubstackRadarCandidate {
  id: string;
  publicationUrl: string;
  feedUrl?: string;
  title: string;
  description: string;
  author?: string;
  category: string;
  visibleSignals: SubstackRadarVisibleSignals;
  sourcePageUrl: string;
  discoveredAt: number;
  score: number;
  status: SubstackRadarCandidateStatus;
}

export interface SubstackRadarRun {
  id: string;
  query: string;
  categories: string[];
  status: SubstackRadarRunStatus;
  startedAt: number;
  finishedAt?: number;
  sourceUrls: string[];
  candidates: SubstackRadarCandidate[];
  error?: string;
}

export type SubstackRadarDiscoveredFeed =
  | {
      ok: true;
      feedUrl: string;
      siteUrl: string;
      title: string;
      description: string;
      sourceType: "substack";
    }
  | {
      ok: false;
      error: string;
    };

export interface SubstackRadarApprovedFeed {
  candidateId: string;
  feed: SubstackRadarDiscoveredFeed;
}

export interface SubstackRadarAddApprovedFeedsResult {
  added: number;
  feeds: SubstackRadarApprovedFeed[];
}

export interface SubstackRadarScoreInput {
  title: string;
  description: string;
  visibleSignals: SubstackRadarVisibleSignals;
}

export function normalizeSubstackRadarCategories(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function buildSubstackRadarCandidateId(publicationUrl: string): string {
  const url = new URL(publicationUrl);
  url.search = "";
  url.hash = "";
  return `substack-radar:${url.toString()}`;
}

function parseVisibleCount(text: string | undefined): number {
  if (!text) return 0;
  const match = text.match(
    /(\d+(?:[,\s]\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kKmM])?/,
  );
  if (!match) return 0;
  const value = Number(match[1].replace(/[,\s]/g, ""));
  if (!Number.isFinite(value)) return 0;
  const suffix = match[2]?.toLowerCase();
  if (suffix === "m") return value * 1_000_000;
  if (suffix === "k") return value * 1_000;
  return value;
}

export function scoreSubstackRadarCandidate(
  input: SubstackRadarScoreInput,
): number {
  let score = 50;
  if (input.title.trim()) score += 8;
  if (input.description.trim().length > 20) score += 10;
  const subscribers = parseVisibleCount(input.visibleSignals.subscriberText);
  if (subscribers >= 100_000) score += 24;
  else if (subscribers >= 10_000) score += 18;
  else if (subscribers >= 1_000) score += 10;
  if (
    /bestseller|recommended|featured/i.test(
      input.visibleSignals.badgeText || "",
    )
  ) {
    score += 6;
  }
  return Math.max(0, Math.min(100, score));
}
