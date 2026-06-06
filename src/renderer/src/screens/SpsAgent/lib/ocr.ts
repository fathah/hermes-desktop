// ocr.ts — offline OCR for scanned (no-text-layer) PDFs (BACKLOG item 2).
//
// Renders each page with pdf.js to a canvas and recognizes it with tesseract.js
// (WASM). Runs in the renderer: the tesseract worker keeps recognition OFF the
// UI thread, so the app stays responsive during a long scan. Fully offline —
// the worker, WASM core, and English model are bundled under /tesseract/ (see
// scripts/fetch-ocr-assets.mjs); the user's documents never leave the machine.
//
// Engine is good at typed-then-scanned text; handwriting is a known non-goal
// (it returns low-quality text rather than failing — the caller surfaces that).
import { createWorker, type Worker } from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ~2x renders a typical 72dpi page to ~150dpi — legible for OCR without
// ballooning canvas memory.
const RENDER_SCALE = 2;

/** Resolve a bundled asset against the document base (works under dev http and
 *  prod file://, where absolute "/tesseract" would not resolve). */
function asset(p: string): string {
  return new URL(p, document.baseURI).href;
}

let workerPromise: Promise<Worker> | null = null;

/** Lazily create and reuse one tesseract worker (loading the 11 MB model once). */
function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      workerPath: asset("tesseract/worker.min.js"),
      corePath: asset("tesseract/tesseract-core-simd.wasm.js"),
      langPath: asset("tesseract"),
      workerBlobURL: true,
    });
  }
  return workerPromise;
}

export interface OcrProgress {
  page: number;
  pages: number;
}

/**
 * OCR a scanned PDF (raw bytes) into `## Page N` markdown — the same shape
 * `extractPdfToMarkdown` produces, so it feeds the existing ingestion path.
 * Throws on a hard failure (corrupt PDF, no canvas); the caller decides how to
 * surface it.
 */
export async function ocrPdfToMarkdown(
  bytes: Uint8Array,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  const worker = await getOcrWorker();
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const sections: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.({ page: n, pages: doc.numPages });
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas context for OCR rendering");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      const text = (data.text || "").trim();
      sections.push(text ? `## Page ${n}\n\n${text}` : `## Page ${n}`);
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0; // release the bitmap
    }
  } finally {
    await doc.destroy();
  }
  return sections.join("\n\n");
}

/** Terminate the shared OCR worker (call when idle / on teardown). */
export async function disposeOcrWorker(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (pending) {
    const w = await pending.catch(() => null);
    if (w) await w.terminate();
  }
}
