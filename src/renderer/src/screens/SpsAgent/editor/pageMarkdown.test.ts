// pageMarkdown.test.ts — S2b: page (properties + blocks) ↔ markdown file.
import { describe, expect, it } from "vitest";
import { pageToMarkdown, pageFromMarkdown } from "./pageMarkdown";
import { blk } from "../lib/ids";
import type { Block, PageMeta } from "../types";

function bare(b: Block): Omit<Block, "id"> {
  const rest: Partial<Block> = { ...b };
  delete rest.id;
  return rest as Omit<Block, "id">;
}

function roundTrip(meta: Partial<PageMeta>, blocks: Block[]) {
  const { meta: m, blocks: bs } = pageFromMarkdown(
    pageToMarkdown(meta, blocks),
  );
  return { meta: m, blocks: bs.map(bare) };
}

describe("pageMarkdown frontmatter", () => {
  it("writes JSON-scalar frontmatter that is valid YAML", () => {
    const md = pageToMarkdown({ title: "My Page", icon: "📄", cover: null }, [
      blk("p", "hi"),
    ]);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('title: "My Page"');
    expect(md).toContain('icon: "📄"');
    expect(md).toContain("cover: null");
  });

  it("omits frontmatter entirely when no properties are given", () => {
    const md = pageToMarkdown({}, [blk("p", "body only")]);
    expect(md.startsWith("---")).toBe(false);
    expect(pageFromMarkdown(md).meta).toEqual({});
  });

  it("round-trips page properties (incl. quotes, emoji, cover variants)", () => {
    for (const cover of [null, "#ff0000", "image"] as PageMeta["cover"][]) {
      const meta = { title: 'A "quoted" title', icon: "🚀", cover };
      expect(roundTrip(meta, [blk("p", "x")]).meta).toEqual(meta);
    }
  });
});

describe("pageMarkdown full round-trip", () => {
  it("round-trips properties + a mixed block document", () => {
    const meta: Partial<PageMeta> = {
      title: "Project",
      icon: "📌",
      cover: null,
    };
    const blocks: Block[] = [
      blk("p", "Intro."),
      blk("h2", "Tasks"),
      blk("todo", "do it", { done: false }),
      blk("callout", "note", { emoji: "💡" }),
      blk("database", "", { view: "board", rows: [] }),
      blk("quote", "fin"),
    ];
    const out = roundTrip(meta, blocks);
    expect(out.meta).toEqual(meta);
    expect(out.blocks).toEqual(blocks.map(bare));
  });

  it("parses a body-only file (no frontmatter) into blocks", () => {
    const { meta, blocks } = pageFromMarkdown("# Heading\n\nA paragraph.");
    expect(meta).toEqual({});
    expect(blocks.map((b) => b.type)).toEqual(["h1", "p"]);
  });
});
