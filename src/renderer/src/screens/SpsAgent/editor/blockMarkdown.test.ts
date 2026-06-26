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
  it("a coloured paragraph (markdown can't carry colour)", () =>
    expectRoundTrip([blk("p", "warn", { color: "red", bg: "yellow" })]));
  it("toggle with collapsed state", () =>
    expectRoundTrip([blk("toggle", "Details", { collapsed: true })]));
  it("columns layout block preserves its nested block columns", () =>
    expectRoundTrip([
      blk("columns", "", {
        columns: [
          [{ id: "c1", type: "h3", text: "Pros" }],
          [
            { id: "c2", type: "li", text: "fast" },
            { id: "c3", type: "todo", text: "ship it", done: false },
          ],
        ],
      }),
    ]));
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
  it("agent-action button preserves its label, emoji, and agentPrompt", () =>
    expectRoundTrip([
      blk("button", "Review against our SOPs", {
        emoji: "🔎",
        agentPrompt: "Review this against our SOPs and flag gaps.",
      }),
    ]));
});

describe("Obsidian-native callouts (> [!type])", () => {
  it("serializes a mapped-emoji callout to native > [!type] (no tier-2)", () => {
    const md = blocksToMarkdown([
      blk("callout", "Standup at 9:30", { emoji: "📌" }),
    ]);
    expect(md).toBe("> [!note] Standup at 9:30");
    expect(md).not.toContain("<!-- sps:");
  });
  it("round-trips a mapped-emoji callout losslessly", () =>
    expectRoundTrip([blk("callout", "Heads up", { emoji: "⚠️" })]));
  it("emits a bare header for an empty callout", () => {
    expect(blocksToMarkdown([blk("callout", "", { emoji: "💡" })])).toBe(
      "> [!tip]",
    );
  });
  it("parses a callout BEFORE a plain quote (ordering)", () => {
    const out = markdownToBlocks("> [!warning] Careful");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("callout");
    expect(out[0].emoji).toBe("⚠️");
    expect(out[0].text).toBe("Careful");
  });
  it("still parses a plain blockquote as a quote", () => {
    const out = markdownToBlocks("> just a quote");
    expect(out[0].type).toBe("quote");
    expect(out[0].text).toBe("just a quote");
  });
  it("normalizes an Obsidian alias type to the canonical emoji", () => {
    const out = markdownToBlocks("> [!summary] TL;DR");
    expect(out[0].type).toBe("callout");
    expect(out[0].emoji).toBe("📋"); // summary → abstract → 📋
  });
  it("keeps an unmapped-emoji callout on tier-2 to preserve the emoji", () => {
    const md = blocksToMarkdown([blk("callout", "party", { emoji: "🎉" })]);
    expect(md).toContain("<!-- sps:");
    expectRoundTrip([blk("callout", "party", { emoji: "🎉" })]);
  });
  it("keeps a coloured callout on tier-2 (colour isn't markdown-expressible)", () => {
    const md = blocksToMarkdown([
      blk("callout", "x", { emoji: "📌", bg: "yellow" }),
    ]);
    expect(md).toContain("<!-- sps:");
  });
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

  it("preserves inline wikilinks in prose instead of escaping them", () => {
    const blocks = [
      blk(
        "p",
        "Discuss [[Project Atlas|Atlas]], [[Roadmap#North Star]], and [[Tasks#^todo-1]].",
      ),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toBe(
      "Discuss [[Project Atlas|Atlas]], [[Roadmap#North Star]], and [[Tasks#^todo-1]].",
    );
    expect(markdownToBlocks(md).map((b) => blocksToMarkdown([b]))).toEqual([
      md,
    ]);
  });

  it("preserves wikilink anchors carried in sanitized editor html", () => {
    const raw = "[[Project Atlas|Atlas]]";
    expect(
      inlineHtmlToMd(
        `<a class="wiki-link" data-sps-wikilink="${raw}" data-sps-target="Project Atlas">Atlas</a>`,
      ),
    ).toEqual({ md: raw, clean: true });
  });

  it("parses aliases, heading refs, and block refs into page-link blocks", () => {
    const [alias, heading, blockRef] = markdownToBlocks(
      "[[Project Atlas|Atlas]]\n\n[[Roadmap#North Star]]\n\n[[Tasks#^todo-1]]",
    );
    expect(alias).toMatchObject({
      type: "page",
      pageId: "Project Atlas",
      linkDisplay: "Atlas",
    });
    expect(heading).toMatchObject({
      type: "page",
      pageId: "Roadmap",
      linkHeading: "North Star",
    });
    expect(blockRef).toMatchObject({
      type: "page",
      pageId: "Tasks",
      linkBlockId: "todo-1",
    });
    expect(blocksToMarkdown([alias, heading, blockRef])).toBe(
      "[[Project Atlas|Atlas]]\n\n[[Roadmap#North Star]]\n\n[[Tasks#^todo-1]]",
    );
  });

  it("round-trips Obsidian embeds as embed blocks", () => {
    const blocks = markdownToBlocks("![[Project Atlas|Atlas]]");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "embed",
      pageId: "Project Atlas",
      linkDisplay: "Atlas",
    });
    expect(blocksToMarkdown(blocks)).toBe("![[Project Atlas|Atlas]]");
  });
});

