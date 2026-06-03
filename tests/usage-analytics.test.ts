import { describe, it, expect } from "vitest";
import {
  toDaySeries,
  topModels,
  formatCost,
  aggregateUsage,
  type UsageRecord,
} from "../src/shared/usage";

describe("toDaySeries", () => {
  it("returns days ascending by date", () => {
    const { byDay } = aggregateUsage([
      mk("2026-06-03T01:00:00Z"),
      mk("2026-06-01T01:00:00Z"),
      mk("2026-06-02T01:00:00Z"),
    ]);
    expect(toDaySeries(byDay).map((d) => d.day)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
  });

  it("is empty for no data", () => {
    expect(toDaySeries({})).toEqual([]);
  });
});

describe("topModels", () => {
  it("sorts by cost desc then tokens desc and caps at limit", () => {
    const { byModel } = aggregateUsage([
      mk("2026-06-01T00:00:00Z", "cheap", 10, 0.001),
      mk("2026-06-01T00:00:00Z", "pricey", 5, 0.5),
      mk("2026-06-01T00:00:00Z", "mid", 8, 0.1),
    ]);
    const ranked = topModels(byModel, 2);
    expect(ranked.map((m) => m.model)).toEqual(["pricey", "mid"]);
  });

  it("breaks cost ties by total tokens", () => {
    const { byModel } = aggregateUsage([
      mk("2026-06-01T00:00:00Z", "small", 10, 0),
      mk("2026-06-01T00:00:00Z", "big", 100, 0),
    ]);
    expect(topModels(byModel)[0].model).toBe("big");
  });
});

describe("formatCost", () => {
  it("renders an em dash for zero/undefined", () => {
    expect(formatCost(0)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });
  it("uses 4 decimals for sub-cent costs and 2 otherwise", () => {
    expect(formatCost(0.0023)).toBe("$0.0023");
    expect(formatCost(1.2)).toBe("$1.20");
  });
});

function mk(iso: string, model = "m", tokens = 10, cost = 0.01): UsageRecord {
  return {
    ts: Date.parse(iso),
    model,
    promptTokens: tokens,
    completionTokens: tokens,
    totalTokens: tokens * 2,
    cost,
  };
}
