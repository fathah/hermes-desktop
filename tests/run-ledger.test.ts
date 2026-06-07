import { describe, it, expect } from "vitest";
import { sessionLedger, type UsageRecord } from "../src/shared/usage";

function rec(
  iso: string,
  sessionId: string | undefined,
  model = "m",
  tokens = 10,
  cost = 0.01,
): UsageRecord {
  return {
    ts: Date.parse(iso),
    sessionId,
    model,
    promptTokens: tokens,
    completionTokens: tokens,
    totalTokens: tokens * 2,
    cost,
  };
}

describe("sessionLedger", () => {
  it("groups turns by session and sums tokens + cost", () => {
    const rows = sessionLedger([
      rec("2026-06-01T00:00:00Z", "s1", "m", 10, 0.01),
      rec("2026-06-01T00:05:00Z", "s1", "m", 20, 0.02),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("s1");
    expect(rows[0].turns).toBe(2);
    expect(rows[0].totalTokens).toBe(60); // (10+20)*2
    expect(rows[0].cost).toBeCloseTo(0.03);
  });

  it("orders rows by most-recent activity first", () => {
    const rows = sessionLedger([
      rec("2026-06-01T00:00:00Z", "old"),
      rec("2026-06-03T00:00:00Z", "new"),
      rec("2026-06-02T00:00:00Z", "mid"),
    ]);
    expect(rows.map((r) => r.sessionId)).toEqual(["new", "mid", "old"]);
  });

  it("records first/last timestamps and distinct models in first-seen order", () => {
    const rows = sessionLedger([
      rec("2026-06-01T09:00:00Z", "s1", "sonnet"),
      rec("2026-06-01T10:00:00Z", "s1", "opus"),
      rec("2026-06-01T08:00:00Z", "s1", "sonnet"),
    ]);
    expect(rows[0].firstTs).toBe(Date.parse("2026-06-01T08:00:00Z"));
    expect(rows[0].lastTs).toBe(Date.parse("2026-06-01T10:00:00Z"));
    expect(rows[0].models).toEqual(["sonnet", "opus"]);
  });

  it("skips records with no sessionId (can't attribute to a run)", () => {
    const rows = sessionLedger([
      rec("2026-06-01T00:00:00Z", undefined),
      rec("2026-06-01T00:00:00Z", "s1"),
    ]);
    expect(rows.map((r) => r.sessionId)).toEqual(["s1"]);
  });

  it("treats a missing cost as zero", () => {
    const rows = sessionLedger([
      {
        ts: 1,
        sessionId: "s1",
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
    ]);
    expect(rows[0].cost).toBe(0);
  });

  it("is empty for no records", () => {
    expect(sessionLedger([])).toEqual([]);
  });
});
