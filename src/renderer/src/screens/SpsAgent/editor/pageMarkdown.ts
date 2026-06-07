// pageMarkdown.ts — Part 2 / S2b: a whole page ↔ a markdown file.
//
// Composes the block serializer (blockMarkdown.ts) with YAML frontmatter that
// carries the page's properties (title / icon / cover). The frontmatter is
// written as JSON-style scalars, which are valid YAML — so the main-process
// note-index (which parses these files with a real YAML parser) reads them too.
//
// Used by the additive disk mirror: SPS edits are written to markdown files so
// the substrate (and its index) materializes, while the JSON blob stays the
// authoritative store until parity is proven (S6).
import { blocksToMarkdown, markdownToBlocks } from "./blockMarkdown";
import type { Block, PageMeta } from "../types";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Serialize a page (its properties + blocks) to a markdown file string.
 *  Block ids in `anchoredIds` are persisted so comment anchors survive (F2). */
export function pageToMarkdown(
  meta: Partial<PageMeta>,
  blocks: Block[],
  anchoredIds?: Set<string>,
): string {
  const fm: string[] = [];
  if (meta.title !== undefined) fm.push(`title: ${JSON.stringify(meta.title)}`);
  if (meta.icon !== undefined) fm.push(`icon: ${JSON.stringify(meta.icon)}`);
  if (meta.cover !== undefined) fm.push(`cover: ${JSON.stringify(meta.cover)}`);
  // KB ingestion keys (Phase 0) — appended after cover so pages without them
  // serialize byte-for-byte identically to before (golden tests stay green).
  if (meta.source !== undefined)
    fm.push(`source: ${JSON.stringify(meta.source)}`);
  if (meta.ingestedAt !== undefined)
    fm.push(`ingestedAt: ${JSON.stringify(meta.ingestedAt)}`);
  // Journal entry properties — emitted only when set so non-journal pages stay
  // byte-identical (and so the note-index can query entries by date/mood).
  if (meta.journal !== undefined)
    fm.push(`journal: ${JSON.stringify(meta.journal)}`);
  if (meta.date !== undefined) fm.push(`date: ${JSON.stringify(meta.date)}`);
  if (meta.time !== undefined) fm.push(`time: ${JSON.stringify(meta.time)}`);
  if (meta.mood !== undefined) fm.push(`mood: ${JSON.stringify(meta.mood)}`);
  // Tags appended last and only when non-empty — keeps non-tagged pages
  // byte-identical. `JSON.stringify(string[])` is a valid YAML flow sequence,
  // which the note-index's real YAML parser reads as an array.
  if (meta.tags !== undefined && meta.tags.length > 0)
    fm.push(`tags: ${JSON.stringify(meta.tags)}`);
  if (meta.x !== undefined) fm.push(`x: ${JSON.stringify(meta.x)}`);
  if (meta.y !== undefined) fm.push(`y: ${JSON.stringify(meta.y)}`);
  if (meta.width !== undefined) fm.push(`width: ${JSON.stringify(meta.width)}`);
  if (meta.height !== undefined)
    fm.push(`height: ${JSON.stringify(meta.height)}`);
  if (meta.color !== undefined) fm.push(`color: ${JSON.stringify(meta.color)}`);
  if (meta.connections !== undefined && meta.connections.length > 0)
    fm.push(`connections: ${JSON.stringify(meta.connections)}`);
  const body = blocksToMarkdown(blocks, anchoredIds);
  if (fm.length === 0) return body;
  return `---\n${fm.join("\n")}\n---\n\n${body}`;
}

/** Parse a markdown file string back into page properties + blocks. */
export function pageFromMarkdown(md: string): {
  meta: Partial<PageMeta>;
  blocks: Block[];
} {
  const match = FRONTMATTER_RE.exec(md);
  if (!match) return { meta: {}, blocks: markdownToBlocks(md) };
  const body = md.slice(match[0].length);
  return {
    meta: parseScalarFrontmatter(match[1]),
    blocks: markdownToBlocks(body),
  };
}

function parseScalarFrontmatter(text: string): Partial<PageMeta> {
  const out: Partial<PageMeta> = {};
  for (const line of text.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();
    let value: unknown = rawValue;
    try {
      value = JSON.parse(rawValue);
    } catch {
      /* keep the raw string */
    }
    if (key === "title" && typeof value === "string") out.title = value;
    else if (key === "icon" && typeof value === "string") out.icon = value;
    else if (key === "cover") out.cover = value as PageMeta["cover"];
    else if (key === "source" && typeof value === "string") out.source = value;
    else if (key === "ingestedAt" && typeof value === "number")
      out.ingestedAt = value;
    else if (key === "journal" && typeof value === "boolean")
      out.journal = value;
    else if (key === "date" && typeof value === "string") out.date = value;
    else if (key === "time" && typeof value === "string") out.time = value;
    else if (key === "mood" && typeof value === "string") out.mood = value;
    else if (key === "tags" && Array.isArray(value))
      out.tags = value.filter((t): t is string => typeof t === "string");
    else if (key === "x" && typeof value === "number") out.x = value;
    else if (key === "y" && typeof value === "number") out.y = value;
    else if (key === "width" && typeof value === "number") out.width = value;
    else if (key === "height" && typeof value === "number") out.height = value;
    else if (key === "color" && typeof value === "string") out.color = value;
    else if (key === "connections" && Array.isArray(value))
      out.connections = value.filter((t): t is string => typeof t === "string");
  }
  return out;
}
