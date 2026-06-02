import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspacePage,
  favoriteWorkspacePage,
  recordWorkspaceVisit,
  searchWorkspace,
  writeWorkspaceFile,
} from "../src/main/workspace";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-workspace-search-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspace search ranking", () => {
  it("returns recent pages before typing", async () => {
    const first = await createWorkspacePage({ title: "First Page" }, { root });
    const second = await createWorkspacePage(
      { title: "Second Page" },
      { root },
    );

    await recordWorkspaceVisit(first.path, { root });
    await recordWorkspaceVisit(second.path, { root });

    expect(
      (await searchWorkspace("", 2, { root })).map((hit) => hit.path),
    ).toEqual([second.path, first.path]);
  });

  it("ranks favorite and title matches ahead of body-only matches", async () => {
    const favorite = await createWorkspacePage(
      { title: "Launch Plan" },
      { root },
    );
    const bodyOnly = await createWorkspacePage({ title: "Notes" }, { root });
    await writeWorkspaceFile(bodyOnly.path, "# Notes\n\nLaunch Plan", { root });
    await favoriteWorkspacePage(favorite.path, true, { root });

    expect(
      (await searchWorkspace("launch", 5, { root })).map((hit) => hit.path),
    ).toEqual([favorite.path, bodyOnly.path]);
  });

  it("supports exact phrase search", async () => {
    const match = await createWorkspacePage({ title: "Research" }, { root });
    const miss = await createWorkspacePage(
      { title: "Loose Research" },
      { root },
    );
    await writeWorkspaceFile(match.path, "# Research\n\nexact phrase", {
      root,
    });
    await writeWorkspaceFile(
      miss.path,
      "# Loose Research\n\nexact other phrase",
      {
        root,
      },
    );

    expect(
      (await searchWorkspace('"exact phrase"', 5, { root })).map(
        (hit) => hit.path,
      ),
    ).toEqual([match.path]);
  });
});
