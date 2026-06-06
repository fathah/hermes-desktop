import { describe, it, expect } from "vitest";
import { dataConfidence } from "./dataConfidence";
import type { EquityReport } from "./reportContract";

function report(overrides: Partial<EquityReport>): EquityReport {
  return {
    ticker: "NTPC",
    exchange: "NSE",
    currency: "INR",
    rating: "HOLD",
    confidence: "medium",
    scores: {},
    valuation: {},
    riskMatrix: {},
    priceSeries: [],
    peers: [],
    sectorHeatmap: null,
    dcfSensitivity: null,
    evidenceRefs: [],
    dataGaps: [],
    provenance: {},
    bodyMarkdown: "",
    ...overrides,
  };
}

describe("dataConfidence", () => {
  it("prefers an explicit provenance.data_confidence object", () => {
    const r = report({
      provenance: {
        data_confidence: { level: "high", reason: "skill says so" },
      },
      evidenceRefs: [],
    });
    expect(dataConfidence(r)).toEqual({
      level: "high",
      reason: "skill says so",
    });
  });

  it("accepts a bare provenance string", () => {
    const r = report({ provenance: { data_confidence: "low" } });
    expect(dataConfidence(r).level).toBe("low");
  });

  it("is low with no evidence", () => {
    expect(dataConfidence(report({})).level).toBe("low");
  });

  it("is high with mostly fresh high-tier evidence and no gaps", () => {
    const r = report({
      evidenceRefs: [
        { uuid: "1", source: "nse", tier: "tier2", fetched_at: "2026-06-06" },
        { uuid: "2", source: "ir", tier: "tier1", fetched_at: "2026-06-06" },
        { uuid: "3", source: "yf", tier: "tier3", fetched_at: "2026-06-06" },
      ],
      dataGaps: [],
    });
    expect(dataConfidence(r).level).toBe("high");
  });

  it("drops to medium when gaps exist", () => {
    const r = report({
      evidenceRefs: [
        { uuid: "1", source: "nse", tier: "tier2", fetched_at: "2026-06-06" },
        { uuid: "2", source: "ir", tier: "tier1", fetched_at: "2026-06-06" },
      ],
      dataGaps: ["missing dividend yield"],
    });
    expect(dataConfidence(r).level).toBe("medium");
  });

  it("is low when mostly aggregator/derived tiers", () => {
    const r = report({
      evidenceRefs: [
        { uuid: "1", source: "yf", tier: "tier3", fetched_at: "2026-06-06" },
        { uuid: "2", source: "sc", tier: "tier3", fetched_at: "2026-06-06" },
        { uuid: "3", source: "nse", tier: "tier2", fetched_at: "2026-06-06" },
      ],
    });
    expect(dataConfidence(r).level).toBe("low"); // 33% high-tier < 34%
  });
});
