import { describe, it, expect } from "vitest";
import {
  formatTokensShort,
  contextLevel,
  contextGaugeInfo,
  isCompressionSummary,
} from "../src/renderer/src/screens/Chat/contextGauge";

describe("formatTokensShort", () => {
  it("formats counts compactly", () => {
    expect(formatTokensShort(500)).toBe("500");
    expect(formatTokensShort(1500)).toBe("1.5k");
    expect(formatTokensShort(128000)).toBe("128k");
    expect(formatTokensShort(0)).toBe("0");
  });
});

describe("contextLevel", () => {
  it("buckets at the 70% and 90% thresholds", () => {
    expect(contextLevel(10)).toBe("ok");
    expect(contextLevel(69)).toBe("ok");
    expect(contextLevel(70)).toBe("warn");
    expect(contextLevel(89)).toBe("warn");
    expect(contextLevel(90)).toBe("high");
    expect(contextLevel(100)).toBe("high");
  });
});

describe("contextGaugeInfo", () => {
  it("derives percent, limit, level and label", () => {
    // 100k of a 200k Claude window = 50%
    const info = contextGaugeInfo(100_000, "anthropic/claude-opus-4.6");
    expect(info.percent).toBe(50);
    expect(info.limit).toBe(200_000);
    expect(info.level).toBe("ok");
    expect(info.label).toBe("50% of 200k");
  });

  it("flags a near-full context as high", () => {
    const info = contextGaugeInfo(195_000, "claude-opus-4.6");
    expect(info.level).toBe("high");
  });
});

describe("isCompressionSummary", () => {
  it("detects a structured gateway summary", () => {
    const text = [
      "## Conversation Summary",
      "Goal: build the feature",
      "Progress: scaffolding done",
      "Next Steps: write tests",
    ].join("\n");
    expect(isCompressionSummary(text)).toBe(true);
  });

  it("does not flag an ordinary message mentioning summary once", () => {
    expect(isCompressionSummary("Here is a summary of the news.")).toBe(false);
  });

  it("is false for empty/plain text", () => {
    expect(isCompressionSummary("")).toBe(false);
    expect(isCompressionSummary("hello there")).toBe(false);
  });
});
