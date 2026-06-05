import { describe, it, expect } from "vitest";
import {
  itemsToText,
  hasUsableTextLayer,
  looksIntelligible,
  commonWordRatio,
} from "../src/main/pdf-extract";

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

// A custom-font PDF with no ToUnicode cmap extracts a text layer of the right
// LENGTH but substituted glyphs — a real character count yet no real words.
// `hasUsableTextLayer` (a char-count floor) passes it; the intelligibility
// check is what actually refuses it. Sample below is representative of the
// real Buffett_Revisited.pdf extraction that motivated this fix.
const GARBAGE =
  "cLCCEDDdIPeE ODRGe BKKNFEHDIJ E ZRFE RCCEHOPX Y GRZKNFEW DME " +
  "KRDEHDPNI RC BKKIE CN RFN_IJ DR DME KRDEHDPNI RC OE EFNI cLCCEDD " +
  "pME PHDEHD MEFE PO HRD DR WECEHW RF E EH WPOGLOO PMEDMEF BKKIE PO " +
  "N cLCCED ODRGe pME PHDEHD PO DR NWWFEOO N GRZZRH ZPOKEFGEKDPRH " +
  "iPODRFPGNI OMNFE KFPGE KEFCRFZNHGE PH NH N_ORILDEIJ HR NJ NWWO";

const REAL_PROSE =
  "Economic theory has suffered in the past from a failure to state clearly " +
  "its assumptions. Economists in building up a theory have often omitted to " +
  "examine the foundations on which it was erected. This examination is " +
  "essential to prevent the misunderstanding which arises from a lack of " +
  "knowledge of the assumptions on which a theory is based.";

describe("commonWordRatio", () => {
  it("is high for English prose, ~zero for substituted-glyph garbage", () => {
    expect(commonWordRatio(REAL_PROSE)).toBeGreaterThan(0.3);
    expect(commonWordRatio(GARBAGE)).toBeLessThan(0.05);
  });

  it("is 0 for text with no alphabetic words", () => {
    expect(commonWordRatio("1234 5678 -- ///")).toBe(0);
  });
});

describe("looksIntelligible", () => {
  it("accepts real English prose", () => {
    expect(looksIntelligible(REAL_PROSE)).toBe(true);
  });

  it("rejects unmappable-font garbage (right length, no real words)", () => {
    expect(looksIntelligible(GARBAGE)).toBe(false);
  });

  it("gives short samples the benefit of the doubt (too little to judge)", () => {
    expect(looksIntelligible("Quarterly invoice total 4200")).toBe(true);
  });

  it("does not flag empty text", () => {
    expect(looksIntelligible("")).toBe(true);
  });
});
