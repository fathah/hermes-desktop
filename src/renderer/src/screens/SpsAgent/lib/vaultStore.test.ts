// vaultStore.test.ts — S6: the safe blob⇄vault migrate/rollback orchestration.
// The IPC surface is stubbed; we assert the safety rails and the round-trip.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  migrateToVault,
  readVaultWorkspace,
  writeVaultWorkspace,
  rollbackToBlob,
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
    const exportPage = vi.fn().mockResolvedValue(true);
    const writeManifest = vi.fn().mockResolvedValue(true);
    const backup = vi.fn().mockResolvedValue("/x/workspace.json.bak-1");
    stubApi({
      spsExportPage: exportPage,
      spsVaultWriteManifest: writeManifest,
      spsBackupWorkspace: backup,
    });
    const res = await migrateToVault(makeWorkspace());
    expect(res.ok).toBe(true);
    expect(res.backup).toBe("/x/workspace.json.bak-1");
    expect(backup).toHaveBeenCalledTimes(1);
    expect(exportPage).toHaveBeenCalledTimes(2); // home + sub
    expect(writeManifest).toHaveBeenCalledTimes(1);
  });

  it("REFUSES (no backup, no write) when a comment is block-anchored", async () => {
    const exportPage = vi.fn();
    const backup = vi.fn();
    stubApi({ spsExportPage: exportPage, spsBackupWorkspace: backup });
    const comment: Comment = {
      id: "c1",
      quote: "Welcome",
      blockId: "blk-1",
      page: "home",
      resolved: false,
      messages: [],
    };
    const res = await migrateToVault(makeWorkspace({ comments: [comment] }));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/anchored to blocks/);
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
    const exportPage = vi.fn().mockResolvedValue(true);
    const writeManifest = vi.fn().mockResolvedValue(true);
    stubApi({
      spsExportPage: exportPage,
      spsVaultWriteManifest: writeManifest,
    });
    await writeVaultWorkspace(makeWorkspace());
    expect(exportPage).toHaveBeenCalledTimes(2);
    expect(writeManifest).toHaveBeenCalledTimes(1);
  });
});
