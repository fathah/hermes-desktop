import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";

const execFileSyncMock = vi.hoisted(() => vi.fn());

// `vi.hoisted` runs before module imports, so we can't reference imported
// `join` / `tmpdir` here — use the bare Node modules via require, which is
// the documented escape hatch for hoisted setup.
const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-profiles-test-${Date.now()}`),
  };
});

// Mock installer module so HERMES_HOME points at our temp dir before
// profiles.ts evaluates the `PROFILES_DIR` constant from it.
vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  hermesCliArgs: (args: string[] = []) => ["/dev/null", ...args],
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("child_process", () => ({
  default: { execFileSync: execFileSyncMock },
  execFileSync: execFileSyncMock,
}));

// Import AFTER the mock so PROFILES_DIR is resolved against TEST_HOME.
import {
  createProfile,
  deleteProfile,
  listProfiles,
  setActiveProfile,
} from "../src/main/profiles";

const PROFILES_DIR = join(TEST_HOME, "profiles");

beforeEach(() => {
  execFileSyncMock.mockReset();
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(PROFILES_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("listProfiles", () => {
  it("includes a profile directory that has neither config.yaml nor .env (issue #19)", async () => {
    const empty = join(PROFILES_DIR, "fresh");
    mkdirSync(empty, { recursive: true });

    const profiles = await listProfiles();
    const fresh = profiles.find((p) => p.name === "fresh");
    expect(fresh).toBeDefined();
    expect(fresh?.isDefault).toBe(false);
    expect(fresh?.hasEnv).toBe(false);
  });

  it("includes a profile that has only .env", async () => {
    const dir = join(PROFILES_DIR, "env-only");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".env"), "OPENAI_API_KEY=x\n");

    const profiles = await listProfiles();
    const found = profiles.find((p) => p.name === "env-only");
    expect(found).toBeDefined();
    expect(found?.hasEnv).toBe(true);
  });

  it("includes a profile that has only config.yaml and parses model/provider", async () => {
    const dir = join(PROFILES_DIR, "config-only");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.yaml"),
      "models:\n  default: gpt-4o\n  provider: openai\n",
    );

    const profiles = await listProfiles();
    const found = profiles.find((p) => p.name === "config-only");
    expect(found).toBeDefined();
    expect(found?.model).toBe("gpt-4o");
    expect(found?.provider).toBe("openai");
  });

  it("ignores dotfiles like .DS_Store under the profiles directory", async () => {
    writeFileSync(join(PROFILES_DIR, ".DS_Store"), "");
    mkdirSync(join(PROFILES_DIR, ".hidden"), { recursive: true });

    const profiles = await listProfiles();
    const dotProfiles = profiles.filter(
      (p) => p.name.startsWith(".") || p.name === ".DS_Store",
    );
    expect(dotProfiles).toHaveLength(0);
  });

  it("ignores files (non-directories) under the profiles directory", async () => {
    writeFileSync(join(PROFILES_DIR, "stray.txt"), "stray");

    const profiles = await listProfiles();
    expect(profiles.find((p) => p.name === "stray.txt")).toBeUndefined();
  });

  it("ignores invalid profile directory names", async () => {
    mkdirSync(join(PROFILES_DIR, "valid_profile-1"), { recursive: true });
    mkdirSync(join(PROFILES_DIR, "-flag"), { recursive: true });
    mkdirSync(join(PROFILES_DIR, "has space"), { recursive: true });
    mkdirSync(join(PROFILES_DIR, "UpperCase"), { recursive: true });

    const profiles = await listProfiles();
    expect(profiles.find((p) => p.name === "valid_profile-1")).toBeDefined();
    expect(profiles.find((p) => p.name === "-flag")).toBeUndefined();
    expect(profiles.find((p) => p.name === "has space")).toBeUndefined();
    expect(profiles.find((p) => p.name === "UpperCase")).toBeUndefined();
  });

  it("returns the default profile even when ~/.hermes/profiles/ is empty", async () => {
    const profiles = await listProfiles();
    expect(profiles.find((p) => p.isDefault)).toBeDefined();
  });

  it("marks the active profile correctly", async () => {
    const dir = join(PROFILES_DIR, "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(TEST_HOME, "active_profile"), "work\n");

    const profiles = await listProfiles();
    const work = profiles.find((p) => p.name === "work");
    const def = profiles.find((p) => p.isDefault);
    expect(work?.isActive).toBe(true);
    expect(def?.isActive).toBe(false);
  });

  it("rejects invalid profile names before invoking the Hermes CLI", () => {
    expect(createProfile("../outside", true).success).toBe(false);
    expect(createProfile("-flag", true).success).toBe(false);
    expect(deleteProfile("../outside").success).toBe(false);
    expect(() => setActiveProfile("../outside")).toThrow(
      "Profile names may contain lowercase letters",
    );
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("surfaces Hermes Agent profile-create errors written to stdout", () => {
    const err = new Error("Command failed");
    Object.assign(err, {
      stdout: Buffer.from(
        "Error: Profile name 'test' is reserved — it collides with either the Hermes installation itself or a common system binary. Pick a different name.\n",
      ),
      stderr: Buffer.from(""),
    });
    execFileSyncMock.mockImplementation(() => {
      throw err;
    });

    const result = createProfile("test", true);

    expect(result.success).toBe(false);
    expect(result.error).toContain("reserved");
    expect(result.error).toContain("common system binary");
  });

  it("uses Hermes Agent stdout for duplicate profile-create errors", () => {
    const err = new Error("Command failed");
    Object.assign(err, {
      stdout: Buffer.from(
        "Error: Profile 'test2' already exists at C:\\Users\\pmos6\\AppData\\Local\\hermes\\profiles\\test2\n",
      ),
      stderr: Buffer.from(""),
    });
    execFileSyncMock.mockImplementation(() => {
      throw err;
    });

    const result = createProfile("test2", false);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Error: Profile 'test2' already exists at C:\\Users\\pmos6\\AppData\\Local\\hermes\\profiles\\test2",
    );
  });

  it("allows slower cloned profile creation before timing out", () => {
    execFileSyncMock.mockReturnValue(Buffer.from(""));

    expect(createProfile("slow-clone", true).success).toBe(true);

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "create", "slow-clone", "--clone"],
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it("bounds profile deletion with the same timeout as profile creation", () => {
    execFileSyncMock.mockReturnValue(Buffer.from(""));

    expect(deleteProfile("slow-delete").success).toBe(true);

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "delete", "slow-delete", "--yes"],
      expect.objectContaining({ timeout: 30000 }),
    );
  });
});
