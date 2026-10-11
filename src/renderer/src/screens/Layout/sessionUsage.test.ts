import { describe, expect, it } from "vitest";
import {
  combineUsageTotals,
  formatSessionUsage,
  formatTokens,
  type SessionUsage,
} from "./sessionUsage";

const base: SessionUsage = {
  contextTokens: 38_200,
  contextWindow: 200_000,
  promptTokens: 120_000,
  completionTokens: 8_400,
  totalTokens: 128_400,
};

describe("formatTokens", () => {
  it("abbreviates thousands and millions without a trailing .0", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(38_200)).toBe("38.2k");
    expect(formatTokens(200_000)).toBe("200k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("formatSessionUsage", () => {
  it("returns null when there is nothing to show", () => {
    expect(formatSessionUsage(null)).toBeNull();
    expect(formatSessionUsage(undefined)).toBeNull();
    expect(
      formatSessionUsage({
        ...base,
        contextTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
      }),
    ).toBeNull();
  });

  it("shows context fill and in/out totals", () => {
    const d = formatSessionUsage(base)!;
    expect(d.context).toBe("ctx 38.2k/200k · 19%");
    expect(d.totals).toBe("↑120k ↓8.4k");
    expect(d.percent).toBe(19);
    expect(d.warn).toBe(false);
    expect(d.title).toContain("Context: 38,200 of 200,000 tokens (19%)");
    expect(d.title).toContain("Session: 120,000 in, 8,400 out, 128,400 total");
  });

  it("flags a nearly full context window", () => {
    expect(formatSessionUsage({ ...base, contextTokens: 170_000 })!.warn).toBe(
      true,
    );
    expect(formatSessionUsage({ ...base, contextTokens: 160_000 })!.warn).toBe(
      true,
    );
    expect(formatSessionUsage({ ...base, contextTokens: 159_000 })!.warn).toBe(
      false,
    );
  });

  it("omits the percentage and warning when the window is unknown", () => {
    const d = formatSessionUsage({ ...base, contextWindow: 0 })!;
    expect(d.context).toBe("ctx 38.2k");
    expect(d.percent).toBeNull();
    expect(d.warn).toBe(false);
    expect(d.title).toContain("window unknown");
  });

  it("does not print a contradictory 48k/32k when occupancy exceeds the assumed window", () => {
    const d = formatSessionUsage({
      ...base,
      contextTokens: 48_000,
      contextWindow: 32_768,
    })!;
    expect(d.context).toBe("ctx 48k");
    expect(d.percent).toBeNull();
    expect(d.warn).toBe(false);
    expect(d.title).toContain("probably wrong");
    expect(d.title).toContain("32,768");
  });

  it("appends cost and cache details only when reported", () => {
    const d = formatSessionUsage({
      ...base,
      cost: 0.4213,
      cacheReadTokens: 1000,
      cacheWriteTokens: 0,
    })!;
    expect(d.totals).toBe("↑120k ↓8.4k · $0.42");
    expect(d.title).toContain("Cache read: 1,000");
    expect(d.title).toContain("Cache write: 0");
    expect(formatSessionUsage({ ...base, cost: 0.001 })!.totals).toContain(
      "<$0.01",
    );
    expect(formatSessionUsage(base)!.title).not.toContain("Cost");
  });

  it("shows only totals before the first context reading", () => {
    const d = formatSessionUsage({ ...base, contextTokens: 0 })!;
    expect(d.context).toBe("");
    expect(d.totals).toBe("↑120k ↓8.4k");
  });

  it("marks an estimated context with ~ and says so in the tooltip", () => {
    const d = formatSessionUsage({
      contextTokens: 12_000,
      contextWindow: 200_000,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimated: true,
    })!;
    expect(d.context).toBe("ctx ~12k/200k · ~6%");
    expect(d.totals).toBe("");
    expect(d.title).toContain("estimated from the transcript");
    expect(formatSessionUsage(base)!.context).not.toContain("~");
  });
});

describe("combineUsageTotals", () => {
  const saved = {
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200,
    cost: 0.1,
  };
  const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  it("adds only what the live counters gained after the confirmed idle snapshot", () => {
    // A live turn of 300/50 happened after the confirmed idle record.
    const total = combineUsageTotals(
      saved,
      { ...zero },
      { promptTokens: 300, completionTokens: 50, totalTokens: 350, cost: 0.02 },
    );
    expect(total).toMatchObject({
      promptTokens: 1300,
      completionTokens: 250,
      totalTokens: 1550,
    });
    expect(total.cost).toBeCloseTo(0.12, 10);
  });

  it("does not count usage already included in the confirmed idle snapshot twice", () => {
    // The idle snapshot was admitted after the live counters reached 300/50.
    // Its confirmed baseline excludes that usage from subsequent additions.
    const live = { promptTokens: 300, completionTokens: 50, totalTokens: 350 };
    expect(combineUsageTotals(saved, live, live)).toMatchObject({
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
    });
    // A second live turn after that adds normally.
    expect(
      combineUsageTotals(saved, live, {
        promptTokens: 500,
        completionTokens: 90,
        totalTokens: 590,
      }),
    ).toMatchObject({ promptTokens: 1200, completionTokens: 240 });
  });

  it("keeps the live totals when no saved record exists, and never goes negative", () => {
    expect(
      combineUsageTotals(null, null, {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      }),
    ).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(
      combineUsageTotals(
        saved,
        { promptTokens: 9, completionTokens: 9, totalTokens: 9 },
        zero,
      ).promptTokens,
    ).toBe(1000);
  });

  it("omits cost when neither side has one", () => {
    expect(
      "cost" in combineUsageTotals({ ...zero }, { ...zero }, { ...zero }),
    ).toBe(false);
  });
});
