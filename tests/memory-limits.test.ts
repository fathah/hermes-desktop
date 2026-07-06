import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(
      os.tmpdir(),
      `hermes-memory-limits-test-${Date.now()}`,
    ),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

vi.mock("better-sqlite3", () => ({
  default: vi.fn(),
}));

import {
  DEFAULT_MEMORY_CHAR_LIMIT,
  DEFAULT_USER_CHAR_LIMIT,
  parseMemoryLimitsConfig,
} from "../src/main/memory-limits";
import {
  addMemoryEntry,
  readMemory,
  updateMemoryEntry,
  writeUserProfile,
} from "../src/main/memory";

function profileDir(profile?: string): string {
  return profile ? join(TEST_HOME, "profiles", profile) : TEST_HOME;
}

function writeConfig(content: string, profile?: string): void {
  const dir = profileDir(profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.yaml"), content, "utf-8");
}

function writeMemoryFile(content: string, profile?: string): void {
  const dir = join(profileDir(profile), "memories");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "MEMORY.md"), content, "utf-8");
}

beforeEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("parseMemoryLimitsConfig", () => {
  it("reads both memory limits from the memory block", () => {
    expect(
      parseMemoryLimitsConfig(
        [
          "memory:",
          "  memory_char_limit: 3200",
          "  user_char_limit: '2000'",
          "",
        ].join("\n"),
      ),
    ).toEqual({ memoryCharLimit: 3200, userCharLimit: 2000 });
  });

  it("falls back when configured limits are missing or invalid", () => {
    expect(
      parseMemoryLimitsConfig(
        [
          "memory:",
          "  memory_char_limit: not-a-number",
          "  user_char_limit: 0",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      memoryCharLimit: DEFAULT_MEMORY_CHAR_LIMIT,
      userCharLimit: DEFAULT_USER_CHAR_LIMIT,
    });
  });
});

describe("memory limits from active profile config.yaml", () => {
  it("returns configured local memory limits in readMemory", () => {
    writeConfig(
      [
        "memory:",
        "  memory_char_limit: 3200",
        "  user_char_limit: 2000",
        "",
      ].join("\n"),
    );
    writeMemoryFile("remember this");

    const info = readMemory();

    expect(info.memory.charLimit).toBe(3200);
    expect(info.user.charLimit).toBe(2000);
  });

  it("uses a named profile's config.yaml instead of default constants", () => {
    writeConfig(
      [
        "memory:",
        "  memory_char_limit: 4096",
        "  user_char_limit: 2048",
        "",
      ].join("\n"),
      "work",
    );
    writeMemoryFile("profile-scoped memory", "work");

    const info = readMemory("work");

    expect(info.memory.charLimit).toBe(4096);
    expect(info.user.charLimit).toBe(2048);
  });

  it("allows memory and user writes up to the configured limits", () => {
    writeConfig(
      [
        "memory:",
        "  memory_char_limit: 3200",
        "  user_char_limit: 2000",
        "",
      ].join("\n"),
    );

    expect(addMemoryEntry("x".repeat(2600))).toEqual({ success: true });
    expect(writeUserProfile("u".repeat(1800))).toEqual({ success: true });

    expect(
      readFileSync(join(TEST_HOME, "memories", "MEMORY.md"), "utf-8").length,
    ).toBe(2600);
    expect(
      readFileSync(join(TEST_HOME, "memories", "USER.md"), "utf-8").length,
    ).toBe(1800);
  });

  it("uses profile limits when validating memory entry updates", () => {
    writeConfig(
      [
        "memory:",
        "  memory_char_limit: 2600",
        "  user_char_limit: 1375",
        "",
      ].join("\n"),
      "work",
    );
    writeMemoryFile("short", "work");

    expect(updateMemoryEntry(0, "x".repeat(2300), "work")).toEqual({
      success: true,
    });
  });

  it("falls back to defaults for invalid config values", () => {
    writeConfig(
      [
        "memory:",
        "  memory_char_limit: nope",
        "  user_char_limit: -1",
        "",
      ].join("\n"),
    );

    const result = addMemoryEntry("x".repeat(DEFAULT_MEMORY_CHAR_LIMIT + 1));

    expect(result.success).toBe(false);
    expect(result.error).toContain(`/${DEFAULT_MEMORY_CHAR_LIMIT} chars`);
  });
});
