// vaultStore.test.ts — S6: the safe blob⇄vault migrate/rollback orchestration.
// The IPC surface is stubbed; we assert the safety rails and the round-trip.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  migrateToVault,
  readVaultWorkspace,
  writeVaultWorkspace,
  saveVaultPage,
  rollbackToBlob,
  deleteVaultPages,
  deleteVaultDbFolders,
} from "./vaultStore";
import { workspaceToVault } from "../editor/workspaceVault";
import { blk } from "../lib/ids";
import type { Block, Comment, PageMeta, TreeNode, Workspace } from "../types";

function meta(title: string, icon = "📄"): PageMeta {
  return { icon, title, cover: null };
}

function makeWorkspace(over: Partial<Workspace> = {}): Workspace {
  const tree: TreeNode[] = [
    { id: "home", children: [{ id: "sub", children: [] }] },
  ];
  const docs: Record<string, Block[]> = {
    home: [blk("h1", "Home"), blk("p", "Welcome")],
    sub: [blk("p", "Sub")],
  };
  return {
    tree,
    meta: { home: meta("Home", "🏠"), sub: meta("Sub") },
    docs,
    comments: [],
    trash: [],
    page: "home",
    ...over,
  };
}

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("migrateToVault — safety gate", () => {
  it("backs up the blob and writes every page + the manifest", async () => {
    const writeSnapshot = vi.fn().mockResolvedValue(true);
    const backup = vi.fn().mockResolvedValue("/x/workspace.json.bak-1");
    stubApi({
      spsVaultWriteSnapshot: writeSnapshot,
      spsBackupWorkspace: backup,
    });
    const res = await migrateToVault(makeWorkspace());
    expect(res.ok).toBe(true);
    expect(res.backup).toBe("/x/workspace.json.bak-1");
    expect(backup).toHaveBeenCalledTimes(1);
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    expect(Object.keys(writeSnapshot.mock.calls[0][0].pages).sort()).toEqual([
      "home",
      "sub",
    ]);
  });

  it("migrates a block-anchored comment, persisting the anchored block id (F2)", async () => {
    const anchored = blk("p", "Welcome");
    const comment: Comment = {
      id: "c1",
      quote: "Welcome",
      blockId: anchored.id,
      page: "home",
      resolved: false,
      messages: [],
    };
    const writeSnapshot = vi.fn().mockResolvedValue(true);
    const backup = vi.fn().mockResolvedValue("/x/workspace.json.bak-1");
    stubApi({
      spsVaultWriteSnapshot: writeSnapshot,
      spsBackupWorkspace: backup,
    });
    const ws = makeWorkspace({
      docs: { home: [blk("h1", "Home"), anchored], sub: [blk("p", "Sub")] },
      comments: [comment],
    });
    const res = await migrateToVault(ws);
    expect(res.ok).toBe(true);
    expect(backup).toHaveBeenCalledTimes(1);
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    // The anchored page carries the block-id marker so the comment re-anchors.
    const homeMd = writeSnapshot.mock.calls[0][0].pages.home as string;
    expect(homeMd).toContain(`^${anchored.id}`);
  });

  it("still REFUSES when content would not round-trip", async () => {
    // A live anchor whose block id cannot be reconstructed fails parity.
    const exportPage = vi.fn();
    const backup = vi.fn();
    stubApi({ spsExportPage: exportPage, spsBackupWorkspace: backup });
    const res = await migrateToVault({
      ...makeWorkspace(),
      // tree without "home" makes vaultToWorkspace drop the page → parity fails.
      tree: [{ id: "ghost", children: [] }],
      page: "ghost",
    });
    expect(res.ok).toBe(false);
    expect(backup).not.toHaveBeenCalled();
    expect(exportPage).not.toHaveBeenCalled();
  });
});

