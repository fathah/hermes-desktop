import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspaceSyncedBlock,
  listWorkspaceSyncedBlocks,
  removeWorkspaceSyncedBlockReference,
  updateWorkspaceSyncedBlockContent,
} from "../src/main/workspace-synced-blocks";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-workspace-synced-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspace synced blocks", () => {
  it("creates a synced source and updates references", async () => {
    const block = await createWorkspaceSyncedBlock(
      {
        sourcePath: "runbook.md",
        sourceBlockId: "block-a",
        content: "Shared context",
        references: [{ path: "prd.md", blockId: "block-b" }],
      },
      { root },
    );

    expect(block.id).toMatch(/^synced-/);
    const updated = await updateWorkspaceSyncedBlockContent(
      block.id,
      "New shared context",
      { root },
    );

    expect(updated.content).toBe("New shared context");
    expect((await listWorkspaceSyncedBlocks({ root }))[0].references).toEqual([
      { path: "prd.md", blockId: "block-b" },
    ]);
  });

  it("removes a single synced block reference without deleting the source", async () => {
    const block = await createWorkspaceSyncedBlock(
      {
        sourcePath: "runbook.md",
        sourceBlockId: "block-a",
        content: "Shared context",
        references: [
          { path: "prd.md", blockId: "block-b" },
          { path: "notes.md", blockId: "block-c" },
        ],
      },
      { root },
    );

    const updated = await removeWorkspaceSyncedBlockReference(
      block.id,
      "prd.md",
      "block-b",
      { root },
    );

    expect(updated.references).toEqual([
      { path: "notes.md", blockId: "block-c" },
    ]);
  });
});
