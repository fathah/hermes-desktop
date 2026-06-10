// persistence.ts — workspace persistence through the Electron main process
// (durable JSON under the active profile's home dir). Replaces the standalone
// localStorage adapter. Load is async (IPC); the store hydrates after mount.
//
// Also drives the additive markdown mirror (S2b): pages are exported to markdown
// files so the substrate + note-index materialize. The JSON blob above stays the
// authoritative store — mirroring is best-effort and never read back as truth.
import { pageToMarkdown } from "../editor/pageMarkdown";
import type { Block, PageMeta, Workspace, SpsSaveResult } from "../types";

// The base revision our in-memory workspace was derived from. Echoed back on
// every save so the main-process write queue can detect a stale base (a
// concurrent writer advanced the on-disk revision) and reload-merge instead of
// blind-overwriting. Updated from each successful save's result.
let baseRev: number | undefined;

/** Best-effort: mirror one page's blocks to its markdown file. */
export function mirrorPage(
  pageId: string,
  meta: Partial<PageMeta>,
  blocks: Block[],
): void {
  try {
    const api = window.hermesAPI;
    if (!api?.spsExportPage) return;
    void api.spsExportPage(pageId, pageToMarkdown(meta, blocks));
  } catch {
    /* mirror is non-authoritative — never let it disrupt editing */
  }
}

/** Best-effort: mirror every page (called once after hydrate). */
export function mirrorAllPages(ws: Workspace): void {
  for (const pageId of Object.keys(ws.docs)) {
    mirrorPage(pageId, ws.meta[pageId] ?? {}, ws.docs[pageId] ?? []);
  }
}

export async function loadWorkspace(): Promise<Workspace | null> {
  try {
    const data = await window.hermesAPI.spsLoad();
    if (data && typeof data === "object") {
      const rev = (data as { __rev?: unknown }).__rev;
      baseRev = typeof rev === "number" ? rev : undefined;
    }
    return (data as Workspace | null) ?? null;
  } catch {
    return null;
  }
}

/** Persist the workspace blob, returning the save outcome so callers can
 *  surface a persistent warning on failure. Tracks the on-disk revision across
 *  saves to drive the main-process stale-base reload-merge. */
export async function saveWorkspace(ws: Workspace): Promise<SpsSaveResult> {
  try {
    const result = await window.hermesAPI.spsSave(ws, undefined, baseRev);
    if (result.ok) baseRev = result.rev;
    return result;
  } catch (err) {
    // main unavailable — report as a failed save, don't throw into the subscriber
    return {
      ok: false,
      error: err instanceof Error ? err.message : "save unavailable",
      rev: baseRev ?? 0,
      merged: false,
    };
  }
}

export function clearWorkspace(): void {
  baseRev = undefined;
  try {
    void window.hermesAPI.spsSave(null);
  } catch {
    /* ignore */
  }
}
