import { describe, it, expect } from "vitest";
import {
  parseMediaTokens,
  hasMediaTokens,
  describeImageSrc,
  cleanLeakedToolTags,
  type MediaSegment,
} from "./mediaUtils";

/** Find the first media segment, or fail the assertion if there is none. */
function media(segs: MediaSegment[]): Extract<MediaSegment, { type: "media" }> {
  const hit = segs.find((s) => s.type === "media");
  if (!hit || hit.type !== "media") {
    throw new Error("expected a media segment, got none");
  }
  return hit;
}

describe("parseMediaTokens (issue #299)", () => {
  it("returns a single text segment when there is nothing to extract", () => {
    expect(parseMediaTokens("just a normal reply")).toEqual([
      { type: "text", value: "just a normal reply", start: 0 },
    ]);
  });

  // ── Explicit MEDIA: tokens ─────────────────────────────
  it("extracts an explicit MEDIA: token (Windows path)", () => {
    const segs = parseMediaTokens(
      "Here it is:\n\nMEDIA:C:\\Users\\pmos6\\cat.png",
    );
    expect(segs[0]).toEqual({
      type: "text",
      value: "Here it is:\n\n",
      start: 0,
    });
    expect(segs[1]).toMatchObject({
      type: "media",
      source: "media-token",
      token: { src: "C:\\Users\\pmos6\\cat.png", isImage: true, isUrl: false },
    });
  });

  it("extracts a MEDIA: https token as a URL", () => {
    const segs = parseMediaTokens("MEDIA:https://x.test/p.jpg");
    expect(segs[0]).toMatchObject({
      type: "media",
      source: "media-token",
      token: { isUrl: true, isImage: true },
    });
  });

  it("strips trailing punctuation from a bare MEDIA: token", () => {
    const segs = parseMediaTokens("see MEDIA:/tmp/out.png.");
    expect(media(segs).token.src).toBe("/tmp/out.png");
  });

  it("honours a quoted MEDIA: token containing spaces", () => {
    const segs = parseMediaTokens('MEDIA:"C:\\My Folder\\a file.pdf"');
    expect(media(segs).token).toMatchObject({
      src: "C:\\My Folder\\a file.pdf",
      name: "a file.pdf",
    });
  });

  // ── Whole-line bare paths ──────────────────────────────
  it("detects a whole-line bare absolute path (Windows, non-image)", () => {
    const segs = parseMediaTokens(
      "Criei o PDF aqui:\n\nC:\\Users\\pmos6\\proverbios.pdf\n\nInclui 10.",
    );
    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "C:\\Users\\pmos6\\proverbios.pdf",
      token: { src: "C:\\Users\\pmos6\\proverbios.pdf", isImage: false },
    });
  });

  it("detects a whole-line POSIX path", () => {
    const segs = parseMediaTokens("Done:\n/home/me/out.png");
    expect(media(segs)).toMatchObject({
      source: "bare-path",
      token: { src: "/home/me/out.png", isImage: true },
    });
  });

  it("tolerates spaces inside a whole-line path", () => {
    const segs = parseMediaTokens("C:\\My Folder\\a file.pdf");
    expect(segs[0]).toMatchObject({
      type: "media",
      source: "bare-path",
      token: { src: "C:\\My Folder\\a file.pdf", name: "a file.pdf" },
    });
  });

  // ── Inline bare paths (mid-sentence) ───────────────────
  it("detects an inline absolute path mentioned mid-sentence", () => {
    const segs = parseMediaTokens("I saved it to C:\\Users\\me\\x.pdf today.");
    expect(segs[0]).toEqual({
      type: "text",
      value: "I saved it to ",
      start: 0,
    });
    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "C:\\Users\\me\\x.pdf",
      token: { src: "C:\\Users\\me\\x.pdf", isImage: false },
    });
    expect(segs[segs.length - 1]).toEqual({
      type: "text",
      value: " today.",
      // 14 ("I saved it to ") + 17 ("C:\\Users\\me\\x.pdf") = 31.
      start: 31,
    });
  });

  it("detects an inline POSIX absolute path", () => {
    const segs = parseMediaTokens("Generated at /home/me/out.png — enjoy.");
    expect(media(segs)).toMatchObject({
      source: "bare-path",
      token: { src: "/home/me/out.png", isImage: true },
    });
  });

  it("excludes trailing punctuation from an inline path", () => {
    const segs = parseMediaTokens(
      "The chart is at C:\\d\\chart.png, see above.",
    );
    expect(media(segs).token.src).toBe("C:\\d\\chart.png");
    expect(media(segs).raw).toBe("C:\\d\\chart.png");
  });

  it("keeps the matched path as `raw` so it can be shown verbatim", () => {
    // `raw` is what MediaSegmentView renders until the file is verified.
    const segs = parseMediaTokens("file: /var/data/report.csv done");
    expect(media(segs).raw).toBe("/var/data/report.csv");
  });

  // ── False-positive guards ──────────────────────────────
  it("does NOT start an inline match mid-token", () => {
    const segs = parseMediaTokens("fooC:\\Users\\me\\x.pdf");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT match an inline http URL as a path", () => {
    const segs = parseMediaTokens("See https://example.com/pic.png for more.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT match an inline relative path", () => {
    const segs = parseMediaTokens("Check output/cat.png please.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT detect a path inside a fenced code block", () => {
    const segs = parseMediaTokens(
      "Example:\n```\nC:\\Users\\me\\x.png\n```\ndone",
    );
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT detect a path inside an inline code span", () => {
    const segs = parseMediaTokens("Run `C:\\tmp\\x.png` to see it.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT treat a bare URL line as a path", () => {
    const segs = parseMediaTokens("https://example.com/pic.png");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT detect a relative path line", () => {
    const segs = parseMediaTokens("output/cat.png");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT match a bare path with an unknown extension", () => {
    const segs = parseMediaTokens("Config at C:\\app\\settings.ini reloaded.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  // ── Misc ───────────────────────────────────────────────
  it("does not double-count a MEDIA: token as a bare path", () => {
    const hits = parseMediaTokens("MEDIA:/tmp/a.png").filter(
      (s) => s.type === "media",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "media-token" });
  });

  it("detects several inline paths in one reply", () => {
    const segs = parseMediaTokens(
      "First /home/a/one.png and then /home/b/two.pdf are ready.",
    );
    const hits = segs.filter((s) => s.type === "media");
    expect(hits).toHaveLength(2);
    expect(
      hits.every((h) => h.type === "media" && h.source === "bare-path"),
    ).toBe(true);
  });

  it("keeps text after a token", () => {
    const segs = parseMediaTokens("MEDIA:/tmp/a.png\n\nEnjoy!");
    expect(segs[segs.length - 1]).toEqual({
      type: "text",
      value: "\n\nEnjoy!",
      // "MEDIA:/tmp/a.png" is 16 chars — trailing text begins at offset 16.
      start: 16,
    });
  });

  it("hasMediaTokens detects explicit tokens only", () => {
    expect(hasMediaTokens("MEDIA:/tmp/a.png")).toBe(true);
    expect(hasMediaTokens("see /tmp/a.png")).toBe(false);
    expect(hasMediaTokens("no media")).toBe(false);
  });

  it("describeImageSrc classifies a plain image src", () => {
    expect(describeImageSrc("https://x.test/p.png")).toMatchObject({
      isUrl: true,
      isImage: true,
      name: "p.png",
    });
  });

  it("describeImageSrc sets isImage:false for a non-image src so the caller can route to DownloadChip", () => {
    // markdown allows ![alt](file.pdf) — that parses as an image tag but the
    // actual file is a PDF. Hardcoding isImage:true here caused MediaImage
    // to try to load it as an image and surface "could not load file.pdf"
    // to the user. Honouring IMAGE_EXT lets the caller route non-images to
    // the download chip instead. (Follow-up from PR #303 review.)
    expect(describeImageSrc("./report.pdf")).toMatchObject({
      isImage: false,
      name: "report.pdf",
    });
    expect(describeImageSrc("https://x.test/data.csv")).toMatchObject({
      isUrl: true,
      isImage: false,
      name: "data.csv",
    });
  });

  it("emits stable `start` offsets on every segment for use as React keys", () => {
    // The map() in MessageRow used the array index as key. When a MEDIA:
    // token appears mid-stream, every subsequent segment shifts index,
    // re-mounting downstream MediaSegmentView instances and re-firing
    // their `mediaFileExists` probes. Keying on `start` instead is
    // streaming-stable. (Follow-up from PR #303 review.)
    const segs = parseMediaTokens(
      "intro MEDIA:/tmp/a.png tail MEDIA:/tmp/b.png end",
    );
    // Every segment carries its origin offset.
    for (const s of segs) {
      expect(typeof s.start).toBe("number");
      expect(s.start).toBeGreaterThanOrEqual(0);
    }
    // Offsets are strictly increasing across the segment stream.
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].start).toBeGreaterThan(segs[i - 1].start);
    }
    // Used as React keys, the values are unique.
    const keys = segs.map((s) => `${s.type}-${s.start}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("cleanLeakedToolTags", () => {
  it("extracts the answer from a leaked skill_view tag", () => {
    const raw =
      '<skill_view name="hermes-agent-skill-authoring">{"answer": "To develop an AI agent, start by defining its purpose."}</skill_view>';
    expect(cleanLeakedToolTags(raw)).toBe(
      "To develop an AI agent, start by defining its purpose.",
    );
  });

  it("handles a leaked tag embedded in surrounding prose", () => {
    const raw =
      'Here you go:\n<some_tool>{"content": "the body"}</some_tool>\nThanks!';
    expect(cleanLeakedToolTags(raw)).toBe("Here you go:\nthe body\nThanks!");
  });

  it("recovers multiple leaked tags", () => {
    const raw =
      '<a_tool>{"answer": "first"}</a_tool> and <b_tool>{"text": "second"}</b_tool>';
    expect(cleanLeakedToolTags(raw)).toBe("first and second");
  });

  it("leaves normal prose untouched", () => {
    const text = "Just a normal reply with no tags.";
    expect(cleanLeakedToolTags(text)).toBe(text);
  });

  it("leaves a single-word tag (no underscore, e.g. real HTML) untouched", () => {
    // `terminal` has no underscore, so it's treated as markup, not a tool leak.
    expect(
      cleanLeakedToolTags('<terminal>{"command": "ls -la"}</terminal>'),
    ).toBe('<terminal>{"command": "ls -la"}</terminal>');
    expect(cleanLeakedToolTags("<b>bold</b> and <code>x = 1</code>")).toBe(
      "<b>bold</b> and <code>x = 1</code>",
    );
  });

  it("strips a prose-bodied leaked wrapper (skills_list) and keeps the body", () => {
    const raw =
      '<skills_list category="">We have:\n1. claude-code: delegate coding\n</skills_list>';
    expect(cleanLeakedToolTags(raw)).toBe(
      "We have:\n1. claude-code: delegate coding",
    );
  });

  it("converts inline <b>/<i> inside a leaked wrapper body to markdown", () => {
    const raw =
      '<skills_list category="">1. <b>Autonomous AI Agents</b>\n2. <i>Creative</i></skills_list>';
    expect(cleanLeakedToolTags(raw)).toBe(
      "1. **Autonomous AI Agents**\n2. *Creative*",
    );
  });

  it("does not convert inline HTML outside a leaked wrapper", () => {
    // No snake_case wrapper → the <b> is left exactly as the model wrote it.
    expect(cleanLeakedToolTags("plain <b>bold</b> text")).toBe(
      "plain <b>bold</b> text",
    );
  });

  it("does not transform an example inside a fenced code block", () => {
    const raw =
      '```\n<skill_view name="x">{"answer": "example"}</skill_view>\n```';
    expect(cleanLeakedToolTags(raw)).toBe(raw);
  });

  it("is a no-op (same reference path) when there is no closing tag", () => {
    const text = "no closing tag here";
    expect(cleanLeakedToolTags(text)).toBe(text);
  });
});
