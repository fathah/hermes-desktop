// workspace.ts — tree, page meta, docs, trash + all page/tree/doc actions.
// Ported from app.jsx (selectPage, makePage, deletePage, …) and store.jsx tree ops.
import type { StateCreator } from "zustand";
import { blk, uid } from "../../lib/ids";
import { clearWorkspace } from "../../lib/persistence";
import { getStorageMode } from "../../lib/storageMode";
import { deleteVaultPages, deleteVaultDbFolders } from "../../lib/vaultStore";
import {
  treeFind,
  treeInsert,
  treeMove,
  treeRemove,
  treeWalkIds,
} from "../../lib/tree";
import { buildInitialWorkspace } from "../../data/seed";
import { initialWorkspace as initial } from "../initial";
import { pageFromMarkdown } from "../../editor/pageMarkdown";
import type { Block } from "../../types";
import type { Store, WorkspaceSlice } from "../storeTypes";

/** Title of the root folder that ingested documents are filed under. */
const SOURCES_TITLE = "Sources";

/** The `source` folders of folder-backed database blocks in a block list. */
function dbSources(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type === "database" && b.source) out.add(b.source);
  }
  return out;
}

export const createWorkspaceSlice: StateCreator<
  Store,
  [],
  [],
  WorkspaceSlice
