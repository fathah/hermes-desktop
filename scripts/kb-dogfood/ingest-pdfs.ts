// PDF ingestion for the KB dogfood — drives the product's REAL extractor
// (extractPdfToMarkdown) so a real-PDF run exercises the same ingestion path the
// app uses, not hand-written markdown. Writes one <slug>.md per text-layer PDF
// into CORPUS_DIR (frontmatter title + extracted body). Scanned/image-only PDFs
// (no usable text layer) are reported and skipped — that's backlog item 2 (OCR),
// unbuilt.
//
// Inputs (env):
//   PDF_PATHS  — newline-separated absolute PDF paths (newline-sep tolerates spaces)
//   CORPUS_DIR — output vault dir for the extracted .md files
//
// Run under Electron's node (ELECTRON_RUN_AS_NODE=1); pdfjs loads via the same
// dynamic import the main process uses.
import { mkdir, writeFile } from "fs/promises";
import { basename, extname, join } from "path";
import { extractPdfToMarkdown } from "../../src/main/pdf-extract";

const CORPUS_DIR = process.env.CORPUS_DIR;
const PDF_PATHS = (process.env.PDF_PATHS || "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

function slug(p: string): string {
  return basename(p, extname(p))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function frontmatter(title: string, source: string): string {
  const safe = title.replace(/"/g, "'");
  return `---\ntitle: "${safe}"\ndoc_type: pdf\nsource: "${source}"\n---\n\n`;
}

async function main(): Promise<void> {
  if (!CORPUS_DIR) throw new Error("CORPUS_DIR not set");
  if (PDF_PATHS.length === 0) throw new Error("PDF_PATHS not set");
  await mkdir(CORPUS_DIR, { recursive: true });

  console.log(`Ingesting ${PDF_PATHS.length} PDF(s) → ${CORPUS_DIR}\n`);
  const manifest: Array<{
    file: string;
    title: string;
    pages: number;
    chars: number;
    ok: boolean;
  }> = [];

  for (const pdf of PDF_PATHS) {
    const src = basename(pdf);
    try {
      const t0 = Number(process.hrtime.bigint() / 1000000n);
      const { title, markdown, pageCount, hasTextLayer } =
        await extractPdfToMarkdown(pdf);
      const t1 = Number(process.hrtime.bigint() / 1000000n);
      if (!hasTextLayer) {
        console.log(
          `  SKIP  ${src} — no usable text layer (needs OCR), ${pageCount}p`,
        );
        manifest.push({
          file: src,
          title,
          pages: pageCount,
          chars: 0,
          ok: false,
        });
        continue;
      }
      const out = join(CORPUS_DIR, `${slug(pdf)}.md`);
      await writeFile(out, frontmatter(title, src) + markdown);
      console.log(
        `  OK    ${src} → ${basename(out)}  (${pageCount}p, ${markdown.length} chars, ${t1 - t0}ms)`,
      );
      manifest.push({
        file: src,
        title,
        pages: pageCount,
        chars: markdown.length,
        ok: true,
      });
    } catch (err) {
      console.log(
        `  FAIL  ${src} — ${err instanceof Error ? err.message : String(err)}`,
      );
      manifest.push({ file: src, title: "", pages: 0, chars: 0, ok: false });
    }
  }

  console.log(
    `\nIngested ${manifest.filter((m) => m.ok).length}/${PDF_PATHS.length} as markdown.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
