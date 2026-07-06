// Parser for the basket ranking board contract (Track A ↔ Track B).
//
// The `india-equity-research` orchestrator, in basket mode, emits one markdown
// document under `hermes_report: india-equity-basket`: a JSON frontmatter block
// (valid YAML) carrying the ranked rows + summary, followed by a human-readable
// table. Mirrors reportContract.ts: parse with the `yaml` dep, expose a typed
// camelCased view, return null for non-basket markdown so callers fall back.

import { parse as parseYaml } from "yaml";
import { splitSpsFrontmatter } from "../../../../../shared/sps-frontmatter";

const BASKET_MARKER = "india-equity-basket";

export interface BasketRow {
  rank?: number;
  ticker: string;
  rating?: string;
  composite?: number | null;
  price?: number | null;
  intrinsic?: number | null;
  upsidePct?: number | null;
  dividendFloor?: number | null;
  floorCushion?: number | null;
  divYield?: number | null;
  riskScore?: number | null;
  riskWorstAxis?: string | null;
  riskWorstSeverity?: string | null;
  commodity?: string | null;
  suggestion?: string;
  reason?: string;
}

export interface BasketSummary {
  n: number;
  add: string[];
  trim: string[];
  hold: string[];
  topPick?: string | null;
}

export interface BasketBoard {
  basketId: string;
  name: string;
  asOf?: string;
  generatedAt?: string;
  rows: BasketRow[];
  summary: BasketSummary;
  dataGaps: string[];
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

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function parseRow(raw: unknown): BasketRow {
  const r = asRecord(raw);
  return {
    rank: num(r.rank) ?? undefined,
    ticker: String(r.ticker ?? ""),
    rating: str(r.rating),
    composite: num(r.composite),
    price: num(r.price),
    intrinsic: num(r.intrinsic),
    upsidePct: num(r.upside_pct),
    dividendFloor: num(r.dividend_floor),
    floorCushion: num(r.floor_cushion),
    divYield: num(r.div_yield),
    riskScore: num(r.risk_score),
    riskWorstAxis: str(r.risk_worst_axis) ?? null,
    riskWorstSeverity: str(r.risk_worst_severity) ?? null,
    commodity: str(r.commodity) ?? null,
    suggestion: str(r.suggestion),
    reason: str(r.reason),
  };
}

/**
 * Parse a markdown board into a typed BasketBoard, or null if it is not a
 * hermes india-equity-basket board. Resilient to partial/streaming output.
 */
export function parseBasketBoard(markdown: string): BasketBoard | null {
  if (!markdown) return null;
  const { frontmatter, body } = splitSpsFrontmatter(markdown);
  if (frontmatter === null) return null;

  let front: Record<string, unknown>;
  try {
    front = asRecord(parseYaml(frontmatter));
  } catch {
    return null;
  }
  if (front.hermes_report !== BASKET_MARKER) return null;

  const summaryRaw = asRecord(front.summary);
  const summary: BasketSummary = {
    n: num(summaryRaw.n) ?? 0,
    add: asArray<string>(summaryRaw.add),
    trim: asArray<string>(summaryRaw.trim),
    hold: asArray<string>(summaryRaw.hold),
    topPick: str(summaryRaw.top_pick) ?? null,
  };

  return {
    basketId: String(front.basket_id ?? ""),
    name: String(front.name ?? front.basket_id ?? "Basket"),
    asOf: str(front.as_of),
    generatedAt: str(front.generated_at),
    rows: asArray<unknown>(front.rows).map(parseRow),
    summary,
    dataGaps: asArray<string>(front.data_gaps),
    bodyMarkdown: body,
  };
}

/** Convenience: is this markdown an india-equity basket board? */
export function isBasketBoard(markdown: string): boolean {
  return parseBasketBoard(markdown) !== null;
}
