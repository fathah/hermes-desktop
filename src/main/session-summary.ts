/**
 * Session-search summarization (idea A5) — main-process IO.
 *
 * Re-runs the FTS search for `query`, builds a cited-summary prompt (pure, in
 * `../shared/searchSummary`), and sends it through one non-streaming gateway
 * completion. Returns the summary plus the cited sources so the renderer can
 * link [n] back to a session.
 */

import { searchSessions } from "./sessions";
import { chatCompletionOnce, chatCompletionStream } from "./hermes";
import {
  buildSummaryPrompt,
  type SummarySearchResult,
  type SearchSummary,
} from "../shared/searchSummary";

export type { SearchSummary };

/** Resolve the cited sources for a query (the FTS hits feeding the summary). */
function resolveSources(query: string, limit: number): SummarySearchResult[] {
  const hits = searchSessions(query, limit);
  return hits.map((h) => ({
    sessionId: h.sessionId,
    title: h.title,
    startedAt: h.startedAt,
    snippet: h.snippet,
  }));
}

export async function summarizeSearch(
  query: string,
  profile?: string,
  limit = 8,
): Promise<SearchSummary> {
  const trimmed = (query || "").trim();
  if (!trimmed) return { summary: "", sources: [] };

  const sources = resolveSources(trimmed, limit);
  if (sources.length === 0) {
    return { summary: "", sources: [] };
  }

  const messages = buildSummaryPrompt(trimmed, sources);
  const { content, error } = await chatCompletionOnce(messages, profile);
  return { summary: content, sources, error };
}

/**
 * Streaming variant of {@link summarizeSearch}: identical inputs/output, but the
 * synthesis is streamed token-by-token through `onChunk` (the IPC handler relays
 * those to the renderer) so the Ask-pane answer fills in live instead of
 * appearing all at once. Resolves with the full summary + cited sources at the
 * end (or with whatever streamed so far plus `error`).
 */
export function summarizeSearchStream(
  query: string,
  onChunk: (text: string) => void,
  profile?: string,
  limit = 8,
): Promise<SearchSummary> {
  const trimmed = (query || "").trim();
  if (!trimmed) return Promise.resolve({ summary: "", sources: [] });

  const sources = resolveSources(trimmed, limit);
  if (sources.length === 0) {
    return Promise.resolve({ summary: "", sources: [] });
  }

  const messages = buildSummaryPrompt(trimmed, sources);
  return new Promise((resolve) => {
    let acc = "";
    chatCompletionStream(
      messages,
      {
        onChunk: (text) => {
          acc += text;
          onChunk(text);
        },
        onDone: () => resolve({ summary: acc, sources }),
        onError: (error) => resolve({ summary: acc, sources, error }),
      },
      profile,
    );
  });
}
