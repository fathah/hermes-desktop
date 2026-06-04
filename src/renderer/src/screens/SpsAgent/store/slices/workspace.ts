// workspace.ts — tree, page meta, docs, trash + all page/tree/doc actions.
// Ported from app.jsx (selectPage, makePage, deletePage, …) and store.jsx tree ops.
import type { StateCreator } from "zustand";
import { blk, uid } from "../../lib/ids";
import { clearWorkspace } from "../../lib/persistence";
import { getStorageMode } from "../../lib/storageMode";
import { deleteVaultPages } from "../../lib/vaultStore";
import {
  treeFind,
  treeInsert,
  treeMove,
  treeRemove,
  treeWalkIds,
} from "../../lib/tree";
import { buildInitialWorkspace } from "../../data/seed";
import { initialWorkspace as initial } from "../initial";
import type { Block } from "../../types";
import type { Store, WorkspaceSlice } from "../storeTypes";

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
      return { docs: { ...s.docs, [s.page]: updater(cur) } };
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
