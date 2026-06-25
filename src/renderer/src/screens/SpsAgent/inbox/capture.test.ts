// capture.test.ts — locks the raw-source capture contract:
//   • provenance frontmatter keys survive the row serializer round-trip
//     (this is the load-bearing assumption from the plan — rowMarkdown.ts
//     serializes *all* non-empty props, so new keys need no schema change),
//   • status patches don't lose the captured body,
//   • title derivation + optional-field omission behave.
import { describe, it, expect } from "vitest";
import { rowFromMarkdown } from "../editor/rowMarkdown";
import { buildCapture, deriveTitle, withStatus } from "./capture";

describe("buildCapture", () => {
  it("serializes all provenance frontmatter keys and they round-trip", () => {
    const { markdown } = buildCapture(
      {
        source: "web",
        body: "Some clipped text",
        title: "A web clip",
        via: "user",
        url: "https://example.com/post",
        capturedAt: 1_700_000_000_000,
      },
      "cap1",
    );
    const { props, body } = rowFromMarkdown(markdown);
    expect(props).toMatchObject({
      title: "A web clip",
      source: "web",
      status: "unprocessed",
      capturedAt: 1_700_000_000_000,
      via: "user",
      url: "https://example.com/post",
    });
    expect(body.trim()).toBe("Some clipped text");
  });

  it("serializes web selections and highlights for Learn This captures", () => {
    const { markdown } = buildCapture(
      {
        source: "web",
        body: "Reader summary",
        title: "A web clip",
        url: "https://example.com/post",
        selection: "quoted paragraph",
        highlights: ["first highlight", "second highlight"],
        capturedAt: 1_700_000_000_000,
      },
      "cap-selection",
    );
    const { props, body } = rowFromMarkdown(markdown);
    expect(props.selection).toBe("quoted paragraph");
    expect(props.highlights).toEqual(["first highlight", "second highlight"]);
    expect(body).toContain("Reader summary");
  });

  it("serializes visual capture metadata and preserves the source image", () => {
    const { markdown } = buildCapture(
      {
        source: "image",
        body: "![Capture](../_assets/image.png)\n\nNote: Solve page 42.",
        title: "Textbook page",
        capturedAt: 1_700_000_000_000,
        assetPath: "image.png",
        originalName: "chapter-3-page-42.png",
        mime: "image/png",
        captureOrigin: "file",
        ocrStatus: "not-run",
      },
      "cap-image",
    );
    const { props, body } = rowFromMarkdown(markdown);
    expect(props).toMatchObject({
      title: "Textbook page",
      source: "image",
      status: "unprocessed",
      assetPath: "image.png",
      originalName: "chapter-3-page-42.png",
      mime: "image/png",
      captureOrigin: "file",
      ocrStatus: "not-run",
    });
    expect(body).toContain("![Capture](../_assets/image.png)");
    expect(body).toContain("Solve page 42.");
  });

  it("serializes email source metadata for monitor captures", () => {
    const { markdown } = buildCapture(
      {
        source: "email",
        body: "## Message\n\nPlease update tonight's roster.",
        title: "Bluebay roster change",
        capturedAt: 1_700_000_000_000,
        triageLabel: "action",
        triageReason: "Matched roster keyword.",
        triageConfidence: 0.9,
        emailAccount: "Ops inbox",
        messageId: "<msg-1@example.com>",
        folder: "INBOX",
        uid: 42,
      },
      "cap-email",
    );
    const { props, body } = rowFromMarkdown(markdown);
    expect(props).toMatchObject({
      title: "Bluebay roster change",
      source: "email",
      status: "unprocessed",
      triageLabel: "action",
      triageReason: "Matched roster keyword.",
      triageConfidence: 0.9,
      emailAccount: "Ops inbox",
      messageId: "<msg-1@example.com>",
      folder: "INBOX",
      uid: 42,
    });
    expect(body).toContain("Please update tonight's roster.");
  });

  it("omits optional fields (via/url) when absent", () => {
    const { markdown } = buildCapture(
      { source: "quick-note", body: "note", capturedAt: 1 },
      "cap2",
    );
    const { props } = rowFromMarkdown(markdown);
    expect(props.via).toBeUndefined();
    expect(props.url).toBeUndefined();
    expect(props.source).toBe("quick-note");
  });

  it("derives a title from the first non-empty body line when none given", () => {
    const { markdown } = buildCapture(
      { source: "quick-note", body: "\n  first line  \nsecond", capturedAt: 1 },
      "cap3",
    );
    const { props } = rowFromMarkdown(markdown);
    expect(props.title).toBe("first line");
  });

  it("falls back to a placeholder title for an empty body", () => {
    const { markdown } = buildCapture(
      { source: "quick-note", body: "   ", capturedAt: 1 },
      "cap4",
    );
    const { props } = rowFromMarkdown(markdown);
    expect(props.title).toBe("Untitled capture");
  });
});

describe("deriveTitle", () => {
  it("clamps long first lines to 80 chars with an ellipsis", () => {
    const long = "x".repeat(200);
    const title = deriveTitle(long);
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("withStatus", () => {
  it("updates status while preserving the captured body, idempotently", () => {
    const { markdown } = buildCapture(
      { source: "quick-note", body: "keep me", capturedAt: 1 },
      "cap5",
    );
    const processed = withStatus(markdown, "processed");
    const again = withStatus(processed, "processed");
    const { props, body } = rowFromMarkdown(again);
    expect(props.status).toBe("processed");
    expect(body.trim()).toBe("keep me");
    // No newline accumulation across repeated status patches.
    expect(again).toBe(processed);
  });
});
