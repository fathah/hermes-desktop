import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  assertIpcString,
  assertPathInside,
  normalizeIpcProfile,
} from "./validate";

describe("assertIpcString", () => {
  it("accepts strings and rejects non-strings", () => {
    expect(assertIpcString("home", "page id")).toBe("home");
    expect(() => assertIpcString(42, "page id")).toThrow(/page id/i);
    expect(() => assertIpcString(null, "page id")).toThrow(/page id/i);
  });

  it("rejects null bytes", () => {
    expect(() => assertIpcString("home\u0000evil", "page id")).toThrow(
      /null byte/i,
    );
  });
});

describe("normalizeIpcProfile", () => {
  it("normalizes default-ish profiles through the canonical profile rules", () => {
    expect(normalizeIpcProfile()).toBeUndefined();
    expect(normalizeIpcProfile("")).toBeUndefined();
    expect(normalizeIpcProfile("default")).toBeUndefined();
    expect(normalizeIpcProfile("work_1-prod")).toBe("work_1-prod");
  });

  it("rejects traversal, ambiguous, and malformed profiles", () => {
    for (const value of ["../x", "/tmp/profile", "work\u0000x", ".hidden"]) {
      expect(() => normalizeIpcProfile(value)).toThrow(/profile/i);
    }
  });
});

describe("assertPathInside", () => {
  const root = resolve("/tmp/hermes-vault");

  it("resolves a safe relative path inside the root", () => {
    expect(assertPathInside(root, "pages/home.md", "page path")).toBe(
      join(root, "pages", "home.md"),
    );
  });

  it("rejects traversal, absolute paths, dot segments, and null bytes", () => {
    for (const value of [
      "../escape.md",
      "pages/../../escape.md",
      "/tmp/escape.md",
      String.raw`C:\tmp\escape.md`,
      String.raw`\\server\share\escape.md`,
      "pages/./home.md",
      "pages//home.md",
      "home\u0000evil.md",
    ]) {
      expect(() => assertPathInside(root, value, "page path")).toThrow(
        /page path/i,
      );
    }
  });
});
