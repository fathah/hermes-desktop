/**
 * Pure prompt assembly for session-search summarization (idea A5).
 *
 * Given a query and the FTS result snippets, build the chat messages that ask
 * the model for a short, cited synthesis. Pure + testable; the gateway call and
 * IO live in `src/main/session-summary.ts`.
 */

export interface SummarySearchResult {
  sessionId: string;
  title: string | null;
  startedAt: number;
  snippet: string;
}

export interface ChatTurn {
  role: "system" | "user";
  content: string;
}

/** Result of a summarize-search call (returned over IPC). */
export interface SearchSummary {
  summary: string;
  sources: SummarySearchResult[];
  error?: string;
}

/** Truncate a snippet so a big result set can't blow the prompt budget. */
function clip(s: string, max = 280): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

/**
 * Build the [system, user] messages for summarizing search hits. Results are
 * numbered [1], [2], … and the model is asked to cite those numbers so the UI
 * can map a claim back to a session.
 */
export function buildSummaryPrompt(
  query: string,
  results: SummarySearchResult[],
): ChatTurn[] {
  const system =
    "You summarize a user's past assistant conversations. You are given " +
    "search snippets, each numbered. Write a concise synthesis (3-6 sentences) " +
    "answering what the conversations say about the query. Cite supporting " +
    "snippets inline as [n]. Do not invent facts not present in the snippets.";

  const lines = results.map((r, i) => {
    const label = r.title || `Session ${r.sessionId.slice(-6)}`;
    return `[${i + 1}] ${label}: ${clip(r.snippet)}`;
  });

  const user =
    `Query: ${query}\n\n` +
    `Search results:\n${lines.join("\n")}\n\n` +
    `Summarize what these conversations say about the query, with [n] citations.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
