import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_WORKSPACE_FILE_EDIT_BYTES,
  WorkspaceFileAccess,
} from "./workspace-file-access";

describe("WorkspaceFileAccess", () => {
  let tempDir: string;
  let workspaceRoot: string;
  let access: WorkspaceFileAccess;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hermes-workspace-files-"));
    workspaceRoot = join(tempDir, "workspace");
    await mkdir(workspaceRoot);
    access = new WorkspaceFileAccess();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads only the requested byte limit and never edits a truncated file", async () => {
    const filePath = join(workspaceRoot, "large.txt");
    await writeFile(filePath, "abcdef", "utf-8");

    await expect(access.read(1, filePath, 3, workspaceRoot)).resolves.toEqual({
      content: "abc",
      truncated: true,
    });
  });

  it("returns an owner-bound token and atomically saves a contained file", async () => {
    const filePath = join(workspaceRoot, "code.ts");
    await writeFile(filePath, "const oldValue = 1;\n", "utf-8");
    if (process.platform !== "win32") await chmod(filePath, 0o640);

    const opened = await access.read(7, filePath, undefined, workspaceRoot);
    expect(opened).toMatchObject({
      content: "const oldValue = 1;\n",
      truncated: false,
      editToken: expect.any(String),
    });

    await expect(
      access.save(7, opened?.editToken ?? "", "const newValue = 2;\n"),
    ).resolves.toEqual({ success: true });
    await expect(readFile(filePath, "utf-8")).resolves.toBe(
      "const newValue = 2;\n",
    );
    expect(
      (await readdir(workspaceRoot)).some((name) =>
        name.includes(".hermes-edit-"),
      ),
    ).toBe(false);
    if (process.platform !== "win32") {
      expect((await stat(filePath)).mode & 0o777).toBe(0o640);
    }

    // A successful save advances the token snapshot for subsequent saves.
    await expect(
      access.save(7, opened?.editToken ?? "", "const newestValue = 3;\n"),
    ).resolves.toEqual({ success: true });
  });

  it("rejects tokens presented by another renderer owner", async () => {
    const filePath = join(workspaceRoot, "owner.txt");
    await writeFile(filePath, "original", "utf-8");
    const opened = await access.read(11, filePath, undefined, workspaceRoot);

    await expect(
      access.save(12, opened?.editToken ?? "", "attacker change"),
    ).resolves.toEqual({ success: false, error: "invalid-token" });
    await expect(readFile(filePath, "utf-8")).resolves.toBe("original");
  });

  it("rejects a save when the file changed after it was opened", async () => {
    const filePath = join(workspaceRoot, "stale.txt");
    await writeFile(filePath, "original", "utf-8");
    const opened = await access.read(1, filePath, undefined, workspaceRoot);
    await writeFile(filePath, "external change", "utf-8");

    await expect(
      access.save(1, opened?.editToken ?? "", "editor change"),
    ).resolves.toEqual({ success: false, error: "stale" });
    await expect(readFile(filePath, "utf-8")).resolves.toBe("external change");
  });

  it("rejects files outside the canonical workspace", async () => {
    const outsidePath = join(tempDir, "outside.txt");
    await writeFile(outsidePath, "outside", "utf-8");

    await expect(
      access.read(1, outsidePath, undefined, workspaceRoot),
    ).resolves.toBeNull();
    await expect(
      access.read(1, "../outside.txt", undefined, workspaceRoot),
    ).resolves.toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks that escape the workspace before and after opening",
    async () => {
      const outsidePath = join(tempDir, "outside.txt");
      const escapedPath = join(workspaceRoot, "escaped.txt");
      await writeFile(outsidePath, "outside", "utf-8");
      await symlink(outsidePath, escapedPath);

      await expect(
        access.read(1, escapedPath, undefined, workspaceRoot),
      ).resolves.toBeNull();

      const editablePath = join(workspaceRoot, "editable.txt");
      const parkedPath = join(workspaceRoot, "editable.original.txt");
      await writeFile(editablePath, "inside", "utf-8");
      const opened = await access.read(
        1,
        editablePath,
        undefined,
        workspaceRoot,
      );
      await rename(editablePath, parkedPath);
      await symlink(outsidePath, editablePath);

      await expect(
        access.save(1, opened?.editToken ?? "", "escaped write"),
      ).resolves.toEqual({ success: false, error: "stale" });
      await expect(readFile(outsidePath, "utf-8")).resolves.toBe("outside");
    },
  );

  it("caps edited content and can revoke every token for an owner", async () => {
    const filePath = join(workspaceRoot, "bounded.txt");
    await writeFile(filePath, "small", "utf-8");
    const opened = await access.read(9, filePath, undefined, workspaceRoot);

    await expect(
      access.save(
        9,
        opened?.editToken ?? "",
        "x".repeat(MAX_WORKSPACE_FILE_EDIT_BYTES + 1),
      ),
    ).resolves.toEqual({ success: false, error: "too-large" });

    access.releaseOwner(9);
    await expect(
      access.save(9, opened?.editToken ?? "", "after release"),
    ).resolves.toEqual({ success: false, error: "invalid-token" });
  });

  it("keeps legacy unscoped reads read-only", async () => {
    const filePath = join(workspaceRoot, "legacy.txt");
    await writeFile(filePath, "legacy", "utf-8");

    await expect(access.read(1, filePath)).resolves.toEqual({
      content: "legacy",
      truncated: false,
    });
  });
});
