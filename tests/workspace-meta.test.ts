import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptAgentWorkspaceProposal,
  createAgentWorkspaceProposal,
  createWorkspacePage,
  duplicateWorkspacePage,
  favoriteWorkspacePage,
  getWorkspaceMetadata,
  getWorkspaceTree,
  listAgentWorkspaceProposals,
  listWorkspaceHistory,
  moveWorkspacePage,
  recordWorkspaceVisit,
  renameWorkspacePage,
  rejectAgentWorkspaceProposal,
  restoreWorkspacePage,
  restoreWorkspaceVersion,
  trashWorkspacePage,
  writeWorkspaceFile,
} from "../src/main/workspace";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-workspace-meta-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspace metadata and page operations", () => {
  it("creates, renames, favorites, moves, trashes, restores, and duplicates pages", async () => {
    const created = await createWorkspacePage(
      { title: "Product Roadmap" },
      { root },
    );

    expect(created.path).toBe("product-roadmap.md");
    expect(created.displayName).toBe("Product Roadmap");
    expect(readFileSync(join(root, "workspace", created.path), "utf-8")).toBe(
      "# Product Roadmap\n",
    );

    const renamed = await renameWorkspacePage(created.path, "Launch Roadmap", {
      root,
    });
    expect(renamed.path).toBe("launch-roadmap.md");
    expect(existsSync(join(root, "workspace", created.path))).toBe(false);
    expect(existsSync(join(root, "workspace", renamed.path))).toBe(true);

    const favorite = await favoriteWorkspacePage(renamed.path, true, { root });
    expect(favorite.favorite).toBe(true);

    const moved = await moveWorkspacePage(renamed.path, "Plans", { root });
    expect(moved.path).toBe("Plans/launch-roadmap.md");
    expect(existsSync(join(root, "workspace", moved.path))).toBe(true);

    expect(await trashWorkspacePage(moved.path, { root })).toBe(true);
    expect(
      (await getWorkspaceMetadata({ root })).pages[moved.path].trashed,
    ).toBe(true);
    expect(JSON.stringify(await getWorkspaceTree({ root }))).not.toContain(
      "launch-roadmap.md",
    );

    expect(await restoreWorkspacePage(moved.path, { root })).toBe(true);
    const duplicate = await duplicateWorkspacePage(moved.path, { root });
    expect(duplicate.path).toBe("Plans/launch-roadmap-copy.md");
    expect(readFileSync(join(root, "workspace", duplicate.path), "utf-8")).toBe(
      "# Launch Roadmap\n",
    );
  });

  it("records recent visits in metadata", async () => {
    const page = await createWorkspacePage({ title: "Daily Notes" }, { root });

    await recordWorkspaceVisit(page.path, { root });

    const metadata = await getWorkspaceMetadata({ root });
    expect(metadata.recentVisits[0].path).toBe(page.path);
    expect(metadata.pages[page.path].lastVisitedAt).toBeGreaterThan(0);
  });
});

describe("workspace history and agent proposals", () => {
  it("snapshots content before saves and restores a selected version", async () => {
    const page = await createWorkspacePage({ title: "Spec" }, { root });
    await writeWorkspaceFile(page.path, "# Spec\n\nOriginal", { root });
    await writeWorkspaceFile(page.path, "# Spec\n\nChanged", { root });

    const history = await listWorkspaceHistory(page.path, { root });
    expect(history.length).toBeGreaterThanOrEqual(1);
    const originalVersion = history.find(
      (entry) => entry.content === "# Spec\n\nOriginal",
    );
    expect(originalVersion?.reason).toBe("user-save");

    const restored = await restoreWorkspaceVersion(
      page.path,
      originalVersion!.id,
      {
        root,
      },
    );
    expect(restored).toBe("# Spec\n\nOriginal");
    expect(readFileSync(join(root, "workspace", page.path), "utf-8")).toBe(
      "# Spec\n\nOriginal",
    );
  });

  it("accepts and rejects agent proposals without silently overwriting content", async () => {
    const page = await createWorkspacePage({ title: "Agent Page" }, { root });
    await writeWorkspaceFile(page.path, "# Agent Page\n\nBase", { root });

    const rejected = await createAgentWorkspaceProposal(
      page.path,
      "# Agent Page\n\nRejected",
      "# Agent Page\n\nBase",
      { root },
    );
    expect(rejected.hunks).toEqual([
      {
        id: expect.stringMatching(/^hunk-/),
        before: "Base",
        after: "Rejected",
        status: "pending",
      },
    ]);
    expect(await listAgentWorkspaceProposals({ root })).toHaveLength(1);
    await expect(
      acceptAgentWorkspaceProposal(rejected.id, { root }),
    ).resolves.toBe(true);
    expect(readFileSync(join(root, "workspace", page.path), "utf-8")).toBe(
      "# Agent Page\n\nRejected",
    );

    const kept = await createAgentWorkspaceProposal(
      page.path,
      "# Agent Page\n\nShould not land",
      "# Agent Page\n\nRejected",
      { root },
    );
    await expect(rejectAgentWorkspaceProposal(kept.id, { root })).resolves.toBe(
      true,
    );
    expect(readFileSync(join(root, "workspace", page.path), "utf-8")).toBe(
      "# Agent Page\n\nRejected",
    );
    expect(await listAgentWorkspaceProposals({ root })).toEqual([]);
  });
});