> = (set, get) => ({
  tree: initial.tree,
  meta: initial.meta,
  trash: initial.trash,
  page: initial.page in (initial.docs || {}) ? initial.page : "home",
  docs: initial.docs,

  setBlocks: (updater) =>
    set((s) => {
      const cur = s.docs[s.page] || [];
      const next = updater(cur);
      // F3: in vault mode, removing a folder-backed database block orphans its
      // row folder on disk. Clean it up — but only if no other page (nor the new
      // current page) still references that source (best-effort, never throws).
      if (getStorageMode() === "vault") {
        const after = dbSources(next);
        const removed = [...dbSources(cur)].filter((src) => !after.has(src));
        if (removed.length) {
          const stillUsed = new Set<string>(after);
          for (const [pid, blocks] of Object.entries(s.docs)) {
            if (pid === s.page) continue;
            for (const src of dbSources(blocks)) stillUsed.add(src);
          }
          const orphaned = removed.filter((src) => !stillUsed.has(src));
          if (orphaned.length) void deleteVaultDbFolders(orphaned);
        }
      }
      return { docs: { ...s.docs, [s.page]: next } };
    }),

  setPageDoc: (id, blocks) =>
    set((s) => ({ docs: { ...s.docs, [id]: blocks } })),

  selectPage: (id) =>
    set((s) => {
      if (id === s.page) return { paletteOpen: false };
      const docs = { ...s.docs };
      if (!docs[id]) docs[id] = [blk("p", "")];
      const meta = s.meta[id]
        ? s.meta
        : { ...s.meta, [id]: { icon: "📄", title: "Untitled", cover: null } };
      return { page: id, docs, meta, paletteOpen: false };
    }),

  makePage: (info, docBlocks, parentId) => {
    const id = uid("pg");
    set((s) => ({
      docs: { ...s.docs, [id]: docBlocks },
      meta: {
        ...s.meta,
        [id]: {
          icon: info.icon || "📄",
          title: info.title || "Untitled",
          cover: null,
          // KB ingestion provenance — only stamped when supplied.
          ...(info.source !== undefined ? { source: info.source } : {}),
          ...(info.ingestedAt !== undefined
            ? { ingestedAt: info.ingestedAt }
            : {}),
        },
      },
      tree: treeInsert(
        s.tree,
        parentId,
        { id, children: [] },
        parentId ? "inside" : "root",
      ),
    }));
    return id;
  },

  importPdf: async () => {
    const api = window.hermesAPI;
    if (!api?.spsPickPdf || !api?.spsExtractPdf) {
      get().flash("PDF import needs a local workspace");
      return;
    }
    set({ templatesOpen: null });
    const filePath = await api.spsPickPdf();
    if (!filePath) return;
    get().flash("Extracting PDF…");
    let res: Awaited<ReturnType<typeof api.spsExtractPdf>>;
    try {
      res = await api.spsExtractPdf(filePath);
    } catch {
      get().flash("Could not read that PDF", { tone: "warn", ms: 8000 });
      return;
    }
    if (!res.hasTextLayer) {
      // Persistent warn toast (not a 2.2s flash) so a refused import is noticed.
      get().flash(
        res.reason === "unreadable"
          ? "Unreadable text (broken font encoding) — not imported"
          : "No text layer — scanned PDFs need OCR (not imported)",
        { tone: "warn", ms: 8000 },
      );
      return;
    }
    const { blocks } = pageFromMarkdown(res.markdown);
    const docBlocks = blocks.length ? blocks : [blk("p", "")];
    const id = get().makePage(
      {
        icon: "📄",
        title: res.title,
        source: filePath,
        ingestedAt: Date.now(),
      },
      docBlocks,
      get().ensureSourcesFolder(),
    );
    set({ page: id });
    get().flash(`Imported “${res.title}” into Sources`);
  },

  ensureSourcesFolder: () => {
    // A dedicated home for ingested documents. Identified by title at the root
    // level (no persisted marker, so the markdown serializers stay untouched);
    // reused if present, created at root on first import.
    const { meta, tree } = get();
    const existing = tree.find((n) => meta[n.id]?.title === SOURCES_TITLE);
    if (existing) return existing.id;
    return get().makePage(
      { icon: "🗂️", title: SOURCES_TITLE },
      [
        blk(
          "p",
          "Imported documents live here — each ingested file becomes a page you can read, link, and ground the co-author on.",
        ),
      ],
      null,
    );
  },

  newSubPage: (parentId) => {
    const id = get().makePage(
      { icon: "📄", title: "Untitled" },
      [blk("p", "")],
      parentId,
    );
    set({ page: id });
    get().flash("Page created");
  },

  createChildPage: () => {
    const id = get().makePage(
      { icon: "📄", title: "Untitled" },
      [blk("p", "")],
      get().page,
    );
    get().flash("Sub-page created");
    return id;
  },

  createFromTemplate: (blocks, info, parent) => {
    const id = get().makePage(
      {
        icon: info.emoji,
        title: info.name === "Blank doc" ? "Untitled" : info.name,
      },
      blocks,
      parent,
    );
    set({ page: id, templatesOpen: null });
  },

  deletePage: (id) => {
    const target = id || get().page;
    if (target === "home") {
      get().flash("Home can't be deleted");
      return;
    }
    const { tree, meta } = get();
    const node = treeFind(tree, target);
    const ids = node ? treeWalkIds(node) : [target];
    set((s) => ({
      trash: [
        ...s.trash,
        {
          id: target,
          title: (meta[target] || {}).title || "Untitled",
          icon: (meta[target] || {}).icon || "📄",
          ids,
        },
      ],
      tree: treeRemove(s.tree, target)[0],
    }));
    get().flash("Moved to trash");
    if (ids.includes(get().page)) get().selectPage("home");
  },

  restorePage: (entry) => {
    set((s) => ({
      trash: s.trash.filter((x) => x.id !== entry.id),
      tree: treeInsert(s.tree, null, { id: entry.id, children: [] }, "root"),
    }));
    get().flash("Restored to workspace");
  },

  renamePage: (id, title) =>
    set((s) => ({ meta: { ...s.meta, [id]: { ...s.meta[id], title } } })),

  movePage: (dragId, targetId, where) =>
    set((s) => ({ tree: treeMove(s.tree, dragId, targetId, where) })),

  setPMeta: (patch) =>
    set((s) => ({
      meta: { ...s.meta, [s.page]: { ...s.meta[s.page], ...patch } },
    })),

  resetWorkspace: () => {
    const oldIds = Object.keys(get().docs);
    clearWorkspace();
    const fresh = buildInitialWorkspace();
    set({
      tree: fresh.tree,
      meta: fresh.meta,
      trash: fresh.trash,
      page: fresh.page,
      docs: fresh.docs as Record<string, Block[]>,
      comments: fresh.comments,
    });
    // F3: in vault mode the replaced pages are now orphan `<pageId>.md` files on
    // disk — remove the ones the fresh sample doesn't reuse (best-effort; the S6
    // manifest scoping already stops them resurrecting, this stops them lingering).
    // Note: deletePage only moves to trash, which stays restorable across reload
    // (its files are intentionally retained), so it must NOT delete here.
    if (getStorageMode() === "vault") {
      const kept = new Set(Object.keys(fresh.docs));
      void deleteVaultPages(oldIds.filter((id) => !kept.has(id)));
    }
    get().flash("Workspace reset to sample");
  },
});
