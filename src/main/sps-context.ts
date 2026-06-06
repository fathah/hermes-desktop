// sps-context.ts — compounding context for the SPS Agent assistant (Milestone 1A).
//
// The single highest-leverage upgrade from the agentic-workflow roadmap: every
// assistant run should be grounded in the user's OWN vault + memory, so each run
// is smarter than the last (article hack #14, "your notes are your agent's
// knowledge base"). Today `spsAssistant` only sees the current page; this module
// retrieves the most relevant prior notes (FTS over the rebuildable note-index)
// and the user's long-term memory, and renders a compact, token-budgeted preamble.
//
// ABI NOTE: the note-index + memory both open `better-sqlite3`, which is compiled
// for Electron's node ABI and CANNOT load under vitest. So the DB-touching code is
// behind a DYNAMIC import inside `assembleVaultContext`; the top of this file stays
// dependency-free and the pure `formatVaultContext` helper is unit-testable.

/** One related note surfaced from the vault index. */
export interface VaultHit {
  title: string;
  snippet: string;
  path: string;
}

/** Everything the formatter needs — pure data, no I/O. */
export interface VaultContextInput {
  hits: VaultHit[];
  memoryEntries: string[];
  vaultPath?: string;
}

const MAX_CONTEXT_CHARS = 4000;
const MAX_SNIPPET_CHARS = 240;
const MAX_MEMORY_ENTRY_CHARS = 280;
const MAX_HITS = 6;
const MAX_MEMORY_ENTRIES = 8;

/** Collapse the FTS snippet markers and whitespace into a single tidy line. */
function tidySnippet(snippet: string): string {
  const unmarked = snippet.replace(/[⟦⟧]/g, "");
  const collapsed = unmarked.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_SNIPPET_CHARS) return collapsed;
  return collapsed.slice(0, MAX_SNIPPET_CHARS).trimEnd() + "…";
}

/** Clamp a single memory entry to one budgeted line. */
function tidyMemoryEntry(entry: string): string {
  const collapsed = entry.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_MEMORY_ENTRY_CHARS) return collapsed;
  return collapsed.slice(0, MAX_MEMORY_ENTRY_CHARS).trimEnd() + "…";
}

/**
 * Render the retrieved context into a system-message preamble. PURE — given the
 * same input it returns the same string. Returns "" when there is nothing to add
 * so the caller can skip injecting an empty system message.
 */
export function formatVaultContext(input: VaultContextInput): string {
  const sections: string[] = [];

  const hits = input.hits.slice(0, MAX_HITS);
  if (hits.length > 0) {
    const lines = hits.map((hit) => {
      const title = hit.title?.trim() || hit.path;
      const snippet = tidySnippet(hit.snippet || "");
      return snippet ? `- ${title}: ${snippet}` : `- ${title}`;
    });
    sections.push(`Relevant notes from this workspace:\n${lines.join("\n")}`);
  }

  const memory = input.memoryEntries
    .map(tidyMemoryEntry)
    .filter(Boolean)
    .slice(0, MAX_MEMORY_ENTRIES);
  if (memory.length > 0) {
    const lines = memory.map((entry) => `- ${entry}`);
    sections.push(`What you remember about the user:\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return "";

  const header =
    "Use the following context from the user's own workspace and memory to ground your answer. " +
    "Prefer their existing notes and terminology; cite a note by its title when you rely on it.";
  const footer = input.vaultPath
    ? `\n\nThe full markdown vault is at: ${input.vaultPath} — use your file tools to read a note in full if a snippet is not enough.`
    : "";

  const body = `${header}\n\n${sections.join("\n\n")}${footer}`;
  if (body.length <= MAX_CONTEXT_CHARS) return body;
  return body.slice(0, MAX_CONTEXT_CHARS).trimEnd() + "\n…";
}

/**
 * Retrieve vault hits + memory for a request and render the preamble. Returns ""
 * if nothing relevant is found or retrieval fails (the assistant still works
 * without context — this is purely additive). DB access is dynamically imported
 * so this file never pulls `better-sqlite3` at module-load time.
 */
export async function assembleVaultContext(
  query: string,
  pageTitle: string,
  profile?: string,
): Promise<string> {
  try {
    const { getSpsNoteIndex } = await import("./note-index");
    const { readMemory } = await import("./memory");

    const searchText = `${pageTitle} ${query}`.trim();
    const index = await getSpsNoteIndex(profile);
    const rawHits = searchText ? index.search(searchText, MAX_HITS) : [];
    const hits: VaultHit[] = rawHits.map((hit) => ({
      title: hit.title,
      snippet: hit.snippet,
      path: hit.path,
    }));

    let memoryEntries: string[] = [];
    try {
      const mem = readMemory(profile);
      memoryEntries = mem.memory.entries.map((entry) => entry.content);
    } catch {
      // Memory is optional context — never fail the request over it.
    }

    const vaultPath = index.status().root;
    return formatVaultContext({ hits, memoryEntries, vaultPath });
  } catch {
    return "";
  }
}
