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
