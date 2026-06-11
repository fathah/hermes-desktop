/**
 * Shared types + PURE ranking for federated search — one query merged across the
 * three knowledge stores (vault notes, imported external transcripts, Hermes chat
 * sessions). Pure data + arithmetic only (no Node/Electron/sqlite), so it is safe
 * to import from both the main process and the renderer and is directly
 * vitest-testable with synthetic per-source results.
 *
 * Why position-based relevance: none of the three FTS5 sources project a numeric
 * score (all `ORDER BY rank`), so we derive relevance from each hit's rank
 * POSITION within its source list, then blend a recency boost.
 */
import type { ExternalSource } from "./external-context";

/** One merged, ranked, clickable hit. Discriminated by `kind`; `ref` carries the
 *  open-target the host surface routes on. */
export type FederatedHit =
  | {
      kind: "note";
      title: string;
      snippet: string;
      ts: number | null;
      score: number;
      ref: { path: string };
    }
  | {
      kind: "session";
      title: string;
      snippet: string;
      ts: number | null;
      score: number;
      ref: { sessionId: string };
    }
  | {
      kind: "transcript";
      title: string;
      snippet: string;
      ts: number | null;
      score: number;
      source: ExternalSource;
      ref: {
        convId: string;
        seq: number;
        projectPath: string | null;
        gitBranch: string | null;
      };
    };

/** A candidate before scoring — a {@link FederatedHit} minus its computed score. */
export type FederatedCandidate =
  | Omit<Extract<FederatedHit, { kind: "note" }>, "score">
  | Omit<Extract<FederatedHit, { kind: "session" }>, "score">
  | Omit<Extract<FederatedHit, { kind: "transcript" }>, "score">;

/** Candidates grouped by source, each list already in FTS rank order (best first). */
export interface FederatedCandidates {
  notes: FederatedCandidate[];
  sessions: FederatedCandidate[];
  transcripts: FederatedCandidate[];
}

export interface FederatedSearchOpts {
  /** Total cap on returned hits (default 30). */
  limit?: number;
  /** Max hits kept per source before the final merge (default 10). */
  perSourceCap?: number;
  /** Weight of rank-position relevance in the blended score (default 0.7). */
  relevanceWeight?: number;
  /** Weight of recency in the blended score (default 0.3). */
  recencyWeight?: number;
}

const DEFAULTS = {
  limit: 30,
  perSourceCap: 10,
  relevanceWeight: 0.7,
  recencyWeight: 0.3,
};

// Stable tie-break ordering when score + ts are equal.
const KIND_ORDER: Record<FederatedHit["kind"], number> = {
  note: 0,
  session: 1,
  transcript: 2,
};

/** Strip FTS5 snippet highlight markers (note `⟦⟧`, session `<<>>`) to plain text
 *  so a merged list reads uniformly. External hits have no markers already. */
export function stripSnippetMarkers(snippet: string): string {
  return snippet.replace(/[⟦⟧]/g, "").replace(/<<|>>/g, "");
}

/**
 * Blend rank-position relevance with a recency boost, cap per source, merge, and
 * sort. PURE — no I/O. Within each source, relevance = 1 − i/len (best = highest);
 * recency = min-max normalized `ts` across ALL candidates (null `ts` → 0).
 */
export function rankFederatedHits(
  candidates: FederatedCandidates,
  opts: FederatedSearchOpts = {},
): FederatedHit[] {
  const limit = opts.limit ?? DEFAULTS.limit;
  const perSourceCap = opts.perSourceCap ?? DEFAULTS.perSourceCap;
  const relW = opts.relevanceWeight ?? DEFAULTS.relevanceWeight;
  const recW = opts.recencyWeight ?? DEFAULTS.recencyWeight;

  const groups = [
    candidates.notes,
    candidates.sessions,
    candidates.transcripts,
  ];

  // Global recency bounds across every candidate that carries a timestamp.
  const timestamps: number[] = [];
  for (const group of groups) {
    for (const candidate of group) {
      if (candidate.ts != null) timestamps.push(candidate.ts);
    }
  }
  const minTs = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTs = timestamps.length ? Math.max(...timestamps) : 0;
  const span = maxTs - minTs;

  const recencyOf = (ts: number | null): number => {
    if (ts == null) return 0;
    if (span <= 0) return 1;
    return (ts - minTs) / span;
  };

  const relevanceOf = (index: number, length: number): number => {
    if (length <= 1) return 1;
    return 1 - index / length;
  };

  // Score each candidate, then keep the top `perSourceCap` of each source.
  const merged: FederatedHit[] = [];
  for (const group of groups) {
    const length = group.length;
    const scored = group.map((candidate, index) => {
      const relevance = relevanceOf(index, length);
      const recency = recencyOf(candidate.ts);
      const score = relW * relevance + recW * recency;
      return { ...candidate, score } as FederatedHit;
    });
    scored.sort(byRank);
    merged.push(...scored.slice(0, perSourceCap));
  }

  merged.sort(byRank);
  return merged.slice(0, limit);
}

/** Descending score; tie → newer `ts` first (null last); tie → stable kind order. */
function byRank(a: FederatedHit, b: FederatedHit): number {
  if (b.score !== a.score) return b.score - a.score;
  const aTs = a.ts ?? -Infinity;
  const bTs = b.ts ?? -Infinity;
  if (bTs !== aTs) return bTs - aTs;
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}
