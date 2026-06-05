// Parser for the India equity research report contract (Track A ↔ Track B).
//
// The `india-equity-research` orchestrator emits one markdown document: a
// frontmatter block (emitted as JSON, which is valid YAML) followed by a
// human-readable body. We parse the frontmatter with the same `yaml` dependency
// the SPS editor uses (see editor/pageMarkdown.ts), then expose a typed,
// camelCased view. Non-reports (plain chat replies, older skills) parse to
// `null` so callers fall back to plain markdown rendering.

import { parse as parseYaml } from "yaml";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const REPORT_MARKER = "india-equity-research";

export interface EquityScores {
  composite: number;
  fundamental: number;
  technical: number;
  risk: number;
  sentiment: number;
  macro: number;
}

export interface RiskCell {
  severity: string;
  factor: string;
}

export interface EvidenceRef {
  uuid: string;
  source: string;
  tier: string;
  fetched_at?: string;
}

export interface PeerRow {
  name: string;
  [metric: string]: string | number;
}

export interface DcfSensitivity {
  wacc: number[];
  growth: number[];
  grid: Array<Array<number | null>>;
}

export interface SectorHeatmap {
  metrics: string[];
  rows: Array<{ name: string; values: number[] }>;
}

export interface PriceBar {
  date: string;
  o?: number;
  h?: number;
  l?: number;
  c: number;
  v?: number;
}

export interface EquityReport {
  ticker: string;
  exchange: string;
  company?: string;
  sector?: string;
  asOf?: string;
  price?: number;
  currency: string;
  rating: string;
  confidence: string;
  scores: Partial<EquityScores>;
  valuation: Record<string, unknown>;
  riskMatrix: Record<string, RiskCell>;
  priceSeries: PriceBar[];
  peers: PeerRow[];
  sectorHeatmap: SectorHeatmap | null;
  dcfSensitivity: DcfSensitivity | null;
  evidenceRefs: EvidenceRef[];
  dataGaps: string[];
  provenance: Record<string, unknown>;
  bodyMarkdown: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Parse a markdown report into a typed EquityReport, or null if it is not a
 * hermes india-equity-research report. Resilient to partial/streaming reports:
 * missing sections come back as empty collections, not throws.
 */
export function parseEquityReport(markdown: string): EquityReport | null {
  if (!markdown) return null;
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return null;

  let front: Record<string, unknown>;
  try {
    front = asRecord(parseYaml(match[1]));
  } catch {
    return null;
  }

  if (front.hermes_report !== REPORT_MARKER) return null;

  const body = markdown.slice(match[0].length);
  const sectorHeatmapRaw = asRecord(front.sector_heatmap);
  const dcfRaw = asRecord(front.dcf_sensitivity);

  return {
    ticker: String(front.ticker ?? ""),
    exchange: String(front.exchange ?? "NSE"),
    company: front.company ? String(front.company) : undefined,
    sector: front.sector ? String(front.sector) : undefined,
    asOf: front.as_of ? String(front.as_of) : undefined,
    price: typeof front.price === "number" ? front.price : undefined,
    currency: String(front.currency ?? "INR"),
    rating: String(front.rating ?? "HOLD"),
    confidence: String(front.confidence ?? "medium"),
    scores: asRecord(front.scores) as Partial<EquityScores>,
    valuation: asRecord(front.valuation),
    riskMatrix: asRecord(front.risk_matrix) as Record<string, RiskCell>,
    priceSeries: asArray<PriceBar>(front.price_series),
    peers: asArray<PeerRow>(front.peers),
    sectorHeatmap: Object.keys(sectorHeatmapRaw).length
      ? (sectorHeatmapRaw as unknown as SectorHeatmap)
      : null,
    dcfSensitivity: Object.keys(dcfRaw).length
      ? (dcfRaw as unknown as DcfSensitivity)
      : null,
    evidenceRefs: asArray<EvidenceRef>(front.evidence_refs),
    dataGaps: asArray<string>(front.data_gaps),
    provenance: asRecord(front.provenance),
    bodyMarkdown: body,
  };
}

/** Convenience: is this markdown an india-equity report? */
export function isEquityReport(markdown: string): boolean {
  return parseEquityReport(markdown) !== null;
}
