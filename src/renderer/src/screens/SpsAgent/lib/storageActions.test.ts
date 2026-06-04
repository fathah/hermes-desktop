// storageActions.test.ts — F5: the shared migrate/rollback orchestration. IPC is
// stubbed and storage mode lives in localStorage (jsdom), as in the app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toggleStorageMode, getLastBackup } from "./storageActions";
import { getStorageMode, setStorageMode } from "./storageMode";
import { blk } from "./ids";
import type { Block, PageMeta, TreeNode, Workspace } from "../types";

function meta(title: string): PageMeta {
  return { icon: "📄", title, cover: null };
}

function makeWorkspace(over: Partial<Workspace> = {}): Workspace {
  const tree: TreeNode[] = [{ id: "home", children: [] }];
  const docs: Record<string, Block[]> = {
    home: [blk("h1", "Home"), blk("p", "Welcome")],
  };
  return {
    tree,
    meta: { home: meta("Home") },
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

beforeEach(() => {
  setStorageMode("blob");
  localStorage.removeItem("sps-agent-last-backup-v1");
});
afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  setStorageMode("blob");
  localStorage.removeItem("sps-agent-last-backup-v1");
  vi.restoreAllMocks();
});

describe("toggleStorageMode", () => {
  it("migrates blob → vault, sets the mode, and records the backup path", async () => {
    stubApi({
      spsExportPage: vi.fn().mockResolvedValue(true),
      spsVaultWriteManifest: vi.fn().mockResolvedValue(true),
      spsBackupWorkspace: vi.fn().mockResolvedValue("/x/workspace.json.bak-1"),
    });
    const res = await toggleStorageMode(makeWorkspace());
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("vault");
    expect(getStorageMode()).toBe("vault");
    expect(res.message).toMatch(/Migrated to markdown/);
    expect(getLastBackup()).toBe("/x/workspace.json.bak-1");
  });

  it("refuses the migrate (mode unchanged) when parity fails", async () => {
    const backup = vi.fn();
    stubApi({ spsExportPage: vi.fn(), spsBackupWorkspace: backup });
    // A tree pointing at a ghost page makes the real pages fail to round-trip.
    const res = await toggleStorageMode(
      makeWorkspace({ tree: [{ id: "ghost", children: [] }], page: "ghost" }),
    );
    expect(res.ok).toBe(false);
    expect(res.mode).toBe("blob");
    expect(getStorageMode()).toBe("blob");
    expect(backup).not.toHaveBeenCalled();
  });

  it("rolls back vault → blob, saving the current state to the blob", async () => {
    setStorageMode("vault");
    const save = vi.fn().mockResolvedValue(true);
    stubApi({ spsSave: save });
    const res = await toggleStorageMode(makeWorkspace());
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("blob");
    expect(getStorageMode()).toBe("blob");
    expect(save).toHaveBeenCalledTimes(1);
  });
});
