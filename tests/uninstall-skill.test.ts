import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockRmSync = vi.fn((_path: string, _options?: unknown) => {});
const mockExistsSync = vi.fn((_p: string) => true);

vi.mock("fs", () => {
  const fns = {
    existsSync: (p: string) => mockExistsSync(p),
    rmSync: (p: string, options?: unknown) => mockRmSync(p, options),
    readdirSync: (p: string) => {
      if (p.endsWith("skills") || p.endsWith("skills-disabled")) {
        return ["custom"];
      }
      if (p.endsWith("custom")) {
        return ["test-skill"];
      }
      return [];
    },
    readFileSync: (p: string) => {
      if (p.endsWith("SKILL.md")) {
        return "---\nname: Test Skill\ndescription: A test skill\n---\nBody";
      }
      return "";
    },
    realpathSync: (p: string) => p,
    statSync: () => ({ isDirectory: () => true }),
    mkdirSync: () => {},
    writeFileSync: () => {},
    renameSync: () => {},
    cpSync: () => {},
  };
  return { ...fns, default: fns };
});

const mockExecFileSync = vi.fn(
  (_file: string, _args?: string[], _options?: unknown) =>
    Buffer.from("Resolving...\nUninstalled.\n"),
);

vi.mock("child_process", () => {
  const fns = {
    execFileSync: (file: string, args?: string[], options?: unknown) =>
      mockExecFileSync(file, args, options),
  };
  return { ...fns, default: fns };
});

const mockRemoveSkillCapability = vi.fn(
  (_path: string, _profile?: string) => {},
);

vi.mock("../src/main/capability-risk-store", () => ({
  removeSkillCapability: (path: string, profile?: string) =>
    mockRemoveSkillCapability(path, profile),
  recordSkillCapability: () => {},
}));

class MockDatabase {
  public prepareCalls: { sql: string; params: unknown[] }[] = [];
  prepare(sql: string): { run: (...params: unknown[]) => { changes: number } } {
    return {
      run: (...params: unknown[]) => {
        this.prepareCalls.push({ sql, params });
        return { changes: 1 };
      },
    };
  }
}

const mockDb = new MockDatabase();

vi.mock("../src/main/db", () => ({
  getSharedDb: () => mockDb,
}));

vi.mock("../src/main/utils", () => ({
  profileHome: (profile?: string) =>
    `/mock/home/profiles/${profile || "default"}`,
  isValidNamedProfileName: () => true,
  getActiveProfileNameSync: () => "default",
  activeStateDbPath: () => "/mock/home/profiles/default/state.db",
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/mock/home",
  HERMES_PYTHON: "python",
  HERMES_REPO: "/mock/repo",
  hermesCliArgs: (args: string[]) => args,
  getEnhancedPath: () => "",
}));

import { uninstallSkill } from "../src/main/skills";

describe("uninstallSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepareCalls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes the local directory, cleans the DB, removes capabilities, and runs CLI uninstall", () => {
    const result = uninstallSkill("Test Skill", "default");
    expect(result.success).toBe(true);

    // 1. Verify local folder deletion was called
    expect(mockRmSync).toHaveBeenCalledWith(
      "/mock/home/profiles/default/skills/custom/test-skill",
      expect.objectContaining({ recursive: true, force: true }),
    );

    // 2. Verify capability removal was called
    expect(mockRemoveSkillCapability).toHaveBeenCalledWith(
      "/mock/home/profiles/default/skills/custom/test-skill",
      "default",
    );

    // 3. Verify SQLite DB deletion query was called
    expect(mockDb.prepareCalls.length).toBe(1);
    expect(mockDb.prepareCalls[0].sql).toContain("DELETE FROM skills_registry");
    expect(mockDb.prepareCalls[0].params).toEqual(["Test Skill", "Test Skill"]);

    // 4. Verify CLI execution was called
    expect(mockExecFileSync).toHaveBeenCalled();
  });

  it("returns success even if the CLI fails, provided the local folder was deleted", () => {
    // Force CLI execFileSync to throw an error
    mockExecFileSync.mockImplementation(() => {
      throw new Error("CLI failed");
    });

    const result = uninstallSkill("Test Skill", "default");
    expect(result.success).toBe(true); // Should still be true because localDeleted is true

    expect(mockRmSync).toHaveBeenCalled();
  });
});
