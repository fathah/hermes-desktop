// pdf-extract.ts — KB Phase 0: a stateless PDF → markdown extractor.
//
// Reads a text-layer PDF and returns markdown the SPS editor can ingest via
// `pageFromMarkdown` → `makePage`. It writes NOTHING; the caller turns the
// result into a real workspace page (so markdown-on-disk stays authoritative
// and the note index picks it up as an additive mirror).
//
// Scope (see docs plan): text-layer PDFs only. Scanned/image PDFs have no text
// layer — we DETECT that (`hasTextLayer: false`) and let the caller refuse,
// rather than ingest OCR-less garbage. OCR is out of scope.
//
// pdfjs-dist is ESM and marked `external` in electron.vite.config.ts, so we load
// it with a dynamic import (the bundled main process is CJS) and use the
// `legacy` build, which runs under Node without a browser worker.
import { readFile } from "fs/promises";
import { basename, extname } from "path";

export interface PdfExtractResult {
  /** Best-effort document title (PDF metadata title, else the file name). */
  title: string;
  /** Markdown body: one `## Page N` section per page, paragraphs preserved. */
  markdown: string;
  /** Number of pages parsed. */
  pageCount: number;
  /**
   * False when the PDF has no *usable* text layer — either none at all (scanned)
   * or one that decodes to garbage (unmappable custom font). See `reason`.
   */
  hasTextLayer: boolean;
  /**
   * Why a text layer was rejected, for distinct caller messaging. Undefined when
   * `hasTextLayer` is true. `"missing"` ⇒ scanned/image-only (needs OCR).
   * `"unreadable"` ⇒ a text layer exists but decodes to nonsense (broken font
   * encoding, no ToUnicode cmap).
   */
  reason?: "missing" | "unreadable";
}

// Below this many non-whitespace characters per page on average we treat the
// document as having no usable text layer (scanned images return ~nothing).
const MIN_CHARS_PER_PAGE = 8;

// Intelligibility gate. A PDF with an embedded custom font but no ToUnicode cmap
// extracts a text layer of the right LENGTH but substituted glyphs — real char
// count, no real words — so `hasUsableTextLayer` (a char-count floor) passes it.
// We additionally require the text to read like real English prose: a minimum
// share of its word tokens must be common English words. Garbage scores ~0;
// genuine English (incl. technical/legal) scores well above the floor.
//
// Scope note: this assumes Latin-script English (the product's grounding
// language). A non-English document could fall below the floor — so we only
// judge once there is a substantial sample, and a fail is surfaced as
// "unreadable encoding", never a hard error. Broader language coverage would
// need real language detection (out of scope).
const MIN_WORDS_FOR_INTELLIGIBILITY = 40;
const MIN_COMMON_WORD_RATIO = 0.05;

// The ~120 most frequent English words. Function words dominate real prose
// (typically 25–50% of tokens), so their near-total absence is a strong garbage
// signal. Deliberately small and dependency-free.
const COMMON_WORDS = new Set([
  "the",
  "of",
  "and",
  "to",
  "a",
  "in",
  "that",
  "is",
  "was",
  "he",
  "for",
  "it",
  "with",
  "as",
  "his",
  "on",
  "be",
  "at",
  "by",
  "i",
  "this",
  "had",
  "not",
  "are",
  "but",
  "from",
  "or",
  "have",
  "an",
  "they",
  "which",
  "one",
  "you",
  "were",
  "her",
  "all",
  "she",
  "there",
  "would",
  "their",
  "we",
  "him",
  "been",
  "has",
  "when",
  "who",
  "will",
  "more",
  "no",
  "if",
  "out",
  "so",
  "said",
  "what",
  "up",
  "its",
  "about",
  "than",
  "into",
  "them",
  "can",
  "only",
  "other",
  "new",
  "some",
  "could",
  "time",
  "these",
  "two",
  "may",
  "then",
  "do",
  "first",
  "any",
  "my",
  "now",
  "such",
  "like",
  "our",
  "over",
  "man",
  "me",
  "even",
  "most",
  "made",
  "also",
  "did",
  "many",
  "before",
  "must",
  "through",
  "back",
  "years",
  "where",
  "much",
  "your",
  "way",
  "well",
  "down",
  "should",
  "because",
  "each",
  "just",
  "those",
  "people",
  "how",
  "too",
  "little",
  "state",
  "good",
  "very",
  "make",
  "world",
  "still",
  "see",
  "own",
  "men",
  "work",
  "long",
  "get",
  "here",
  "between",
  "both",
  "life",
  "being",
  "under",
  "never",
  "same",
  "another",
  "know",
  "while",
  "last",
  "might",
  "us",
  "great",
  "old",
  "year",
  "off",
  "come",
  "since",
  "against",
  "go",
  "came",
  "right",
  "used",
  "take",
  "three",
]);

