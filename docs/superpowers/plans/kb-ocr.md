# Plan — KB OCR for scanned PDFs (BACKLOG item 2)

**Status:** ✅ COMPLETE — P1+P2+P3 shipped (2026-06-06) · **Owner:** SPS Agent / KB ingestion

## Goal

Let scanned / image-only PDFs (no usable text layer → `reason:"missing"` from
`extractPdfToMarkdown`) ingest into the KB by OCR'ing them to markdown, then
feeding the existing ingestion path (`pageFromMarkdown` → `makePage` → the
"Sources" folder, item 4).

## Decisions (from brainstorming, 2026-06-05)

- **Engine: `tesseract.js` (WASM), fully offline.** Cloud OCR is privacy-
  disqualifying for the user's scanned contracts / incident reports. Offline
  tesseract handles **typed-then-scanned** docs (the user's primary case) well;
  **handwriting is a known non-goal** (tesseract is poor at it — flag low
  confidence, don't pretend).
- **Rendering: pdfjs page → canvas → tesseract.** pdfjs (`pdfjs-dist@4.x`,
  already a dep) renders each page to a bitmap; tesseract OCRs it.
- **Offline assets bundled** (no CDN): tesseract worker + core WASM +
  `eng.traineddata` shipped in app resources; tesseract pointed at local paths.
- **Hosts:** OCR logic is host-agnostic and runs in two places:
  - **Visible renderer** (P1/P2) — already has `canvas` + runs tesseract in a
    Web Worker (off the UI thread) → non-blocking "background while app open".
  - **Hidden offscreen `BrowserWindow`** (P3) — main spawns a `show:false`
    window with the same OCR page for **headless** scheduled runs (no native
    `node-canvas` dep). Only needed when there's no visible window to host it.
- **"Overnight" reality:** an Electron app does not run when fully quit. We build
  (1) **background-while-open** drain of a persistent queue + (2) a
  **scheduled in-app nightly drain** (fires only if the app is open/in tray at
  that time). We explicitly do **NOT** build a true OS daemon (launchd/Task
  Scheduler) — disproportionate, platform-specific, a background-service surface.

## Phases

### P1 — headless-capable OCR engine + single-doc flow ⟵ start here

- Add `tesseract.js`; bundle offline assets (worker/core WASM/`eng.traineddata`).
- Renderer OCR module `ocrPdfToMarkdown(bytes, { onProgress })`: pdfjs render each
  page → tesseract recognize → `## Page N` markdown. Per-page progress; tesseract
  worker so the UI stays responsive.
- IPC to hand the renderer the PDF bytes (`spsReadFileBytes` or reuse `readFile`).
- `importPdf`: on `reason:"missing"`, **pre-message** ("scanned doc — OCR runs in
  the background, we'll notify you when it's ready; large scans can take a while"),
  run OCR, then `makePage` into **Sources** + completion toast. Long-scan warning
  by page count.
- **Acceptance:** a real typed-then-scanned PDF ingests as readable text under
  Sources; UI stays responsive during OCR; handwriting yields visibly-degraded
  text (not a crash). Proves quality before P2/P3.

### P2 — persistent queue + batch

- On-disk OCR job queue under the profile (survives restart): `{path, status,
pagesDone, pageCount}`. Drains in the background, low-priority, while the app is
  open; **drain-on-launch** resumes interrupted jobs.
- Multi-doc: importing several scanned PDFs enqueues them; processed sequentially;
  per-doc completion notify.
- Progress surface (queue status + per-doc page progress).
- **Acceptance:** drop N scanned PDFs, walk away, all land in Sources; closing /
  reopening mid-batch resumes.

### P3 — scheduled nightly drain (headless)

- Hidden offscreen `BrowserWindow` host so the queue can drain with no visible
  window (minimized/tray).
- A configurable nightly drain window via the existing cronjobs infra + a "run
  batch now" action. UI states the "only runs if the app is open at that time"
  caveat.
- **Acceptance:** with the app left open/in tray, a queued batch drains at the
  configured time.

## Costs / risks

- **Bundle +~10–20 MB** (tesseract core WASM + eng data + pdfjs in renderer).
- Native-dep avoided by design (offscreen window, not `node-canvas`).
- OCR quality on real scans is the gating unknown — P1 measures it first.
- `tesseract.js` offline asset wiring (corePath/workerPath/langPath) is the
  fiddly part; verify no CDN fetch at runtime (privacy).

## Verification per phase

Both typechecks → eslint touched → `vitest` (pure OCR helpers: page→markdown
assembly, queue transitions) → build → `sps-import-smoke` extended with a scanned
fixture asserting OCR'd text lands under Sources. Pure logic to vitest; the WASM/
canvas path to the smoke.
