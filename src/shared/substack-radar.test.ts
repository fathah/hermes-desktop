import { describe, expect, it } from "vitest";
import {
  buildSubstackRadarCandidateId,
  normalizeSubstackRadarCategories,
  scoreSubstackRadarCandidate,
} from "./substack-radar";

describe("normalizeSubstackRadarCategories", () => {
  it("trims, dedupes, and drops empty categories", () => {
    expect(
      normalizeSubstackRadarCategories([
        " AI agents ",
        "",
        "ai agents",
        "Markets",
      ]),
    ).toEqual(["AI agents", "Markets"]);
  });
});

describe("buildSubstackRadarCandidateId", () => {
  it("creates a stable id from the publication URL", () => {
    expect(
      buildSubstackRadarCandidateId(
        "https://example.substack.com/?utm_source=x",
      ),
    ).toBe("substack-radar:https://example.substack.com/");
  });
});

describe("scoreSubstackRadarCandidate", () => {
  it("scores visible signals without requiring hidden metrics", () => {
    expect(
      scoreSubstackRadarCandidate({
        title: "Agent Notes",
        description: "Deep writing about AI agents.",
        visibleSignals: {
          subscriberText: "12K subscribers",
          badgeText: "Bestseller",
        },
      }),
    ).toBe(92);
  });
});
