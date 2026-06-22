// workspace-dbcleanup.test.ts — F3: removing a folder-backed database block
// cleans up its vault row folder, but only in vault mode and only when no other
// page still references that source. IPC is stubbed; storage mode lives in
// localStorage (jsdom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStore } from "./index";
import { setStorageMode } from "../lib/storageMode";
import type { Block, PageMeta, TreeNode, TrashEntry } from "../types";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

function dbBlock(source: string): Block {
  return { id: `db-${source}`, type: "database", text: "", source };
}

function pBlock(id: string, text: string): Block {
  return { id, type: "p", text };
}

function meta(title: string): PageMeta {
  return { title, icon: "📄", cover: null };
}

beforeEach(() => {
  setStorageMode("blob");
  useStore.setState({
    tree: [],
    meta: {},
    docs: {},
    comments: [],
    trash: [],
    page: "home",
  });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  setStorageMode("blob");
  vi.restoreAllMocks();
});

describe("setBlocks — query-DB row-folder cleanup (F3)", () => {
  it("deletes the row folder when a db block is removed (vault mode)", async () => {
    setStorageMode("vault");
    const del = vi.fn().mockResolvedValue(true);
    stubApi({ spsDeleteDbFolder: del });
    useStore.setState({ page: "p1", docs: { p1: [dbBlock("projects")] } });

    useStore
      .getState()
      .setBlocks((bs) => bs.filter((b) => b.type !== "database"));

    await waitFor(() => expect(del).toHaveBeenCalledWith("projects"));
  });

  it("keeps the folder when another page still references the source", async () => {
    setStorageMode("vault");
    const del = vi.fn().mockResolvedValue(true);
    stubApi({ spsDeleteDbFolder: del });
    useStore.setState({
      page: "p1",
      docs: { p1: [dbBlock("projects")], p2: [dbBlock("projects")] },
    });

    useStore
      .getState()
      .setBlocks((bs) => bs.filter((b) => b.type !== "database"));

    await new Promise((r) => setTimeout(r, 30));
    expect(del).not.toHaveBeenCalled();
  });

  it("does nothing in blob mode", async () => {
    setStorageMode("blob");
    const del = vi.fn().mockResolvedValue(true);
    stubApi({ spsDeleteDbFolder: del });
    useStore.setState({ page: "p1", docs: { p1: [dbBlock("projects")] } });

    useStore
      .getState()
      .setBlocks((bs) => bs.filter((b) => b.type !== "database"));

    await new Promise((r) => setTimeout(r, 30));
    expect(del).not.toHaveBeenCalled();
  });
});

describe("deletePage / restorePage", () => {
  const nestedTree: TreeNode = {
    id: "parent",
    children: [
      {
        id: "child",
        children: [{ id: "grandchild", children: [] }],
      },
    ],
  };

  it("restores a trashed page with its nested subtree", () => {
    useStore.setState({
      tree: [{ id: "home", children: [] }, nestedTree],
      docs: {
        home: [pBlock("home-block", "Home")],
        parent: [pBlock("parent-block", "Parent")],
        child: [pBlock("child-block", "Child")],
        grandchild: [pBlock("grandchild-block", "Grandchild")],
      },
      meta: {
        home: meta("Home"),
        parent: meta("Parent"),
        child: meta("Child"),
        grandchild: meta("Grandchild"),
      },
      page: "child",
    });

    useStore.getState().deletePage("parent");

    const entry = useStore.getState().trash[0];
    expect(entry.ids).toEqual(["parent", "child", "grandchild"]);
    expect(entry.subtree).toEqual(nestedTree);
    expect(useStore.getState().tree).toEqual([{ id: "home", children: [] }]);
    expect(useStore.getState().page).toBe("home");

    useStore.getState().restorePage(entry);

    expect(useStore.getState().trash).toEqual([]);
    expect(useStore.getState().tree).toEqual([
      { id: "home", children: [] },
      nestedTree,
    ]);
  });

  it("restores legacy trash entries without subtree data as visible children", () => {
    const entry: TrashEntry = {
      id: "parent",
      title: "Parent",
      icon: "📄",
      ids: ["parent", "child", "grandchild"],
    };
    useStore.setState({
      tree: [{ id: "home", children: [] }],
      trash: [entry],
      docs: {
        parent: [pBlock("parent-block", "Parent")],
        child: [pBlock("child-block", "Child")],
        grandchild: [pBlock("grandchild-block", "Grandchild")],
      },
      meta: {
        parent: meta("Parent"),
        child: meta("Child"),
        grandchild: meta("Grandchild"),
      },
    });

    useStore.getState().restorePage(entry);

    expect(useStore.getState().trash).toEqual([]);
    expect(useStore.getState().tree).toEqual([
      { id: "home", children: [] },
      {
        id: "parent",
        children: [
          { id: "child", children: [] },
          { id: "grandchild", children: [] },
        ],
      },
    ]);
  });
});

