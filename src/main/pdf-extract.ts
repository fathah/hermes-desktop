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
  /** False when the PDF has no usable text layer (likely scanned ⇒ needs OCR). */
  hasTextLayer: boolean;
}

// Below this many non-whitespace characters per page on average we treat the
// document as having no usable text layer (scanned images return ~nothing).
const MIN_CHARS_PER_PAGE = 8;

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

  const hasTextLayer = hasUsableTextLayer(totalChars, pageCount);
  const title = metaTitle || fileTitle;
  const markdown = sections.join("\n\n");

  return { title, markdown, pageCount, hasTextLayer };
}
