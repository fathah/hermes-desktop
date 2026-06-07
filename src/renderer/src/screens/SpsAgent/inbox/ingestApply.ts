// ingestApply.ts — shared commit path for an ingest changeset.
//
// One place that turns a proposed changeset into committed state, used by both
// the manual review queue (with per-item skips) and the auto-apply / scheduled
// path. Commits pages through the store (so they show in both storage modes),
// appends accepted memory facts (MEMORY.md, revertable in the Memory tab), and
// flips each capture's status. Page-commit goes through the caller-supplied
// store action so this stays free of direct store coupling.
import { withStatus, INBOX_FOLDER, type CaptureStatus } from "./capture";

export interface IngestPageProposal {
  op: "create" | "update";
  pageId: string;
  title: string;
  markdown: string;
}
export interface IngestChangeset {
  summary: string;
  pages: IngestPageProposal[];
  captures: Array<{ id: string; status: "processed" | "discarded" }>;
  memory: string[];
}

export interface CommitOptions {
  profile?: string;
  skipPages?: Set<string>;
  skipMemory?: Set<number>;
}

/** Commit a changeset. Returns how many pages/memory entries actually landed. */
export async function commitChangeset(
  cs: IngestChangeset,
  commitPage: (page: IngestPageProposal) => void,
  opts: CommitOptions = {},
): Promise<{ pages: number; memory: number }> {
  const api = window.hermesAPI;
  let pages = 0;
  for (const page of cs.pages) {
    if (opts.skipPages?.has(page.pageId)) continue;
    commitPage(page);
    pages++;
  }
  let memory = 0;
  if (api?.addMemoryEntry) {
    for (let i = 0; i < cs.memory.length; i++) {
      if (opts.skipMemory?.has(i)) continue;
      await api.addMemoryEntry(cs.memory[i], opts.profile);
      memory++;
    }
  }
  if (api?.spsReadRow && api?.spsExportRow) {
    for (const cap of cs.captures) {
      const current = await api.spsReadRow(INBOX_FOLDER, cap.id, opts.profile);
      if (current == null) continue;
      await api.spsExportRow(
        INBOX_FOLDER,
        cap.id,
        withStatus(current, cap.status as CaptureStatus),
        opts.profile,
      );
    }
  }
  return { pages, memory };
}

export type AutoIngestResult =
  | { ok: false; error: string }
  | {
      ok: true;
      pages: number;
      memory: number;
      captures: number;
      summary: string;
    };

/** Run ingest and commit everything (no review). For auto-apply / scheduling. */
export async function runAutoIngest(
  commitPage: (page: IngestPageProposal) => void,
  profile?: string,
): Promise<AutoIngestResult> {
  const res = await window.hermesAPI.spsIngestInbox?.(profile);
  if (!res?.ok || !res.changeset) {
    return { ok: false, error: res?.error ?? "Ingest is unavailable." };
  }
  const { pages, memory } = await commitChangeset(res.changeset, commitPage, {
    profile,
  });
  return {
    ok: true,
    pages,
    memory,
    captures: res.changeset.captures.length,
    summary: res.changeset.summary,
  };
}
