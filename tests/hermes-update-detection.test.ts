import { describe, it, expect } from "vitest";
import { interpretHeadComparison } from "../src/main/installer";

describe("interpretHeadComparison (WS3 runtime update detection)", () => {
  it("reports no update when local and upstream HEADs match", () => {
    expect(interpretHeadComparison("abc123", "abc123", "0")).toEqual({
      available: false,
      localHead: "abc123",
      upstreamHead: "abc123",
    });
  });

  it("reports an update when HEADs differ, with the behind count", () => {
    expect(interpretHeadComparison("abc123", "def456", "4")).toEqual({
      available: true,
      behindBy: 4,
      localHead: "abc123",
      upstreamHead: "def456",
    });
  });

  it("still reports available when the behind count is unavailable", () => {
    const r = interpretHeadComparison("abc123", "def456", null);
    expect(r.available).toBe(true);
    expect(r.behindBy).toBeUndefined();
  });

  it("ignores a non-numeric / zero behind count rather than reporting 0", () => {
    expect(
      interpretHeadComparison("a", "b", "not-a-number").behindBy,
    ).toBeUndefined();
    expect(interpretHeadComparison("a", "b", "0").behindBy).toBeUndefined();
  });

  it("reports no-upstream when there is no tracking branch", () => {
    expect(interpretHeadComparison("abc123", null, null)).toEqual({
      available: false,
      reason: "no-upstream",
      localHead: "abc123",
    });
  });

  it("reports no-head when the local HEAD can't be resolved", () => {
    expect(interpretHeadComparison(null, null, null)).toEqual({
      available: false,
      reason: "no-head",
    });
  });
});
