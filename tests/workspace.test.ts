import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureWorkspace,
  getWorkspaceTree,
  readWorkspaceFile,
  searchWorkspace,
  writeWorkspaceFile,
  deleteWorkspaceFile,
} from "../src/main/workspace";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-workspace-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspace filesystem boundary", () => {
  it("initializes a workspace with index.md", async () => {
    const workspaceRoot = await ensureWorkspace({ root });

    expect(workspaceRoot).toBe(join(root, "workspace"));
    expect(existsSync(join(workspaceRoot, "index.md"))).toBe(true);
    expect(readFileSync(join(workspaceRoot, "index.md"), "utf-8")).toContain(
      "# Hermes Workspace",
    );
  });

  it("reads, writes, lists, searches, and deletes relative workspace files", async () => {
    await writeWorkspaceFile("Projects/spec.md", "# Spec\n\nAgent canvas", {
      root,
    });

    expect(await readWorkspaceFile("Projects/spec.md", { root })).toBe(
      "# Spec\n\nAgent canvas",
    );
    expect(await getWorkspaceTree({ root })).toEqual([
      {
        name: "Projects",
        path: "Projects",
        kind: "directory",
        children: [{ name: "spec.md", path: "Projects/spec.md", kind: "file" }],
      },
      { name: "index.md", path: "index.md", kind: "file" },
    ]);
    expect(await searchWorkspace("canvas", 5, { root })).toEqual([
      {
        kind: "workspace",
        path: "Projects/spec.md",
        title: "spec.md",
        snippet: "Spec\n\nAgent canvas",
      },
    ]);

    expect(await deleteWorkspaceFile("Projects/spec.md", { root })).toBe(true);
    expect(existsSync(join(root, "workspace", "Projects", "spec.md"))).toBe(
      false,
    );
  });

  it("rejects absolute paths and traversal", async () => {
    await expect(readWorkspaceFile("../secret.md", { root })).rejects.toThrow(
      "Invalid workspace path",
    );
    await expect(
      writeWorkspaceFile("/tmp/secret.md", "nope", { root }),
    ).rejects.toThrow("Invalid workspace path");
  });

  it("searches yaml database files as workspace content", async () => {
    await ensureWorkspace({ root });
    writeFileSync(
      join(root, "workspace", "tasks.yaml"),
      "hermesType: database\ntitle: Sprint Tasks\nitems:\n  - name: Build Split Pane UI\n",
    );

    expect(await searchWorkspace("split", 5, { root })).toEqual([
      {
        kind: "workspace",
        path: "tasks.yaml",
        title: "Sprint Tasks",
        snippet:
          "hermesType: database\ntitle: Sprint Tasks\nitems:\n  - name: Build Split Pane UI",
      },
    ]);
  });
});
