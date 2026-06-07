// wikiSchema.ts — the default second-brain "schema" (Karpathy LLM-Wiki layer 3).
//
// Single source of truth, shared by the main process (readWikiSchema falls back
// to this when vault/WIKI.md is absent) and the renderer (which seeds an
// editable "Wiki schema" page from it). Editing the page in-app makes the user's
// version authoritative on the next ingest.
export const DEFAULT_WIKI_SCHEMA = `# Wiki schema

This page defines how the agent maintains your knowledge base. Edit it freely.

## Conventions
- One page per durable entity or concept; the page id is a short slug.
- Cross-link generously with [[wikilinks]] (a link's target is a page id).
- Use Obsidian-flavored Markdown: headings, bullet lists, \`> [!note]\` /
  \`> [!tip]\` callouts, and inline #tags.
- Keep pages concise and synthesized — never paste raw captures verbatim.

## Page types
- People, Organizations, Projects, Concepts, Decisions.

## Ingestion rules
- Prefer updating an existing page when a capture extends it.
- Discard captures that are pure noise.
`;
