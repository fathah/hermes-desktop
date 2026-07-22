import { describe, expect, it } from "vitest";
import {
  isSessionTitleUniqueViolation,
  MAX_SESSION_TITLE_LENGTH,
  normalizeSessionTitle,
  validateNormalizedSessionTitle,
} from "./session-title";

describe("normalizeSessionTitle", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeSessionTitle("  Hello   World  ")).toBe("Hello World");
  });
});

describe("validateNormalizedSessionTitle", () => {
  it("rejects empty and oversized titles", () => {
    expect(validateNormalizedSessionTitle("")).toBe("empty");
    expect(
      validateNormalizedSessionTitle("x".repeat(MAX_SESSION_TITLE_LENGTH + 1)),
    ).toBe("too_long");
    expect(validateNormalizedSessionTitle("ok")).toBeNull();
  });
});

describe("isSessionTitleUniqueViolation", () => {
  it("matches sessions.title UNIQUE failures only", () => {
    expect(
      isSessionTitleUniqueViolation(
        new Error("UNIQUE constraint failed: sessions.title"),
      ),
    ).toBe(true);

    const coded = new Error(
      "UNIQUE constraint failed: sessions.title",
    ) as Error & { code: string };
    coded.code = "SQLITE_CONSTRAINT_UNIQUE";
    expect(isSessionTitleUniqueViolation(coded)).toBe(true);

    expect(
      isSessionTitleUniqueViolation(
        new Error("CHECK constraint failed: message_count"),
      ),
    ).toBe(false);
  });
});
