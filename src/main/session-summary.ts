/**
 * Session-search summarization (idea A5) — main-process IO.
 *
 * Re-runs the FTS search for `query`, builds a cited-summary prompt (pure, in
 * `../shared/searchSummary`), and sends it through one non-streaming gateway
 * completion. Returns the summary plus the cited sources so the renderer can
 * link [n] back to a session.
 */

import { searchSessions } from "./sessions";
import { chatCompletionOnce } from "./hermes";
import {
  buildSummaryPrompt,
  type SummarySearchResult,
  type SearchSummary,
} from "../shared/searchSummary";

export type { SearchSummary };

export async function summarizeSearch(
  query: string,
  profile?: string,
  limit = 8,
): Promise<SearchSummary> {
  const trimmed = (query || "").trim();
  if (!trimmed) return { summary: "", sources: [] };

  const hits = searchSessions(trimmed, limit);
  const sources: SummarySearchResult[] = hits.map((h) => ({
    sessionId: h.sessionId,
    title: h.title,
    startedAt: h.startedAt,
    snippet: h.snippet,
  }));

  if (sources.length === 0) {
    return { summary: "", sources: [] };
  }

  const messages = buildSummaryPrompt(trimmed, sources);
  const { content, error } = await chatCompletionOnce(messages, profile);
  return { summary: content, sources, error };
}
