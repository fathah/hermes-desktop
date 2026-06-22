// workspace-dbcleanup.test.ts — F3: removing a folder-backed database block
// cleans up its vault row folder, but only in vault mode and only when no other
// page still references that source. IPC is stubbed; storage mode lives in
// localStorage (jsdom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStore } from "./index";
import { setStorageMode } from "../lib/storageMode";
import type { Block } from "../types";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

function dbBlock(source: string): Block {
  return { id: `db-${source}`, type: "database", text: "", source };
}

beforeEach(() => {
  setStorageMode("blob");
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

describe("purgeTrashedPage", () => {
  it("permanently removes a trashed page and its vault files", async () => {
    const deletePage = vi.fn().mockResolvedValue(true);
    const deleteFolder = vi.fn().mockResolvedValue(true);
    stubApi({ spsDeletePage: deletePage, spsDeleteDbFolder: deleteFolder });
    useStore.setState({
      docs: {
        p1: [dbBlock("projects")],
        child: [{ id: "child-block", type: "p", text: "Child" }],
      },
      meta: {
        p1: { title: "Trashed project", icon: "📄", cover: null },
        child: { title: "Child", icon: "📄", cover: null },
      },
      trash: [
        {
          id: "p1",
          title: "Trashed project",
          icon: "📄",
          ids: ["p1", "child"],
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
    expect(useStore.getState().meta.p1).toBeUndefined();
    expect(useStore.getState().meta.child).toBeUndefined();
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
    expect(deleteFolder).toHaveBeenCalledWith("projects");
  });
});
