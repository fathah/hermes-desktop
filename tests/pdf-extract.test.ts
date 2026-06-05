import { describe, it, expect } from "vitest";
import { itemsToText, hasUsableTextLayer } from "../src/main/pdf-extract";

// Pure-logic unit tests. The actual pdfjs binding (getDocument → text content)
// is exercised end-to-end by scripts/sps-smoke.mjs against a real PDF, per the
// repo's split: heavy/native code → harness, pure logic → vitest.

describe("itemsToText", () => {
  it("joins items and breaks lines on pdf.js EOL markers", () => {
    const text = itemsToText([
      { str: "Hello " },
      { str: "world", hasEOL: true },
      { str: "second line", hasEOL: true },
    ]);
    expect(text).toBe("Hello world\nsecond line");
  });

  it("collapses 3+ blank lines into a single paragraph break", () => {
    const text = itemsToText([
      { str: "a", hasEOL: true },
      { str: "", hasEOL: true },
      { str: "", hasEOL: true },
      { str: "b", hasEOL: true },
    ]);
    expect(text).toBe("a\n\nb");
  });

  it("trims surrounding whitespace", () => {
    expect(itemsToText([{ str: "  padded  ", hasEOL: true }])).toBe("padded");
  });
});

describe("hasUsableTextLayer", () => {
  it("is true when there is enough text per page (real text layer)", () => {
    expect(hasUsableTextLayer(500, 3)).toBe(true);
  });

  it("is false when a multi-page doc yields almost no text (scanned ⇒ OCR)", () => {
    expect(hasUsableTextLayer(2, 50)).toBe(false);
  });

  it("treats a zero-page edge case as single-page for the floor", () => {
    expect(hasUsableTextLayer(0, 0)).toBe(false);
    expect(hasUsableTextLayer(100, 0)).toBe(true);
  });
});
