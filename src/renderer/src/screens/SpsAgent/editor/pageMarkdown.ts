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

/** Serialize a page (its properties + blocks) to a markdown file string. */
export function pageToMarkdown(
  meta: Partial<PageMeta>,
  blocks: Block[],
): string {
  const fm: string[] = [];
  if (meta.title !== undefined) fm.push(`title: ${JSON.stringify(meta.title)}`);
  if (meta.icon !== undefined) fm.push(`icon: ${JSON.stringify(meta.icon)}`);
  if (meta.cover !== undefined) fm.push(`cover: ${JSON.stringify(meta.cover)}`);
  const body = blocksToMarkdown(blocks);
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
  }
  return out;
}
