/**
 * Pure helpers for the agent-curated memory timeline (idea A4).
 *
 * MEMORY.md is a gateway-shared file with no per-entry metadata, so we do NOT
 * change its format. Instead the timeline derives:
 *   - order: file order (append order ≈ chronological),
 *   - provenance: the most likely originating session, found by full-text
 *     searching past sessions for the entry's distinctive words.
 * This module holds the pure, testable bits; the FTS query + IO live in
 * `src/main/memory-timeline.ts`.
 */

export interface MemoryProvenance {
  sessionId: string;
  title: string | null;
  startedAt: number;
}

export interface TimelineEntry {
  index: number;
  content: string;
  provenance?: MemoryProvenance;
}

export interface MemoryTimeline {
  entries: TimelineEntry[];
}

/** Candidate session (subset of a search result) for provenance pairing. */
export interface ProvenanceCandidate {
  sessionId: string;
  title: string | null;
  startedAt: number;
}

/**
 * Build a compact FTS query from an entry: the most distinctive (longest,
 * deduped) words. Short/common words are dropped so the search targets the
 * memorable nouns of the fact rather than filler.
 */
export function entryQuery(content: string, maxWords = 6): string {
  const words = content
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const unique = Array.from(new Set(words.map((w) => w.toLowerCase())));
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, maxWords).join(" ");
}

/**
 * Pick the most likely originating session from FTS candidates: the EARLIEST
 * match, since a memory is usually written close to when the fact first
 * surfaced. Returns undefined when there are no candidates.
 */
export function pickProvenance(
  candidates: ProvenanceCandidate[],
): MemoryProvenance | undefined {
  if (!candidates.length) return undefined;
  let best = candidates[0];
  for (const c of candidates) {
    if (c.startedAt < best.startedAt) best = c;
  }
  return {
    sessionId: best.sessionId,
    title: best.title,
    startedAt: best.startedAt,
  };
}