describe("mermaid diagram block", () => {
  it("round-trips a mermaid block as a clean ```mermaid fence", () => {
    const source = "graph TD;\n  A[Start] --> B[End]";
    const blocks: Block[] = [blk("mermaid", source)];
    const md = blocksToMarkdown(blocks);
    expect(md).toBe("```mermaid\n" + source + "\n```");
    expectRoundTrip(blocks);
  });

  it("keeps a plain fence as a code block (no mermaid info-string)", () => {
    const out = markdownToBlocks("```\necho hi\n```");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("code");
    expect(out[0].text).toBe("echo hi");
  });

  it("does not embed base64/metadata for a mermaid block", () => {
    const md = blocksToMarkdown([
      blk("mermaid", "sequenceDiagram\n  A->>B: hi"),
    ]);
    expect(md).not.toContain("<!-- sps:");
  });
});

describe("excalidraw drawing block", () => {
  const src = "assets/home/exb1abc.excalidraw.svg";

  it("round-trips a drawn block as a clean image ref (no base64)", () => {
    const blocks: Block[] = [blk("excalidraw", "", { src, caption: "" })];
    const md = blocksToMarkdown(blocks);
    expect(md).toBe(`![](${src})`);
    expect(md).not.toContain("<!-- sps:");
    expectRoundTrip(blocks);
  });

  it("reconstructs an excalidraw block from the .excalidraw.svg suffix", () => {
    const out = markdownToBlocks(`![](${src})`);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("excalidraw");
    expect(out[0].src).toBe(src);
  });

  it("keeps an ordinary image as an image block", () => {
    const out = markdownToBlocks("![cat](assets/home/p.png)");
    expect(out[0].type).toBe("image");
  });

  it("preserves the type of an undrawn block via the tier-2 stub", () => {
    const md = blocksToMarkdown([blk("excalidraw", "", { src: null })]);
    expect(md).toContain("<!-- sps:");
    const out = markdownToBlocks(md);
    expect(out[0].type).toBe("excalidraw");
  });
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

describe("F2 — block-id persistence for comment anchors", () => {
  it("default output is unchanged (no ^id marker) without anchoredIds", () => {
    const p = blk("p", "Hello");
    const md = blocksToMarkdown([p]);
    expect(md).toBe("Hello");
    expect(md).not.toContain("^");
  });

  it("round-trip without anchoredIds is byte-identical to passing an empty set", () => {
    const blocks = [blk("p", "a"), blk("li", "b"), blk("h1", "c")];
    expect(blocksToMarkdown(blocks)).toBe(blocksToMarkdown(blocks, new Set()));
  });

  it("persists an anchored tier-1 block id via an Obsidian ^marker", () => {
    const p = blk("p", "Anchored para");
    const md = blocksToMarkdown([p], new Set([p.id]));
    expect(md).toBe(`Anchored para ^${p.id}`);
    const back = markdownToBlocks(md);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(p.id);
    expect(back[0].text).toBe("Anchored para");
  });

  it("persists anchored ids across heading + todo lines (content intact)", () => {
    const h = blk("h2", "Title");
    const t = blk("todo", "ship", { done: true });
    const back = markdownToBlocks(
      blocksToMarkdown([h, t], new Set([h.id, t.id])),
    );
    expect(back.map((b) => b.id)).toEqual([h.id, t.id]);
    expect(back[1].done).toBe(true);
    expect(back[1].text).toBe("ship");
  });

  it("only anchored blocks keep their id; others regenerate", () => {
    const a = blk("p", "keep");
    const b = blk("p", "fresh");
    const back = markdownToBlocks(blocksToMarkdown([a, b], new Set([a.id])));
    expect(back[0].id).toBe(a.id);
    expect(back[1].id).not.toBe(b.id);
  });

  it("anchors a non-inline block (divider) via the tier-2 meta, id preserved", () => {
    const d = blk("divider", "");
    const md = blocksToMarkdown([d], new Set([d.id]));
    expect(md).toContain("<!-- sps:");
    expect(md).not.toContain(`^${d.id}`);
    const back = markdownToBlocks(md);
    expect(back[0].type).toBe("divider");
    expect(back[0].id).toBe(d.id);
  });
});

describe("media blocks (asset store)", () => {
  it("image with a vault asset → tier-1 ../_assets link, round-trips to assetPath", () => {
    const img: Block = {
      id: "i1",
      type: "image",
      text: "",
      caption: "Sunset",
      assetPath: `${"a".repeat(64)}.jpg`,
    };
    const md = blocksToMarkdown([img]);
    expect(md).toBe(`![Sunset](../_assets/${"a".repeat(64)}.jpg)`);
    const back = markdownToBlocks(md)[0];
    expect(back.type).toBe("image");
    expect(back.assetPath).toBe(`${"a".repeat(64)}.jpg`);
    expect(back.caption).toBe("Sunset");
    expect(back.src).toBeUndefined();
  });

  it("legacy data-URL image still round-trips via src", () => {
    const img: Block = {
      id: "i2",
      type: "image",
      text: "",
      src: "data:image/png;base64,AAAA",
    };
    const back = markdownToBlocks(blocksToMarkdown([img]))[0];
    expect(back.src).toBe("data:image/png;base64,AAAA");
    expect(back.assetPath).toBeUndefined();
  });

  it("audio/video/file ride the tier-2 meta comment losslessly", () => {
    const audio: Block = {
      id: "a1",
      type: "audio",
      text: "",
      assetPath: `${"b".repeat(64)}.webm`,
      mime: "audio/webm",
      name: "voice-note.webm",
      size: 12345,
      duration: 42,
    };
    const video: Block = {
      id: "v1",
      type: "video",
      text: "",
      assetPath: `${"c".repeat(64)}.mp4`,
      mime: "video/mp4",
      name: "clip.mp4",
      size: 999,
    };
    const file: Block = {
      id: "f1",
      type: "file",
      text: "",
      assetPath: `${"d".repeat(64)}.pdf`,
      mime: "application/pdf",
      name: "report.pdf",
      size: 5000,
    };
    for (const b of [audio, video, file]) {
      const md = blocksToMarkdown([b]);
      expect(md).toContain("<!-- sps:");
      const back = bare(markdownToBlocks(md)[0]);
      expect(back).toEqual(bare(b));
    }
  });
});
