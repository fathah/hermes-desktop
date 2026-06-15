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

  it("round-trips KB ingestion keys (source, ingestedAt)", () => {
    const meta: Partial<PageMeta> = {
      title: "Handbook",
      icon: "📄",
      cover: null,
      source: "/Users/me/Documents/handbook.pdf",
      ingestedAt: 1717600000000,
    };
    expect(roundTrip(meta, [blk("p", "x")]).meta).toEqual(meta);
  });

  it("serializes a page WITHOUT ingestion keys byte-identically (regression guard)", () => {
    // Pages that never carry source/ingestedAt must produce exactly the old
    // output, so existing on-disk vault files and golden expectations hold.
    const meta = { title: "My Page", icon: "📄", cover: null };
    const md = pageToMarkdown(meta, [blk("p", "hi")]);
    expect(md).toBe(
      '---\ntitle: "My Page"\nicon: "📄"\ncover: null\n---\n\nhi',
    );
  });

  it("emits tags as a YAML flow sequence, appended last, only when present", () => {
    const md = pageToMarkdown(
      { title: "T", icon: "📄", cover: null, tags: ["work", "urgent"] },
      [blk("p", "x")],
    );
    expect(md).toContain('tags: ["work","urgent"]');
    // Appended after the other keys.
    expect(md.indexOf("tags:")).toBeGreaterThan(md.indexOf("cover:"));
  });

  it("omits tags when empty or absent (keeps non-tagged pages byte-identical)", () => {
    const noTags = pageToMarkdown({ title: "T", cover: null }, [blk("p", "x")]);
    expect(noTags).not.toContain("tags:");
    const emptyTags = pageToMarkdown({ title: "T", cover: null, tags: [] }, [
      blk("p", "x"),
    ]);
    expect(emptyTags).not.toContain("tags:");
  });

  it("round-trips tags", () => {
    const meta: Partial<PageMeta> = {
      title: "T",
      icon: "📄",
      cover: null,
      tags: ["alpha", "beta-1", "ns/child"],
    };
    expect(roundTrip(meta, [blk("p", "x")]).meta).toEqual(meta);
  });

  it("preserves unknown frontmatter keys as page properties", () => {
    const parsed = pageFromMarkdown(
      [
        "---",
        'title: "Project Atlas"',
        'owner: "Maya"',
        "priority: 2",
        "published: false",
        'aliases: ["Atlas","Roadmap"]',
        "---",
        "",
        "Body",
      ].join("\n"),
    );
    expect(parsed.meta).toEqual({
      title: "Project Atlas",
      aliases: ["Atlas", "Roadmap"],
      properties: {
        owner: "Maya",
        priority: 2,
        published: false,
      },
    });
  });

  it("serializes aliases and extra properties after reserved keys in sorted order", () => {
    const md = pageToMarkdown(
      {
        title: "Project Atlas",
        icon: "📌",
        cover: null,
        tags: ["project"],
        aliases: ["Atlas", "Roadmap"],
        properties: {
          owner: "Maya",
          published: false,
          priority: 2,
        },
      },
      [blk("p", "x")],
    );
    expect(md).toBe(
      [
        "---",
        'title: "Project Atlas"',
        'icon: "📌"',
        "cover: null",
        'tags: ["project"]',
        'aliases: ["Atlas","Roadmap"]',
        'owner: "Maya"',
        "priority: 2",
        "published: false",
        "---",
        "",
        "x",
      ].join("\n"),
    );
  });

  it("reserved frontmatter keys win over duplicate keys in properties", () => {
    const md = pageToMarkdown(
      {
        title: "Reserved Title",
        tags: ["real"],
        properties: {
          title: "Wrong",
          tags: ["wrong"],
          custom: "kept",
        },
      },
      [blk("p", "x")],
    );
    expect(md).toContain('title: "Reserved Title"');
    expect(md).toContain('tags: ["real"]');
    expect(md).toContain('custom: "kept"');
    expect(md).not.toContain("Wrong");
    expect(md).not.toContain("wrong");
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