describe("purgeTrashedPage", () => {
  it("permanently removes a trashed page and its vault files", async () => {
    const deletePage = vi.fn().mockResolvedValue(true);
    const deleteFolder = vi.fn().mockResolvedValue(true);
    stubApi({ spsDeletePage: deletePage, spsDeleteDbFolder: deleteFolder });
    useStore.setState({
      docs: {
        p1: [dbBlock("projects")],
        child: [{ id: "child-block", type: "p", text: "Child" }],
        grandchild: [{ id: "grandchild-block", type: "p", text: "Grandchild" }],
      },
      meta: {
        p1: { title: "Trashed project", icon: "📄", cover: null },
        child: { title: "Child", icon: "📄", cover: null },
        grandchild: { title: "Grandchild", icon: "📄", cover: null },
      },
      trash: [
        {
          id: "p1",
          title: "Trashed project",
          icon: "📄",
          ids: ["p1", "child", "grandchild"],
        },
      ],
      comments: [
        {
          id: "c1",
          blockId: "child-block",
          quote: "Remove me",
          page: "child",
          resolved: false,
          messages: [],
        },
        {
          id: "c3",
          blockId: "grandchild-block",
          quote: "Remove me too",
          page: "grandchild",
          resolved: false,
          messages: [],
        },
        {
          id: "c2",
          blockId: "other-block",
          quote: "Keep me",
          page: "other",
          resolved: false,
          messages: [],
        },
      ],
    });

    useStore.getState().purgeTrashedPage(useStore.getState().trash[0]);

    expect(useStore.getState().trash).toEqual([]);
    expect(useStore.getState().docs.p1).toBeUndefined();
    expect(useStore.getState().docs.child).toBeUndefined();
    expect(useStore.getState().docs.grandchild).toBeUndefined();
    expect(useStore.getState().meta.p1).toBeUndefined();
    expect(useStore.getState().meta.child).toBeUndefined();
    expect(useStore.getState().meta.grandchild).toBeUndefined();
    expect(useStore.getState().comments).toEqual([
      {
        id: "c2",
        blockId: "other-block",
        quote: "Keep me",
        page: "other",
        resolved: false,
        messages: [],
      },
    ]);
    await waitFor(() => expect(deletePage).toHaveBeenCalledWith("p1"));
    expect(deletePage).toHaveBeenCalledWith("child");
    expect(deletePage).toHaveBeenCalledWith("grandchild");
    expect(deleteFolder).toHaveBeenCalledWith("projects");
  });

  it("keeps a database row folder that a live page still references", async () => {
    const deletePage = vi.fn().mockResolvedValue(true);
    const deleteFolder = vi.fn().mockResolvedValue(true);
    stubApi({ spsDeletePage: deletePage, spsDeleteDbFolder: deleteFolder });
    useStore.setState({
      docs: {
        trashed: [dbBlock("projects")],
        live: [dbBlock("projects")],
      },
      meta: {
        trashed: meta("Trashed DB"),
        live: meta("Live DB"),
      },
      trash: [
        {
          id: "trashed",
          title: "Trashed DB",
          icon: "📄",
          ids: ["trashed"],
        },
      ],
      comments: [],
    });

    useStore.getState().purgeTrashedPage(useStore.getState().trash[0]);

    await waitFor(() => expect(deletePage).toHaveBeenCalledWith("trashed"));
    expect(deleteFolder).not.toHaveBeenCalled();
  });
});
