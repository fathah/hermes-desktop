/**
 * Federated search aggregator (main-side). Fans out one query to the three FTS5
 * stores in PARALLEL, normalizes each hit to a common {@link FederatedCandidate},
 * and delegates merge/rank to the PURE {@link rankFederatedHits}. A failing or
 * empty source (e.g. sessions under SSH) contributes nothing — `allSettled` keeps
 * the merge resilient. Redaction is already applied at index time for transcripts,
 * so hits are safe to surface (the UI still fences them).
 */
import { basename } from "path";
import { getSpsNoteIndex } from "./note-index";
import { getExternalContextDb } from "./external-context/index";
import { searchSessions } from "./sessions";
import {
  rankFederatedHits,
  stripSnippetMarkers,
  type FederatedCandidate,
  type FederatedHit,
  type FederatedSearchOpts,
} from "../shared/federated-search";
import { EXTERNAL_SOURCE_LABELS } from "../shared/external-context";

function settledOr<T>(result: PromiseSettledResult<T[]>, fallback: T[]): T[] {
  return result.status === "fulfilled" ? result.value : fallback;
}

function noteTitle(title: string, path: string): string {
  if (title.trim()) return title;
  return basename(path, ".md");
}

export async function federatedSearch(
  query: string,
  opts: FederatedSearchOpts = {},
  profile?: string,
): Promise<FederatedHit[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];

  const perSourceCap = opts.perSourceCap ?? 10;
  // Fetch a pool larger than the cap so a recency boost can promote a newer hit
  // that ranked slightly lower; the pure ranker trims back to perSourceCap.
  const pool = Math.min(perSourceCap * 3, 50);

  const [notesResult, sessionsResult, transcriptsResult] =
    await Promise.allSettled([
      (async () => {
        const index = await getSpsNoteIndex(profile);
        return index.search(cleaned, pool);
      })(),
      Promise.resolve().then(() => searchSessions(cleaned, pool)),
      Promise.resolve().then(() =>
        getExternalContextDb().search(cleaned, { limit: pool }),
      ),
    ]);

  const notes: FederatedCandidate[] = settledOr(notesResult, []).map((hit) => ({
    kind: "note",
    title: noteTitle(hit.title, hit.path),
    snippet: stripSnippetMarkers(hit.snippet),
    ts: hit.mtime ?? null,
    ref: { path: hit.path },
  }));

  const sessions: FederatedCandidate[] = settledOr(sessionsResult, []).map(
    (row) => ({
      kind: "session",
      title: row.title?.trim() || "Untitled session",
      snippet: stripSnippetMarkers(row.snippet),
      ts: row.startedAt,
      ref: { sessionId: row.sessionId },
    }),
  );

  const transcripts: FederatedCandidate[] = settledOr(
    transcriptsResult,
    [],
  ).map((hit) => ({
    kind: "transcript",
    title: hit.title?.trim() || EXTERNAL_SOURCE_LABELS[hit.source],
    snippet: stripSnippetMarkers(hit.snippet),
    ts: hit.ts,
    source: hit.source,
    ref: {
      convId: hit.convId,
      seq: hit.seq,
      projectPath: hit.projectPath,
      gitBranch: hit.gitBranch,
    },
  }));

  return rankFederatedHits({ notes, sessions, transcripts }, opts);
}
