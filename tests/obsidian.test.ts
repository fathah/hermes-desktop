import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-obsidian-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/dev/null",
  hermesCliArgs: (args: string[] = []) => ["/dev/null", ...args],
  getEnhancedPath: () => process.env.PATH || "",
}));

import {
  appendObsidianFile,
  getObsidianTree,
  readObsidianFile,
  searchObsidian,
  setObsidianConfig,
  writeObsidianFile,
} from "../src/main/obsidian";

const VAULT = join(TEST_HOME, "vault");

beforeEach(() => {
  mkdirSync(join(VAULT, "Projects"), { recursive: true });
  mkdirSync(join(VAULT, ".obsidian"), { recursive: true });
  writeFileSync(join(VAULT, "index.md"), "# Index\n\nHome base");
  writeFileSync(
    join(VAULT, "Projects", "roadmap.md"),
    "# Roadmap\n\nAgent canvas",
  );
  writeFileSync(join(VAULT, ".obsidian", "app.json"), "{}");
});

afterEach(() => {
  vi.resetModules();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("Obsidian vault filesystem operations", () => {
  it("reads, writes, appends, lists, and searches Markdown vault files", async () => {
    await setObsidianConfig({ vaultPath: VAULT, vaultName: "Test Vault" });

    await writeObsidianFile("Projects/spec.md", "# Spec\n\nDraft");
    await appendObsidianFile("Projects/spec.md", "\nNext step");

    expect(await readObsidianFile("Projects/spec.md")).toBe(
      "# Spec\n\nDraft\nNext step",
    );
    expect(existsSync(join(VAULT, "Projects", "spec.md"))).toBe(true);
    expect(await getObsidianTree()).toEqual([
      { name: "index.md", path: "index.md", kind: "file" },
      {
        name: "Projects",
        path: "Projects",
        kind: "directory",
        children: [
          { name: "roadmap.md", path: "Projects/roadmap.md", kind: "file" },
          { name: "spec.md", path: "Projects/spec.md", kind: "file" },
        ],
      },
    ]);
    expect(await searchObsidian("canvas", 5)).toEqual([
      {
        kind: "obsidian",
        path: "Projects/roadmap.md",
        title: "roadmap.md",
        snippet: "# Roadmap\n\nAgent canvas",
      },
    ]);
  });

  it("rejects traversal, absolute paths, internals, and non-Markdown writes", async () => {
    await setObsidianConfig({ vaultPath: VAULT });

    await expect(readObsidianFile("../secret.md")).rejects.toThrow(
      "Invalid Obsidian path",
    );
    await expect(writeObsidianFile("/tmp/secret.md", "nope")).rejects.toThrow(
      "Invalid Obsidian path",
    );
    await expect(readObsidianFile(".obsidian/app.json")).rejects.toThrow(
      "Invalid Obsidian path",
    );
    await expect(writeObsidianFile("attachment.png", "nope")).rejects.toThrow(
      "Obsidian writes are limited to Markdown files",
    );
  });

  it("requires a configured vault before file operations", async () => {
    await expect(getObsidianTree()).rejects.toThrow(
      "Obsidian vault is not configured",
    );
  });

  it("keeps separate profile vault configuration", async () => {
    const workVault = join(TEST_HOME, "work-vault");
    mkdirSync(workVault, { recursive: true });
    writeFileSync(join(workVault, "work.md"), "# Work");

    await setObsidianConfig({ vaultPath: VAULT });
    await setObsidianConfig({ vaultPath: workVault }, "work_1");

    expect(await readObsidianFile("index.md")).toBe("# Index\n\nHome base");
    expect(await readObsidianFile("work.md", "work_1")).toBe("# Work");
  });

  it("normalizes existing file content before appending text", async () => {
    await setObsidianConfig({ vaultPath: VAULT });

    await appendObsidianFile("index.md", "Next");

    expect(readFileSync(join(VAULT, "index.md"), "utf-8")).toBe(
      "# Index\n\nHome base\nNext",
    );
  });
});
