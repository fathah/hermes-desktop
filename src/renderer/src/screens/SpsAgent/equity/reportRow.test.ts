import { describe, it, expect } from "vitest";
import {
  tickerSlug,
  deriveAutoTags,
  deriveRowProps,
  mergeRowProps,
  splitRegions,
  extractGeneratedReport,
  buildRowBody,
  mergeRow,
  DB_FOLDER,
} from "./reportRow";
import { rowToMarkdown, rowFromMarkdown } from "../editor/rowMarkdown";
import { parseEquityReport, type EquityReport } from "./reportContract";

function report(over: Partial<EquityReport> = {}): EquityReport {
  return {
    ticker: "NTPC",
    exchange: "NSE",
    company: "NTPC Limited",
    sector: "Power Generation (PSU)",
    asOf: "2026-06-06",
    price: 366.4,
    currency: "INR",
    rating: "ACCUMULATE",
    confidence: "medium",
    scores: { composite: 62 },
    valuation: { intrinsic_per_share: 385, upside: 5.1 },
    riskMatrix: {},
    priceSeries: [],
    peers: [],
    sectorHeatmap: null,
    dcfSensitivity: null,
    evidenceRefs: [],
    dataGaps: [],
    provenance: { run_id: "evidence-abc" },
    bodyMarkdown: "",
    ...over,
  } as EquityReport;
}

// a minimal real report markdown (its own contract frontmatter + body)
const REPORT_MD =
  "---\n" +
  JSON.stringify({
    hermes_report: "india-equity-research",
    ticker: "NTPC",
    rating: "ACCUMULATE",
    scores: { composite: 62 },
  }) +
  "\n---\n\n# NTPC\n\n## Executive Summary\nx\n";

describe("identity & tags", () => {
  it("slugs tickers id-safe", () => {
    expect(tickerSlug("NTPC")).toBe("ntpc");
    expect(tickerSlug("M&M.NS")).toBe("m-m-ns");
    expect(tickerSlug("")).toBe("untitled");
  });
  it("derives controlled auto-tags", () => {
    const t = deriveAutoTags(report());
    expect(t).toContain("sector:power");
    expect(t).toContain("rating:accumulate");
    expect(t).toContain("PSU");
    expect(t).toContain("theme:power");
  });
  it("commodity facets from sector", () => {
    expect(deriveAutoTags(report({ sector: "Coal Mining (PSU)" }))).toContain(
      "commodity:coal",
    );
    expect(
      deriveAutoTags(report({ sector: "Oil & Gas Upstream (PSU)" })),
    ).toContain("commodity:crude");
  });
});

describe("row props projection", () => {
  it("projects sortable/filterable fields", () => {
    const p = deriveRowProps(report(), "2026-06-06T01:00:00Z");
    expect(p.ticker).toBe("NTPC");
    expect(p.rating).toBe("ACCUMULATE");
    expect(p.composite).toBe(62);
    expect(p.intrinsic).toBe(385);
    expect(p.upside_pct).toBe(5.1);
    expect(Array.isArray(p.tags)).toBe(true);
    expect(p.run_id).toBe("evidence-abc");
  });
  it("handles alternate valuation field names", () => {
    const p = deriveRowProps(
      report({ valuation: { intrinsic_inr: 410, upside_pct: 9 } }),
      "now",
    );
    expect(p.intrinsic).toBe(410);
    expect(p.upside_pct).toBe(9);
  });
  it("mergeRowProps preserves user_tags, refreshes machine fields", () => {
    const old = {
      rating: "HOLD",
      composite: 50,
      user_tags: ["core-holding", "watch"],
    };
    const fresh = deriveRowProps(report(), "now");
    const merged = mergeRowProps(old, fresh);
    expect(merged.rating).toBe("ACCUMULATE"); // refreshed
    expect(merged.composite).toBe(62);
    expect(merged.user_tags).toEqual(["core-holding", "watch"]); // preserved
  });
});

