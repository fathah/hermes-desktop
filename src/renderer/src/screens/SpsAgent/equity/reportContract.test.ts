import { describe, it, expect } from "vitest";
import { parseEquityReport, isEquityReport } from "./reportContract";

// Mirrors what india-equity-research/scripts/report_builder.py emits:
// a JSON frontmatter block (valid YAML) + a body with a Data Gaps section.
const REPORT = `---
${JSON.stringify(
  {
    hermes_report: "india-equity-research",
    schema: 1,
    ticker: "NTPC",
    exchange: "NSE",
    company: "NTPC Limited",
    sector: "Power Generation (PSU)",
    as_of: "2026-06-05",
    price: 312.4,
    currency: "INR",
    rating: "ACCUMULATE",
    confidence: "medium",
    scores: {
      composite: 64,
      fundamental: 71,
      technical: 55,
      risk: 60,
      sentiment: 58,
      macro: 67,
    },
    valuation: { intrinsic_inr: 348, upside_pct: 11.4 },
    risk_matrix: {
      governance: { severity: "Medium", factor: "GoI 51% stake" },
    },
    price_series: [
      { date: "2026-01-02", o: 330, h: 335, l: 328, c: 332, v: 1200000 },
    ],
    peers: [
      { name: "NTPC", pe: 14.2 },
      { name: "POWERGRID", pe: 11.8 },
    ],
    sector_heatmap: {
      metrics: ["pe_z"],
      rows: [{ name: "NTPC", values: [0.4] }],
    },
    dcf_sensitivity: {
      wacc: [0.09, 0.1],
      growth: [0.03, 0.04],
      grid: [
        [420, 440],
        [400, 418],
      ],
    },
    evidence_refs: [{ uuid: "evidence-AAA", source: "nse", tier: "tier2" }],
    data_gaps: ["Q4 capex guidance not yet filed"],
    provenance: { run_id: "run_1", model: "hermes-agent" },
  },
  null,
  2,
)}
---

## Executive Summary
Defensive regulated utility; accumulate on dips.

## Data Gaps & Epistemic Notes
- Q4 capex guidance not yet filed
`;

describe("parseEquityReport", () => {
  it("parses a well-formed report's frontmatter", () => {
    const r = parseEquityReport(REPORT);
    expect(r).not.toBeNull();
    expect(r!.ticker).toBe("NTPC");
    expect(r!.rating).toBe("ACCUMULATE");
    expect(r!.scores.composite).toBe(64);
    expect(r!.valuation.intrinsic_inr).toBe(348);
    expect(r!.evidenceRefs[0].source).toBe("nse");
    expect(r!.dataGaps).toContain("Q4 capex guidance not yet filed");
    expect(r!.dcfSensitivity?.grid[0][0]).toBe(420);
    expect(r!.peers).toHaveLength(2);
  });

  it("exposes the body markdown after the frontmatter", () => {
    const r = parseEquityReport(REPORT);
    expect(r!.bodyMarkdown).toContain("## Executive Summary");
    expect(r!.bodyMarkdown).toContain("## Data Gaps & Epistemic Notes");
  });

  it("returns null for a plain chat reply (no frontmatter)", () => {
    expect(parseEquityReport("Hello, here is my answer.")).toBeNull();
    expect(isEquityReport("Hello")).toBe(false);
  });

  it("returns null for non-hermes frontmatter", () => {
    const other =
      "---\n" + JSON.stringify({ title: "Some doc" }) + "\n---\nbody";
    expect(parseEquityReport(other)).toBeNull();
  });

  it("is resilient to a partial report (missing optional sections)", () => {
    const partial =
      "---\n" +
      JSON.stringify({
        hermes_report: "india-equity-research",
        ticker: "COALINDIA",
        rating: "BUY",
        scores: { composite: 70 },
      }) +
      "\n---\n# partial";
    const r = parseEquityReport(partial);
    expect(r).not.toBeNull();
    expect(r!.ticker).toBe("COALINDIA");
    expect(r!.peers).toEqual([]);
    expect(r!.sectorHeatmap).toBeNull();
    expect(r!.dcfSensitivity).toBeNull();
    expect(r!.dataGaps).toEqual([]);
  });

  it("does not throw on malformed frontmatter", () => {
    const bad = "---\n{ not: valid: json: : }\n---\nbody";
    expect(parseEquityReport(bad)).toBeNull();
  });
});
