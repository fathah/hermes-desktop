// ocrQueue.ts — persistent OCR job queue (BACKLOG item 2, P2).
//
// A scanned PDF can take minutes to OCR, and a user may drop several at once.
// We persist the pending jobs in localStorage so a batch (a) drains sequentially
// in the background while the app is open and (b) RESUMES across restarts — the
// job references the file path, which still exists, so an interrupted job just
// re-OCRs on next launch (no partial pages: the page is only created after a
// job fully completes). Keyed list, FIFO.
const KEY = "hermes-ocr-queue-v1";

export interface OcrJob {
  id: string;
  filePath: string;
  title: string;
  pageCount: number;
  addedAt: number;
}

/** Read the pending queue (FIFO). Never throws. */
export function loadOcrQueue(): OcrJob[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OcrJob[]) : [];
  } catch {
    return [];
  }
}

function saveOcrQueue(jobs: OcrJob[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* quota / unavailable — best effort */
  }
}

/** Append a job (deduped by filePath so a double-import doesn't queue twice). */
export function enqueueOcrJob(job: OcrJob): OcrJob[] {
  const jobs = loadOcrQueue().filter((j) => j.filePath !== job.filePath);
  jobs.push(job);
  saveOcrQueue(jobs);
  return jobs;
}

/** Remove a job by id (on completion or terminal error). */
export function removeOcrJob(id: string): OcrJob[] {
  const jobs = loadOcrQueue().filter((j) => j.id !== id);
  saveOcrQueue(jobs);
  return jobs;
}

/** The next job to process (FIFO head), or null when the queue is empty. */
export function peekOcrJob(): OcrJob | null {
  return loadOcrQueue()[0] ?? null;
}
