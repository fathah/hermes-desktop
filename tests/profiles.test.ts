import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";

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
import { setProfileName } from "../src/main/profile-meta";

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
    const fresh = profiles.find((p) => p.id === "fresh");
    expect(fresh).toBeDefined();
    expect(fresh?.name).toBe("fresh");
    expect(fresh?.isDefault).toBe(false);
    expect(fresh?.hasEnv).toBe(false);
  });

  it("includes a profile that has only .env", async () => {
    const dir = join(PROFILES_DIR, "env-only");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".env"), "OPENAI_API_KEY=x\n");

    const profiles = await listProfiles();
    const found = profiles.find((p) => p.id === "env-only");
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
    const found = profiles.find((p) => p.id === "config-only");
    expect(found).toBeDefined();
    expect(found?.model).toBe("gpt-4o");
    expect(found?.provider).toBe("openai");
  });

  it("ignores dotfiles like .DS_Store under the profiles directory", async () => {
    writeFileSync(join(PROFILES_DIR, ".DS_Store"), "");
    mkdirSync(join(PROFILES_DIR, ".hidden"), { recursive: true });

    const profiles = await listProfiles();
    const dotProfiles = profiles.filter(
      (p) => p.id.startsWith(".") || p.id === ".DS_Store",
    );
    expect(dotProfiles).toHaveLength(0);
  });

  it("ignores files (non-directories) under the profiles directory", async () => {
    writeFileSync(join(PROFILES_DIR, "stray.txt"), "stray");

    const profiles = await listProfiles();
    expect(profiles.find((p) => p.id === "stray.txt")).toBeUndefined();
  });

  it("ignores invalid profile directory names", async () => {
    mkdirSync(join(PROFILES_DIR, "valid_profile-1"), { recursive: true });
    mkdirSync(join(PROFILES_DIR, "-flag"), { recursive: true });
    mkdirSync(join(PROFILES_DIR, "has space"), { recursive: true });
    mkdirSync(join(PROFILES_DIR, "UpperCase"), { recursive: true });

    const profiles = await listProfiles();
    expect(profiles.find((p) => p.id === "valid_profile-1")).toBeDefined();
    expect(profiles.find((p) => p.id === "-flag")).toBeUndefined();
    expect(profiles.find((p) => p.id === "has space")).toBeUndefined();
    expect(profiles.find((p) => p.id === "UpperCase")).toBeUndefined();
  });

  it("returns the default profile even when ~/.hermes/profiles/ is empty", async () => {
    const profiles = await listProfiles();
    expect(profiles.find((p) => p.isDefault)).toBeDefined();
  });

  it("returns saved agent names while keeping profile ids internal", async () => {
    writeFileSync(
      join(TEST_HOME, "profile-meta.json"),
      JSON.stringify({ name: "Hermes CN" }),
    );
    const namedDir = join(PROFILES_DIR, "work");
    mkdirSync(namedDir, { recursive: true });
    writeFileSync(
      join(namedDir, "profile-meta.json"),
      JSON.stringify({ name: "Work Agent" }),
    );

    const profiles = await listProfiles();
    const def = profiles.find((p) => p.id === "default");
    const work = profiles.find((p) => p.id === "work");

    expect(def?.name).toBe("Hermes CN");
    expect(work?.name).toBe("Work Agent");
    expect(work?.id).toBe("work");
  });

  it("sets and clears an agent name", async () => {
    expect(await setProfileName("default", "  Hello Agent  ")).toEqual({
      success: true,
    });
    let profiles = await listProfiles();
    expect(profiles.find((p) => p.id === "default")?.name).toBe("Hello Agent");

    expect(await setProfileName("default", "   ")).toEqual({
      success: true,
    });
    profiles = await listProfiles();
    expect(profiles.find((p) => p.id === "default")?.name).toBe("default");
  });

  it("marks the active profile correctly", async () => {
    const dir = join(PROFILES_DIR, "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(TEST_HOME, "active_profile"), "work\n");

    const profiles = await listProfiles();
    const work = profiles.find((p) => p.id === "work");
    const def = profiles.find((p) => p.isDefault);
    expect(work?.isActive).toBe(true);
    expect(def?.isActive).toBe(false);
  });

  it("rejects invalid profile names before invoking the Hermes CLI", () => {
    expect(deleteProfile("../outside").success).toBe(false);
    expect(() => setActiveProfile("../outside")).toThrow(
      "Profile names may contain lowercase letters",
    );
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("creates a safe profile id behind a user-facing agent name", async () => {
    execFileSyncMock.mockReturnValue(Buffer.from(""));

    const result = createProfile("  卢姐  ", null);

    expect(result).toEqual({ success: true, id: "agent" });
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "create", "agent"],
      expect.objectContaining({ timeout: 30000 }),
    );
    const profiles = await listProfiles();
    const created = profiles.find((p) => p.id === "agent");
    expect(created?.name).toBe("卢姐");
  });

  it("keeps a successful CLI-created profile when metadata cannot be written", async () => {
    execFileSyncMock.mockImplementation(() => {
      mkdirSync(join(PROFILES_DIR, "agent", "profile-meta.json"), {
        recursive: true,
      });
      return Buffer.from("");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = createProfile("  卢姐  ", null);

    expect(result).toEqual({ success: true, id: "agent" });
    expect(existsSync(join(PROFILES_DIR, "agent"))).toBe(true);
    expect(existsSync(join(PROFILES_DIR, "agent-2"))).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Created profile "agent" but failed to write profile metadata',
      ),
      expect.anything(),
    );

    warn.mockRestore();
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

    const result = createProfile("test", null);

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

    const result = createProfile("test2", null);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Error: Profile 'test2' already exists at C:\\Users\\pmos6\\AppData\\Local\\hermes\\profiles\\test2",
    );
  });

  it("allows slower cloned profile creation before timing out", () => {
    execFileSyncMock.mockReturnValue(Buffer.from(""));

    expect(createProfile("slow-clone", "default").success).toBe(true);

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      [
        "/dev/null",
        "profile",
        "create",
        "slow-clone",
        "--clone-from",
        "default",
      ],
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

describe("setActiveProfile persistence", () => {
  const activeFile = join(TEST_HOME, "active_profile");

  it("persists a remote-only profile even when the local CLI rejects it", () => {
    // In SSH mode the selected profile lives on the REMOTE. The local
    // `hermes profile use` validates against local profiles and raises
    // FileNotFoundError for it; before the direct-write fallback that error
    // was swallowed and ~/.hermes/active_profile never changed — so the
    // selection reset to `default` on relaunch and activeSshProfile() scoped
    // the unified SSH dashboard to the wrong profile.
    execFileSyncMock.mockImplementation(() => {
      throw new Error("Profile 'vps-agent' does not exist.");
    });

    setActiveProfile("vps-agent");

    expect(readFileSync(activeFile, "utf-8").trim()).toBe("vps-agent");
  });

  it("persists even when there is no local hermes install at all", () => {
    execFileSyncMock.mockImplementation(() => {
      const err = new Error("spawn ENOENT") as Error & { code?: string };
      err.code = "ENOENT";
      throw err;
    });

    setActiveProfile("work");

    expect(readFileSync(activeFile, "utf-8").trim()).toBe("work");
  });

  it("leaves the file alone when the CLI already persisted the selection", () => {
    // Local mode: the CLI writes active_profile itself. The fallback must
    // detect that via read-back and not double-write.
    execFileSyncMock.mockImplementation(() => {
      writeFileSync(activeFile, "work\n");
      return Buffer.from("");
    });

    setActiveProfile("work");

    expect(readFileSync(activeFile, "utf-8")).toBe("work\n");
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("persists switching back to default when the CLI fails", () => {
    writeFileSync(activeFile, "work\n");
    execFileSyncMock.mockImplementation(() => {
      throw new Error("no local install");
    });

    setActiveProfile("default");

    // Readers treat the literal "default" and a missing file identically.
    expect(readFileSync(activeFile, "utf-8").trim()).toBe("default");
  });

  it("still rejects invalid names before touching CLI or file", () => {
    expect(() => setActiveProfile("../outside")).toThrow(
      "Profile names may contain lowercase letters",
    );
    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(existsSync(activeFile)).toBe(false);
  });
});
