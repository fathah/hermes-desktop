// blockMarkdown.test.ts — the S2 golden round-trip set. Proves block → markdown
// → block is lossless for the supported block model (ignoring runtime `id`).
import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown,
  markdownToBlocks,
  inlineHtmlToMd,
  parseInline,
} from "./blockMarkdown";
import { blk } from "../lib/ids";
import { HOME_BLOCKS } from "../data/seed";
import type { Block } from "../types";

/** Strip the runtime-only top-level id so content can be compared. */
function bare(b: Block): Omit<Block, "id"> {
  const rest: Partial<Block> = { ...b };
  delete rest.id;
  return rest as Omit<Block, "id">;
}

function roundTrip(blocks: Block[]): Omit<Block, "id">[] {
  return markdownToBlocks(blocksToMarkdown(blocks)).map(bare);
}

function expectRoundTrip(blocks: Block[]): void {
  expect(roundTrip(blocks)).toEqual(blocks.map(bare));
}

describe("inline html ↔ markdown", () => {
  it("converts clean inline marks to markdown", () => {
    expect(inlineHtmlToMd("<strong>Hi</strong>")).toEqual({
      md: "**Hi**",
      clean: true,
    });
    expect(inlineHtmlToMd("<em>x</em>").md).toBe("*x*");
    expect(inlineHtmlToMd("<s>x</s>").md).toBe("~~x~~");
    expect(inlineHtmlToMd("<mark>x</mark>").md).toBe("==x==");
    expect(inlineHtmlToMd("<code>x()</code>").md).toBe("`x()`");
    expect(inlineHtmlToMd('<a href="https://a.com">link</a>').md).toBe(
      "[link](https://a.com)",
    );
  });

  it("flags non-markdown html (mention/comment chips) as not clean", () => {
    const res = inlineHtmlToMd('<span class="pico">M</span>name');
    expect(res.clean).toBe(false);
  });

  it("parses markdown inline back to canonical html + plaintext", () => {
    expect(parseInline("**Hi**")).toEqual({
      text: "Hi",
      html: "<strong>Hi</strong>",
    });
    expect(parseInline("plain text")).toEqual({ text: "plain text" });
    expect(parseInline("a `code` b").html).toContain("<code>code</code>");
  });

  it("treats escaped marks as literal text (no formatting)", () => {
    const parsed = parseInline("literal \\*stars\\* and \\[brackets\\]");
    expect(parsed.text).toBe("literal *stars* and [brackets]");
    expect(parsed.html).toBeUndefined();
  });

  it("never emits executable html from a hostile body", () => {
    const parsed = parseInline("**x** <img src=x onerror=alert(1)>");
    expect(parsed.html ?? "").not.toContain("onerror");
  });
});

describe("tier-1 block round-trips", () => {
  it("paragraph", () => expectRoundTrip([blk("p", "Hello world")]));
  it("headings", () =>
    expectRoundTrip([blk("h1", "One"), blk("h2", "Two"), blk("h3", "Three")]));
  it("bullet + numbered list", () =>
    expectRoundTrip([blk("li", "first"), blk("numli", "second")]));
  it("nested list via indent", () =>
    expectRoundTrip([
      blk("li", "parent"),
      blk("li", "child", { indent: 1 }),
      blk("li", "grandchild", { indent: 2 }),
    ]));
  it("todo done + not done", () =>
    expectRoundTrip([
      blk("todo", "ship it", { done: true }),
      blk("todo", "later", { done: false }),
    ]));
  it("quote", () => expectRoundTrip([blk("quote", "a wise saying")]));
  it("divider", () => expectRoundTrip([blk("divider", "")]));
  it("multi-line code", () =>
    expectRoundTrip([blk("code", "const a = 1;\n\nconst b = 2;")]));
  it("image with caption", () =>
    expectRoundTrip([
      blk("image", "", { src: "https://i/x.png", caption: "a cat" }),
    ]));
  it("inline formatting inside a paragraph", () =>
    expectRoundTrip([blk("p", "bold", { html: "<strong>bold</strong>" })]));
  it("preserves literal markdown characters in plain text", () =>
    expectRoundTrip([blk("p", "use 2 * 3 and a_b and [x]")]));
});

describe("tier-2 lossless fallback (metadata comment)", () => {
  it("callout with emoji", () =>
    expectRoundTrip([blk("callout", "Standup at 9:30", { emoji: "📌" })]));
  it("a coloured paragraph (markdown can't carry colour)", () =>
    expectRoundTrip([blk("p", "warn", { color: "red", bg: "yellow" })]));
  it("toggle with collapsed state", () =>
    expectRoundTrip([blk("toggle", "Details", { collapsed: true })]));
  it("coloured sub-page link falls back to a comment", () =>
    expectRoundTrip([blk("page", "", { pageId: "pg-9", color: "red" })]));
  it("bookmark", () =>
    expectRoundTrip([
      blk("bookmark", "", {
        bm: { url: "https://a.com", title: "A", desc: "d" },
      }),
    ]));
  it("database block with rows (rows preserved verbatim)", () =>
    expectRoundTrip([
      blk("database", "", {
        view: "board",
        rows: [
          {
            id: "t1",
            title: "Task one",
            status: "doing",
            prio: "high",
            who: "maya",
            due: "2026-07-01",
            est: "2h",
          },
        ],
      }),
    ]));
  it("folder-backed query database preserves its source (S4)", () =>
    expectRoundTrip([
      blk("database", "", { view: "table", source: "db-abc" }),
    ]));
});

describe("page links as wikilinks (S3 — feeds the vault graph)", () => {
  it("serializes a sub-page link to a bare [[pageId]]", () => {
    expect(blocksToMarkdown([blk("page", "", { pageId: "pg-123" })])).toBe(
      "[[pg-123]]",
    );
  });
  it("parses [[pageId]] back into a page block", () => {
    const blocks = markdownToBlocks("[[pg-123]]");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("page");
    expect(blocks[0].pageId).toBe("pg-123");
  });
  it("round-trips a plain sub-page link losslessly", () =>
    expectRoundTrip([blk("page", "", { pageId: "pg-123" })]));
});

describe("full-document round-trip", () => {
  it("round-trips a representative mixed document", () => {
    const doc: Block[] = [
      blk("p", "Intro paragraph."),
      blk("callout", "Heads up", { emoji: "📌" }),
      blk("h2", "Section"),
      blk("todo", "done item", { done: true }),
      blk("todo", "open item", { done: false }),
      blk("li", "a point"),
      blk("li", "a sub-point", { indent: 1 }),
      blk("database", "", { view: "table", rows: [] }),
      blk("quote", "the end"),
      blk("divider", ""),
      blk("code", "echo hi"),
    ];
    expectRoundTrip(doc);
  });

  it("drops empty paragraphs (not representable in markdown — documented)", () => {
    const out = roundTrip([blk("p", "real"), blk("p", "")]);
    expect(out).toEqual([bare(blk("p", "real"))]);
  });

  it("round-trips the real seed Home document (sans empty paragraphs)", () => {
    const content = HOME_BLOCKS.filter(
      (b) => !(b.type === "p" && !b.text.trim()),
    );
    expectRoundTrip(content);
  });
});