describe("read / write / rollback round-trip", () => {
  it("readVaultWorkspace reconstructs the workspace from disk", async () => {
    const ws = makeWorkspace();
    const snap = workspaceToVault(ws);
    stubApi({
      spsVaultRead: vi.fn().mockResolvedValue({
        pages: snap.pages,
        manifest: JSON.stringify(snap.manifest),
      }),
    });
    const back = await readVaultWorkspace();
    expect(back).not.toBeNull();
    expect(back!.tree).toEqual(ws.tree);
    expect(back!.page).toBe("home");
    expect(back!.meta.home).toEqual(meta("Home", "🏠"));
    expect(back!.docs.home.map((b) => b.type)).toEqual(["h1", "p"]);
  });

  it("readVaultWorkspace returns null when the vault is empty", async () => {
    stubApi({
      spsVaultRead: vi.fn().mockResolvedValue({ pages: {}, manifest: null }),
    });
    expect(await readVaultWorkspace()).toBeNull();
  });

  it("rollbackToBlob reconstructs from the vault and saves the blob", async () => {
    const ws = makeWorkspace();
    const snap = workspaceToVault(ws);
    const save = vi.fn().mockResolvedValue(true);
    stubApi({
      spsVaultRead: vi.fn().mockResolvedValue({
        pages: snap.pages,
        manifest: JSON.stringify(snap.manifest),
      }),
      spsSave: save,
    });
    const back = await rollbackToBlob();
    expect(save).toHaveBeenCalledTimes(1);
    expect(back!.tree).toEqual(ws.tree);
  });

  it("writeVaultWorkspace writes one page per doc plus the manifest", async () => {
    const writeSnapshot = vi.fn().mockResolvedValue(true);
    stubApi({ spsVaultWriteSnapshot: writeSnapshot });
    await writeVaultWorkspace(makeWorkspace());
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    expect(Object.keys(writeSnapshot.mock.calls[0][0].pages).sort()).toEqual([
      "home",
      "sub",
    ]);
  });

  it("saveVaultPage writes one page plus the manifest in one snapshot IPC call", async () => {
    const writeSnapshot = vi.fn().mockResolvedValue(true);
    stubApi({ spsVaultWriteSnapshot: writeSnapshot });

    await saveVaultPage(makeWorkspace(), "home");

    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    expect(Object.keys(writeSnapshot.mock.calls[0][0].pages)).toEqual(["home"]);
    expect(writeSnapshot.mock.calls[0][0].manifest).toContain('"page"');
  });
});

describe("deleteVaultPages — orphan cleanup (F3)", () => {
  it("calls spsDeletePage once per id", async () => {
    const del = vi.fn().mockResolvedValue(true);
    stubApi({ spsDeletePage: del });
    await deleteVaultPages(["a", "b", "c"]);
    expect(del.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when the delete API is unavailable", async () => {
    stubApi({});
    await expect(deleteVaultPages(["a"])).resolves.toBeUndefined();
  });

  it("never rejects when a delete fails (best-effort)", async () => {
    const del = vi.fn().mockRejectedValue(new Error("locked"));
    stubApi({ spsDeletePage: del });
    await expect(deleteVaultPages(["a"])).resolves.toBeUndefined();
  });
});

describe("deleteVaultDbFolders — query-DB row-folder cleanup (F3)", () => {
  it("calls spsDeleteDbFolder once per source", async () => {
    const del = vi.fn().mockResolvedValue(true);
    stubApi({ spsDeleteDbFolder: del });
    await deleteVaultDbFolders(["projects", "tasks"]);
    expect(del.mock.calls.map((c) => c[0])).toEqual(["projects", "tasks"]);
  });

  it("is a no-op when the delete API is unavailable", async () => {
    stubApi({});
    await expect(deleteVaultDbFolders(["projects"])).resolves.toBeUndefined();
  });

  it("never rejects when a delete fails (best-effort)", async () => {
    const del = vi.fn().mockRejectedValue(new Error("locked"));
    stubApi({ spsDeleteDbFolder: del });
    await expect(deleteVaultDbFolders(["projects"])).resolves.toBeUndefined();
  });
});
