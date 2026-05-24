import { describe, expect, it, vi } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(
      os.tmpdir(),
      `hermes-profile-validation-${Date.now()}`,
    ),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

import {
  isValidNamedProfileName,
  isValidProfileName,
  normalizeProfileName,
  profileHome,
  activeStateDbPath,
  PROFILE_NAME_ERROR,
} from "../src/main/utils";

describe("profile name validation", () => {
  it("accepts default and renderer-created profile names", () => {
    expect(isValidProfileName("default")).toBe(true);
    expect(isValidNamedProfileName("work")).toBe(true);
    expect(isValidNamedProfileName("work_1-prod")).toBe(true);
    expect(normalizeProfileName("default")).toBeUndefined();
    expect(normalizeProfileName("")).toBeUndefined();
    expect(normalizeProfileName(undefined)).toBeUndefined();
  });

  it("rejects path traversal, option-like, and ambiguous profile names", () => {
    for (const value of [
      "../secrets",
      "..",
      ".hidden",
      "with/slash",
      "with\\slash",
      "-profile",
      "has space",
      "UpperCase",
      "semi;colon",
      null,
      { name: "work" },
    ]) {
      expect(isValidProfileName(value)).toBe(false);
      expect(() => normalizeProfileName(value)).toThrow(PROFILE_NAME_ERROR);
    }
  });

  it("keeps profile paths contained under the Hermes profiles directory", () => {
    expect(profileHome()).toBe(TEST_HOME);
    expect(profileHome("default")).toBe(TEST_HOME);
    expect(profileHome("work_1-prod")).toBe(
      join(TEST_HOME, "profiles", "work_1-prod"),
    );
    expect(() => profileHome("../outside")).toThrow(PROFILE_NAME_ERROR);
  });

  it("resolves the active profile's session DB path (issue #311)", () => {
    mkdirSync(TEST_HOME, { recursive: true });
    // No active_profile file → default profile → root state.db.
    expect(activeStateDbPath()).toBe(join(TEST_HOME, "state.db"));
    // Named active profile → profiles/<name>/state.db, not the root db.
    writeFileSync(join(TEST_HOME, "active_profile"), "work_1-prod");
    expect(activeStateDbPath()).toBe(
      join(TEST_HOME, "profiles", "work_1-prod", "state.db"),
    );
  });
});
