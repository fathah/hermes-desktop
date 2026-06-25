import { describe, it, expect } from "vitest";
import {
  normalizeModelId,
  getContextLength,
  contextFillFraction,
  contextFillPercent,
  DEFAULT_CONTEXT_LENGTH,
} from "../src/renderer/src/lib/model-context";

describe("normalizeModelId", () => {
  it("lowercases and collapses separators", () => {
    expect(normalizeModelId("  Claude_Opus 4.6 ")).toBe("claude-opus-4.6");
  });
});

describe("getContextLength", () => {
  it("matches provider-prefixed Anthropic ids", () => {
    expect(getContextLength("anthropic/claude-opus-4.6")).toBe(200_000);
    expect(getContextLength("claude-sonnet-4-6")).toBe(200_000);
  });

  it("prefers the longer/more specific table key", () => {
    // "gpt-4o-mini" must not be captured by the shorter "gpt-4o"
    expect(getContextLength("openai/gpt-4o-mini")).toBe(128_000);
    expect(getContextLength("gpt-4.1")).toBe(1_000_000);
  });

  it("matches Gemini and large-context families", () => {
    expect(getContextLength("google/gemini-1.5-pro")).toBe(2_000_000);
    expect(getContextLength("gemini-3-flash")).toBe(1_000_000);
  });

  it("falls back to a family heuristic for unseen ids", () => {
    expect(getContextLength("claude-something-brand-new")).toBe(200_000);
    expect(getContextLength("some-gemini-variant")).toBe(1_000_000);
  });

  it("uses the default for fully unknown models", () => {
    expect(getContextLength("totally-made-up-model")).toBe(
      DEFAULT_CONTEXT_LENGTH,
    );
    expect(getContextLength(undefined)).toBe(DEFAULT_CONTEXT_LENGTH);
    expect(getContextLength("")).toBe(DEFAULT_CONTEXT_LENGTH);
  });

  it("lets an override win over the table", () => {
    expect(
      getContextLength("anthropic/claude-opus-4.6", {
        overrides: { "anthropic/claude-opus-4.6": 500_000 },
      }),
    ).toBe(500_000);
    // normalized-key override also matches
    expect(
      getContextLength("Claude-Opus-4.6", {
        overrides: { "claude-opus-4.6": 333_000 },
      }),
    ).toBe(333_000);
  });

  it("ignores invalid overrides", () => {
    expect(
      getContextLength("gpt-4.1", {
        overrides: { "gpt-4.1": -5 },
      }),
    ).toBe(1_000_000);
  });
});

describe("contextFillFraction / contextFillPercent", () => {
  it("computes a clamped fraction", () => {
    // 100k of a 200k window = 0.5
    expect(contextFillFraction(100_000, "claude-opus-4.6")).toBeCloseTo(0.5, 6);
  });

  it("clamps overflow to 1", () => {
    expect(contextFillFraction(500_000, "claude-opus-4.6")).toBe(1);
  });

  it("returns 0 for non-positive or invalid usage", () => {
    expect(contextFillFraction(0, "claude-opus-4.6")).toBe(0);
    expect(contextFillFraction(-10, "claude-opus-4.6")).toBe(0);
    expect(contextFillFraction(NaN, "claude-opus-4.6")).toBe(0);
  });

  it("returns an integer percentage", () => {
    expect(contextFillPercent(50_000, "claude-opus-4.6")).toBe(25);
    expect(contextFillPercent(190_000, "claude-opus-4.6")).toBe(95);
  });
});
