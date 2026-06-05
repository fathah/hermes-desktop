import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Isolate the filesystem: a temp HERMES_HOME (profile root) and a temp HOME
// (for the ~/.claude/skills discovery source). Mock the module's deps so the
// pure-fs functions operate entirely inside these temp dirs.
const { TEST_HOME, TEST_REPO, FAKE_HOMEDIR } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  // realpath the base so paths match skills.ts' realpathSync resolution
  // (macOS /var → /private/var); otherwise pathIsInside mismatches.
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "skills-test-")),
  );
  return {
    TEST_HOME: path.join(base, "hermes"),
    TEST_REPO: path.join(base, "repo"),
    FAKE_HOMEDIR: path.join(base, "home"),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_REPO: TEST_REPO,
  HERMES_PYTHON: "/usr/bin/python3",
  hermesCliArgs: (a: string[]) => a,
  getEnhancedPath: () => "",
}));
vi.mock("../src/main/utils", () => ({
  profileHome: () => TEST_HOME,
  isValidNamedProfileName: () => true,
}));
vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

// os.homedir() reads $HOME on POSIX — point it at our temp home so the
// ~/.claude/skills discovery source is isolated (more robust than mocking os).
process.env.HOME = FAKE_HOMEDIR;

import {
  createSkill,
  writeSkillContent,
  setSkillEnabled,
  listInstalledSkills,
  listDisabledSkills,
  discoverLocalSkills,
  importLocalSkill,
} from "../src/main/skills";

const skillsDir = join(TEST_HOME, "skills");
const disabledDir = join(TEST_HOME, "skills-disabled");

beforeEach(() => {
  for (const d of [skillsDir, disabledDir, join(FAKE_HOMEDIR, ".claude")])
    rmSync(d, { recursive: true, force: true });
  mkdirSync(skillsDir, { recursive: true });
});
afterEach(() => vi.clearAllMocks());

describe("createSkill", () => {
  it("writes <skills>/<category>/<slug>/SKILL.md with frontmatter", () => {
    const r = createSkill({
      name: "My Guard SOP",
      description: "House rules",
      body: "# Body\ncontent",
    });
    expect(r.success).toBe(true);
    const file = join(skillsDir, "custom", "my-guard-sop", "SKILL.md");
    expect(existsSync(file)).toBe(true);
    const list = listInstalledSkills();
    expect(list.map((s) => s.name)).toContain("My Guard SOP");
  });

  it("rejects an empty name and refuses to overwrite", () => {
    expect(createSkill({ name: "  " }).success).toBe(false);
    expect(createSkill({ name: "Dup" }).success).toBe(true);
    const second = createSkill({ name: "Dup" });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already exists/i);
  });
});

describe("writeSkillContent", () => {
  it("overwrites a profile skill's SKILL.md", () => {
    createSkill({ name: "Edit Me" });
    const dir = join(skillsDir, "custom", "edit-me");
    const r = writeSkillContent(dir, "---\nname: Edit Me\n---\n\nnew body");
    expect(r.success).toBe(true);
  });

  it("refuses a bundled-repo path and traversal", () => {
    const repoPath = join(TEST_REPO, "skills", "official", "x");
    expect(writeSkillContent(repoPath, "x").success).toBe(false);
    expect(
      writeSkillContent(join(skillsDir, "..", "..", "etc"), "x").success,
    ).toBe(false);
  });
});

describe("setSkillEnabled", () => {
  it("disables (moves to skills-disabled) then re-enables", () => {
    createSkill({ name: "Toggle" });
    const dir = join(skillsDir, "custom", "toggle");

    expect(setSkillEnabled(dir, false).success).toBe(true);
    expect(listInstalledSkills().map((s) => s.name)).not.toContain("Toggle");
    expect(listDisabledSkills().map((s) => s.name)).toContain("Toggle");
    expect(existsSync(join(disabledDir, "custom", "toggle", "SKILL.md"))).toBe(
      true,
    );

    const disabledPath = join(disabledDir, "custom", "toggle");
    expect(setSkillEnabled(disabledPath, true).success).toBe(true);
    expect(listInstalledSkills().map((s) => s.name)).toContain("Toggle");
    expect(listDisabledSkills()).toHaveLength(0);
  });

  it("rejects a path outside the expected root", () => {
    createSkill({ name: "Safe" });
    // Disabling something not under skills/ must fail.
    expect(setSkillEnabled(join(TEST_REPO, "x"), false).success).toBe(false);
  });
});

describe("discoverLocalSkills + importLocalSkill", () => {
  function plantLocalSkill(name: string): string {
    const dir = join(FAKE_HOMEDIR, ".claude", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: a local skill\n---\n\nbody`,
    );
    return dir;
  }

  it("discovers a SKILL.md under ~/.claude/skills", () => {
    plantLocalSkill("harvest-me");
    const found = discoverLocalSkills();
    expect(found.map((s) => s.name)).toContain("harvest-me");
  });

  it("imports a discovered skill and then hides it from discovery", () => {
    const src = plantLocalSkill("import-me");
    const r = importLocalSkill(src);
    expect(r.success).toBe(true);
    expect(existsSync(join(skillsDir, "local", "import-me", "SKILL.md"))).toBe(
      true,
    );
    // Installed ⇒ no longer offered as a local import.
    expect(discoverLocalSkills().map((s) => s.name)).not.toContain("import-me");
  });

  it("refuses to import an arbitrary directory outside known sources", () => {
    const stray = mkdtempSync(join(tmpdir(), "stray-"));
    writeFileSync(join(stray, "SKILL.md"), "---\nname: stray\n---\n");
    expect(importLocalSkill(stray).success).toBe(false);
    rmSync(stray, { recursive: true, force: true });
  });
});