/** Load pdfjs' Node-safe legacy build once, lazily. */
async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  // The legacy ESM build is the supported way to run pdf.js under Node.
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return mod as unknown as typeof import("pdfjs-dist");
}

/**
 * Whether the accumulated text is enough to call this a real text layer.
 * Pure, so it is unit-testable without invoking pdf.js. Scanned PDFs return
 * ~no text, so a per-page average below the floor ⇒ likely needs OCR.
 */
export function hasUsableTextLayer(
  totalNonSpaceChars: number,
  pageCount: number,
): boolean {
  return totalNonSpaceChars >= MIN_CHARS_PER_PAGE * Math.max(1, pageCount);
}

/**
 * Fraction of a text's alphabetic word tokens that are common English words.
 * 0 when there are no alphabetic words. Pure/testable.
 */
export function commonWordRatio(text: string): number {
  const words = text.toLowerCase().match(/[a-z]+/g);
  if (!words || words.length === 0) return 0;
  let common = 0;
  for (const word of words) {
    if (COMMON_WORDS.has(word)) common++;
  }
  return common / words.length;
}

/**
 * Whether an extracted text layer reads like real (English) prose rather than
 * unmappable-font garbage that has the right character count but no real words.
 * Short samples get the benefit of the doubt (too little signal to judge).
 * Pure/testable — see the COMMON_WORDS / threshold rationale above.
 */
export function looksIntelligible(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]+/g);
  if (!words || words.length < MIN_WORDS_FOR_INTELLIGIBILITY) return true;
  return commonWordRatio(text) >= MIN_COMMON_WORD_RATIO;
}

/** Join a page's text items into paragraphs, using pdf.js line markers. */
export function itemsToText(
  items: Array<{ str: string; hasEOL?: boolean }>,
): string {
  const parts: string[] = [];
  for (const item of items) {
    parts.push(item.str);
    if (item.hasEOL) parts.push("\n");
  }
  const raw = parts.join("");
  // Collapse the single newlines pdf.js emits per visual line into paragraph
  // breaks on blank lines, and trim trailing whitespace per line.
  const lines = raw.split("\n").map((l) => l.replace(/\s+$/g, ""));
  const collapsed = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  return collapsed.trim();
}

/**
 * Extract a text-layer PDF into markdown. Never throws on a malformed text
 * layer — it returns `hasTextLayer: false` so the caller can surface a clean
 * "needs OCR" message instead of an error.
 */
export async function extractPdfToMarkdown(
  filePath: string,
): Promise<PdfExtractResult> {
  const fileTitle = basename(filePath, extname(filePath));
  const pdfjs = await loadPdfjs();

  const buffer = await readFile(filePath);
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data,
    // Node has no DOM worker; the legacy build runs on the main thread.
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  let metaTitle = "";
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: unknown } | undefined;
    if (info && typeof info.Title === "string") metaTitle = info.Title.trim();
  } catch {
    /* metadata is optional */
  }

  const pageCount = doc.numPages;
  const sections: string[] = [];
  let totalChars = 0;

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; hasEOL?: boolean }>;
    const text = itemsToText(items);
    totalChars += text.replace(/\s/g, "").length;
    const heading = `## Page ${pageNum}`;
    sections.push(text ? `${heading}\n\n${text}` : heading);
    page.cleanup();
  }
  await doc.destroy();

  const title = metaTitle || fileTitle;
  const markdown = sections.join("\n\n");

  // Two-stage gate: enough text at all, then is that text intelligible. A doc
  // can clear the char-count floor yet decode to garbage (unmappable font).
  if (!hasUsableTextLayer(totalChars, pageCount)) {
    return {
      title,
      markdown,
      pageCount,
      hasTextLayer: false,
      reason: "missing",
    };
  }
  if (!looksIntelligible(markdown)) {
    return {
      title,
      markdown,
      pageCount,
      hasTextLayer: false,
      reason: "unreadable",
    };
  }

  return { title, markdown, pageCount, hasTextLayer: true };
}
