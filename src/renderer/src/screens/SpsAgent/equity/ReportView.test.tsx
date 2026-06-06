import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ReportView } from "./ReportView";
import type { EquityReport } from "./reportContract";

// AgentMarkdown lazy-loads a syntax highlighter; stub it to keep the test light.
vi.mock("../../../components/AgentMarkdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="md">{children}</div>
  ),
}));

const report: EquityReport = {
  ticker: "NTPC",
  exchange: "NSE",
  company: "NTPC Limited",
  sector: "Power Generation (PSU)",
  asOf: "2026-06-05",
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
  valuation: { intrinsic_inr: 348 },
  riskMatrix: {
    financial: { severity: "Low", factor: "ROCE 11%" },
    governance: { severity: "Medium", factor: "GoI 51%" },
    geopolitical: { severity: "Low", factor: "domestic" },
    tech_disruption: { severity: "Medium", factor: "renewables" },
    fx_trade: { severity: "Low", factor: "coal import" },
    legislative: { severity: "Medium", factor: "CERC" },
    political: { severity: "Medium", factor: "PLI" },
    technical: { severity: "Medium", factor: "below SMA200" },
  },
  priceSeries: Array.from({ length: 60 }, (_, i) => ({
    date: `2026-01-${(i % 28) + 1}`,
    c: 300 + Math.round(Math.sin(i / 4) * 25 + i * 0.4),
  })),
  peers: [
    { name: "NTPC", pe: 14.2 },
    { name: "POWERGRID", pe: 11.8 },
  ],
  sectorHeatmap: {
    metrics: ["pe_z", "roe_z", "mom_z"],
    rows: [
      { name: "NTPC", values: [0.4, -0.2, 0.6] },
      { name: "POWERGRID", values: [-0.3, 0.8, 0.1] },
    ],
  },
  dcfSensitivity: {
    wacc: [0.09, 0.1],
    growth: [0.03, 0.095],
    grid: [
      [420, null],
      [400, null],
    ],
  },
  evidenceRefs: [{ uuid: "evidence-AAA", source: "nse", tier: "tier2" }],
  dataGaps: ["Q4 capex guidance not yet filed"],
  provenance: { run_id: "run_1" },
  bodyMarkdown: "## Executive Summary\nDefensive utility.",
};

describe("ReportView", () => {
  it("renders headline, rating, scores, charts, evidence and data gaps without throwing", () => {
    const { getByText, container, getAllByText } = render(
      <ReportView report={report} onSaveToVault={() => {}} saving={false} />,
    );
    expect(getByText("NTPC Limited")).toBeTruthy();
    expect(getByText("ACCUMULATE")).toBeTruthy();
    expect(getByText("Q4 capex guidance not yet filed")).toBeTruthy();
    // radar + peer bars + dcf + price + P&F + sector heatmap all render as SVG
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(6);
    expect(getByText("tier2")).toBeTruthy();
    // composite score value shown
    expect(getAllByText("64").length).toBeGreaterThanOrEqual(1);
    // the new technical + sector sections are present
    expect(container.querySelector(".eq-technical")).not.toBeNull();
    expect(container.querySelector(".eq-sector")).not.toBeNull();
    expect(getByText("Technical — Point & Figure")).toBeTruthy();
  });

  it("omits chart sections when their data slice is absent", () => {
    const partial: EquityReport = {
      ...report,
      peers: [],
      dcfSensitivity: null,
      riskMatrix: {},
      priceSeries: [],
      sectorHeatmap: null,
    };
    const { container, queryByText } = render(
      <ReportView report={partial} onSaveToVault={() => {}} saving={false} />,
    );
    expect(queryByText("Peer Comparison (P/E)")).toBeNull();
    expect(queryByText("DCF Sensitivity (intrinsic ₹ / share)")).toBeNull();
    expect(container.querySelector(".eq-radar")).toBeNull();
    // no technical / sector sections without price_series / sector_heatmap
    expect(container.querySelector(".eq-technical")).toBeNull();
    expect(container.querySelector(".eq-sector")).toBeNull();
  });
});
