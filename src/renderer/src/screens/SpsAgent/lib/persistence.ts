// persistence.ts — workspace persistence through the Electron main process
// (durable JSON under the active profile's home dir). Replaces the standalone
// localStorage adapter. Load is async (IPC); the store hydrates after mount.
//
// Also drives the additive markdown mirror (S2b): pages are exported to markdown
// files so the substrate + note-index materialize. The JSON blob above stays the
// authoritative store — mirroring is best-effort and never read back as truth.
import { pageToMarkdown } from "../editor/pageMarkdown";
import type { Block, PageMeta, Workspace } from "../types";

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
    return (data as Workspace | null) ?? null;
  } catch {
    return null;
  }
}

export function saveWorkspace(ws: Workspace): void {
  try {
    void window.hermesAPI.spsSave(ws);
  } catch {
    /* main unavailable — fail silent */
  }
}

export function clearWorkspace(): void {
  try {
    void window.hermesAPI.spsSave(null);
  } catch {
    /* ignore */
  }
}
