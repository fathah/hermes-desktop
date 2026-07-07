import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMarkdownImportPlan,
  createMarkdownImportPlan,
} from "./sps-import";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sps-import-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createMarkdownImportPlan", () => {
  it("dry-runs a Markdown folder import without writing to the vault", async () => {
    const root = tempRoot();
    const sourceDir = join(root, "obsidian");
    const vaultDir = join(root, "vault");
    mkdirSync(join(sourceDir, ".obsidian"), { recursive: true });
    mkdirSync(vaultDir, { recursive: true });
    writeFileSync(join(sourceDir, "Project Atlas.md"), "# Project Atlas\n");
    writeFileSync(join(sourceDir, ".obsidian", "workspace.json"), "{}");

    const plan = await createMarkdownImportPlan({
      source: { kind: "markdown-folder", path: sourceDir },
      vaultDir,
    });

    expect(plan.summary).toMatchObject({
      filesScanned: 1,
      pagesToCreate: 1,
      conflicts: 0,
      skipped: 0,
    });
    expect(plan.items[0]).toMatchObject({
      sourcePath: join(sourceDir, "Project Atlas.md"),
      targetPageId: "Project-Atlas",
      status: "create",
    });
    expect(() =>
      readFileSync(join(vaultDir, "Project-Atlas.md"), "utf-8"),
    ).toThrow();
  });

  it("reports conflicts and skipped unsafe Markdown names", async () => {
    const root = tempRoot();
    const sourceDir = join(root, "obsidian");
    const vaultDir = join(root, "vault");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(vaultDir, { recursive: true });
    writeFileSync(join(sourceDir, "Existing.md"), "# Existing\n");
    writeFileSync(join(sourceDir, "???!!!.md"), "# Unsafe\n");
    writeFileSync(join(vaultDir, "Existing.md"), "# already here\n");

    const plan = await createMarkdownImportPlan({
      source: { kind: "markdown-folder", path: sourceDir },
      vaultDir,
    });

    expect(plan.summary).toMatchObject({
      filesScanned: 2,
      pagesToCreate: 0,
      conflicts: 1,
      skipped: 1,
    });
    expect(plan.items.map((item) => item.status).sort()).toEqual([
      "conflict",
      "skipped",
    ]);
  });
});

describe("applyMarkdownImportPlan", () => {
  it("copies only create items into the SPS vault and preserves Markdown bytes", async () => {
    const root = tempRoot();
    const sourceDir = join(root, "obsidian");
    const vaultDir = join(root, "vault");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(vaultDir, { recursive: true });
    const markdown =
      "---\ntags:\n  - research\n---\n# Project Atlas\n[[Source]]\n";
    writeFileSync(join(sourceDir, "Project Atlas.md"), markdown);

    const plan = await createMarkdownImportPlan({
      source: { kind: "markdown-folder", path: sourceDir },
      vaultDir,
      targetFolder: "imported",
    });
    const result = await applyMarkdownImportPlan(plan, vaultDir);

    expect(result).toMatchObject({
      success: true,
      pagesCreated: 1,
      conflicts: 0,
      skipped: 0,
    });
    expect(
      readFileSync(join(vaultDir, "imported", "Project-Atlas.md"), "utf-8"),
    ).toBe(markdown);
  });

  it("does not overwrite conflicts or honor unsafe target paths", async () => {
    const root = tempRoot();
    const sourceDir = join(root, "obsidian");
    const vaultDir = join(root, "vault");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(vaultDir, { recursive: true });
    writeFileSync(join(sourceDir, "Existing.md"), "# incoming\n");
    writeFileSync(join(vaultDir, "Existing.md"), "# original\n");

    const plan = await createMarkdownImportPlan({
      source: { kind: "markdown-folder", path: sourceDir },
      vaultDir,
    });
    plan.items.push({
      sourcePath: join(sourceDir, "Existing.md"),
      targetPageId: "Escape",
      targetPath: "../Escape.md",
      status: "create",
    });

    const result = await applyMarkdownImportPlan(plan, vaultDir);

    expect(result).toMatchObject({
      success: true,
      pagesCreated: 0,
      conflicts: 1,
      skipped: 1,
    });
    expect(readFileSync(join(vaultDir, "Existing.md"), "utf-8")).toBe(
      "# original\n",
    );
  });
});