describe("body regions", () => {
  it("round-trips report region for parseEquityReport", () => {
    const body = buildRowBody({ report: REPORT_MD, runHistory: [], notes: "" });
    const extracted = extractGeneratedReport(body);
    const parsed = parseEquityReport(extracted);
    expect(parsed).not.toBeNull();
    expect(parsed!.ticker).toBe("NTPC");
  });
  it("parses a run-history table", () => {
    const body = buildRowBody({
      report: REPORT_MD,
      runHistory: [
        {
          date: "2026-06-06",
          rating: "ACCUMULATE",
          composite: 62,
          intrinsic: 385,
          note: "initial",
        },
      ],
      notes: "",
    });
    const rows = splitRegions(body).runHistory;
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe("ACCUMULATE");
    expect(rows[0].composite).toBe(62);
  });
  it("uses a notes placeholder when empty, keeps notes when present", () => {
    expect(
      buildRowBody({ report: REPORT_MD, runHistory: [], notes: "" }),
    ).toContain("never overwritten");
    const withNotes = buildRowBody({
      report: REPORT_MD,
      runHistory: [],
      notes: "My thesis: defensive.",
    });
    expect(splitRegions(withNotes).notes).toBe("My thesis: defensive.");
  });
});

describe("mergeRow — refresh-in-place (the crux)", () => {
  it("first run seeds row + one history line + empty notes", () => {
    const m = mergeRow(null, report(), REPORT_MD, "2026-06-06T01:00:00Z");
    expect(m.props.ticker).toBe("NTPC");
    expect(m.props.user_tags).toEqual([]);
    expect(splitRegions(m.body).runHistory).toHaveLength(1);
  });

  it("refresh REPLACES report, APPENDS history, PRESERVES notes + user_tags", () => {
    // first row, then a user adds notes + tags and edits to disk
    const first = mergeRow(
      null,
      report({ rating: "HOLD", scores: { composite: 55 } }),
      REPORT_MD,
      "2026-06-01T00:00:00Z",
    );
    // simulate the user adding notes + a tag, then editing back to disk
    const prior = splitRegions(first.body);
    const userRow = {
      props: { ...first.props, user_tags: ["core-holding"] },
      body: buildRowBody({
        report: prior.report,
        runHistory: prior.runHistory,
        notes: "My thesis: accumulate under 350.",
      }),
    };

    const newReportMd = REPORT_MD.replace(
      '"composite":62',
      '"composite":62',
    ).replace("# NTPC", "# NTPC (refreshed)");
    const second = mergeRow(
      userRow,
      report({ rating: "ACCUMULATE", scores: { composite: 62 } }),
      newReportMd,
      "2026-06-06T00:00:00Z",
    );

    // report region replaced
    expect(extractGeneratedReport(second.body)).toContain("# NTPC (refreshed)");
    // history appended (2 rows now)
    const hist = splitRegions(second.body).runHistory;
    expect(hist).toHaveLength(2);
    expect(hist[0].rating).toBe("HOLD");
    expect(hist[1].rating).toBe("ACCUMULATE");
    // notes preserved
    expect(splitRegions(second.body).notes).toContain(
      "My thesis: accumulate under 350",
    );
    // user tags preserved, machine fields refreshed
    expect(second.props.user_tags).toEqual(["core-holding"]);
    expect(second.props.rating).toBe("ACCUMULATE");
  });

  it("survives a full rowToMarkdown→rowFromMarkdown disk round-trip", () => {
    const m = mergeRow(null, report(), REPORT_MD, "2026-06-06T00:00:00Z");
    const onDisk = rowToMarkdown(m.props, m.body);
    const back = rowFromMarkdown(onDisk);
    // row frontmatter parsed; body still holds the report region (nested fm intact)
    expect(back.props.ticker).toBe("NTPC");
    expect(extractGeneratedReport(back.body)).toContain("# NTPC");
    expect(parseEquityReport(extractGeneratedReport(back.body))!.rating).toBe(
      "ACCUMULATE",
    );
  });
});

describe("constants", () => {
  it("targets the equity-research folder", () => {
    expect(DB_FOLDER).toBe("equity-research");
  });
});
