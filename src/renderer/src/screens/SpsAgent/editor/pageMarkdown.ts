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
import type { Block, PageMeta, SpsPropertyValue } from "../types";
import {
  frontmatterJsonLine,
  parseJsonScalarFrontmatter,
  splitSpsFrontmatter,
  wrapFrontmatterLines,
} from "../../../../../shared/sps-frontmatter";
const RESERVED_KEYS = new Set([
  "title",
  "icon",
  "cover",
  "source",
  "ingestedAt",
  "journal",
  "date",
  "time",
  "mood",
  "tags",
  "aliases",
]);

/** Serialize a page (its properties + blocks) to a markdown file string.
 *  Block ids in `anchoredIds` are persisted so comment anchors survive (F2). */
export function pageToMarkdown(
  meta: Partial<PageMeta>,
  blocks: Block[],
  anchoredIds?: Set<string>,
): string {
  const fm: string[] = [];
  if (meta.title !== undefined)
    fm.push(frontmatterJsonLine("title", meta.title));
  if (meta.icon !== undefined) fm.push(frontmatterJsonLine("icon", meta.icon));
  if (meta.cover !== undefined)
    fm.push(frontmatterJsonLine("cover", meta.cover));
  // KB ingestion keys (Phase 0) — appended after cover so pages without them
  // serialize byte-for-byte identically to before (golden tests stay green).
  if (meta.source !== undefined)
    fm.push(frontmatterJsonLine("source", meta.source));
  if (meta.ingestedAt !== undefined)
    fm.push(frontmatterJsonLine("ingestedAt", meta.ingestedAt));
  // Journal entry properties — emitted only when set so non-journal pages stay
  // byte-identical (and so the note-index can query entries by date/mood).
  if (meta.journal !== undefined)
    fm.push(frontmatterJsonLine("journal", meta.journal));
  if (meta.date !== undefined) fm.push(frontmatterJsonLine("date", meta.date));
  if (meta.time !== undefined) fm.push(frontmatterJsonLine("time", meta.time));
  if (meta.mood !== undefined) fm.push(frontmatterJsonLine("mood", meta.mood));
  // Tags appended last and only when non-empty — keeps non-tagged pages
  // byte-identical. `JSON.stringify(string[])` is a valid YAML flow sequence,
  // which the note-index's real YAML parser reads as an array.
  if (meta.tags !== undefined && meta.tags.length > 0)
    fm.push(frontmatterJsonLine("tags", meta.tags));
  if (meta.aliases !== undefined && meta.aliases.length > 0)
    fm.push(frontmatterJsonLine("aliases", meta.aliases));
  const extra = meta.properties ?? {};
  for (const key of Object.keys(extra).sort()) {
    if (RESERVED_KEYS.has(key)) continue;
    const value = extra[key];
    if (!isSpsPropertyValue(value)) continue;
    fm.push(frontmatterJsonLine(key, value));
  }
  const body = blocksToMarkdown(blocks, anchoredIds);
  return wrapFrontmatterLines(fm, body, "\n\n");
}

/** Parse a markdown file string back into page properties + blocks. */
export function pageFromMarkdown(md: string): {
  meta: Partial<PageMeta>;
  blocks: Block[];
} {
  const { frontmatter, body } = splitSpsFrontmatter(md);
  if (frontmatter === null) return { meta: {}, blocks: markdownToBlocks(md) };
  return {
    meta: parseScalarFrontmatter(frontmatter),
    blocks: markdownToBlocks(body),
  };
}

function parseScalarFrontmatter(text: string): Partial<PageMeta> {
  const out: Partial<PageMeta> = {};
  const properties: Record<string, SpsPropertyValue> = {};
  for (const [key, value] of Object.entries(parseJsonScalarFrontmatter(text))) {
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
    else if (key === "aliases" && Array.isArray(value))
      out.aliases = value.filter((t): t is string => typeof t === "string");
    else if (!RESERVED_KEYS.has(key) && isSpsPropertyValue(value))
      properties[key] = value;
  }
  if (Object.keys(properties).length > 0) out.properties = properties;
  return out;
}

function isSpsPropertyValue(value: unknown): value is SpsPropertyValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
