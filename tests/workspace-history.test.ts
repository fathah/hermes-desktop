import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspacePage,
  exportWorkspaceMarkdownBundle,
  listWorkspaceHistory,
  writeWorkspaceFile,
} from "../src/main/workspace";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-workspace-history-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspace history and export", () => {
  it("stores a summary for snapshots before user saves", async () => {
    const page = await createWorkspacePage({ title: "History" }, { root });
    await writeWorkspaceFile(page.path, "# History\n\nOriginal", { root });
    await writeWorkspaceFile(page.path, "# History\n\nChanged", { root });

    const history = await listWorkspaceHistory(page.path, { root });

    expect(history[0].summary).toEqual([{ kind: "changed", text: "Original" }]);
  });

  it("exports visible markdown and yaml workspace files", async () => {
    const page = await createWorkspacePage({ title: "Export Me" }, { root });
    await writeWorkspaceFile(
      "tasks.yaml",
      "hermesType: database\ntitle: Tasks",
      {
        root,
      },
    );

    expect(await exportWorkspaceMarkdownBundle({ root })).toEqual(
      expect.arrayContaining([
        { path: page.path, content: "# Export Me\n" },
        { path: "tasks.yaml", content: "hermesType: database\ntitle: Tasks" },
      ]),
    );
  });
});
