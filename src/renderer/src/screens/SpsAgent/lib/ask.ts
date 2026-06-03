// ask.ts — pure workspace-search for the Personal-Agent "Ask" panel (Phase 3).
// Searches SPS pages (title + block text) for a query and returns ranked hits
// with a snippet. The cross-session cited answer comes from the gateway via
// `summarizeSearch` (shared/searchSummary); this is the local workspace half.

import type { Block, PageMeta } from "../types";

export interface PageHit {
  pageId: string;
  title: string;
  snippet: string;
}

/** Plain text of a page's blocks, joined (blocks already store a `text` field). */
function pageBodyText(blocks: Block[] | undefined): string {
  if (!blocks) return "";
  return blocks
    .map((b) => b.text || "")
    .filter(Boolean)
    .join("  ");
}

/** A snippet of `body` around the first match of `q` (case-insensitive). */
function snippetAround(body: string, q: string, radius = 60): string {
  const idx = body.toLowerCase().indexOf(q);
  if (idx < 0) return body.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + q.length + radius);
  const core = body.slice(start, end).trim();
  return (start > 0 ? "…" : "") + core + (end < body.length ? "…" : "");
}

/**
 * Search workspace pages. A page matches if the query (trimmed, lowercased) is a
 * substring of its title or body. Title matches rank above body matches; results
 * are capped at `limit`.
 */
export function searchWorkspacePages(
  query: string,
  docs: Record<string, Block[]>,
  meta: Record<string, PageMeta>,
  limit = 8,
): PageHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const titleHits: PageHit[] = [];
  const bodyHits: PageHit[] = [];

  for (const pageId of Object.keys(docs)) {
    const title = meta[pageId]?.title || "Untitled";
    const body = pageBodyText(docs[pageId]);
    const inTitle = title.toLowerCase().includes(q);
    const inBody = body.toLowerCase().includes(q);
    if (!inTitle && !inBody) continue;
    const hit: PageHit = {
      pageId,
      title,
      snippet: inBody ? snippetAround(body, q) : title,
    };
    (inTitle ? titleHits : bodyHits).push(hit);
  }

  return [...titleHits, ...bodyHits].slice(0, limit);
}
