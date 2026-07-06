// Parser for the thesis-calibration scorecard contract (Track A ↔ Track B).
//
// `calibration.py` emits markdown under `hermes_report: india-equity-calibration`:
// JSON frontmatter (hit-rate buckets + per-call detail) + a readable body. Mirror
// reportContract.ts: parse with `yaml`, expose a typed camelCased view, null for
// non-scorecard markdown.

import { parse as parseYaml } from "yaml";
import { splitSpsFrontmatter } from "../../../../../shared/sps-frontmatter";

const MARKER = "india-equity-calibration";

export interface HitBucket {
  hit: number;
  miss: number;
  flat: number;
  n: number;
  hit_rate: number | null;
}

export interface CalibratedCall {
  ticker: string;
  date?: string;
  rating?: string;
  confidence?: string;
  entry?: number;
  exit?: number;
  returnPct?: number;
  outcome: string;
}

export interface CalibrationScorecard {
  horizonDays: number;
  bandPct: number;
  nScored: number;
  nUnscored: number;
  overall: HitBucket;
  byRating: Record<string, HitBucket>;
  byConfidence: Record<string, HitBucket>;
  calls: CalibratedCall[];
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

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function bucket(raw: unknown): HitBucket {
  const r = asRecord(raw);
  return {
    hit: num(r.hit),
    miss: num(r.miss),
    flat: num(r.flat),
    n: num(r.n),
    hit_rate:
      typeof r.hit_rate === "number" && Number.isFinite(r.hit_rate)
        ? r.hit_rate
        : null,
  };
}

function buckets(raw: unknown): Record<string, HitBucket> {
  const out: Record<string, HitBucket> = {};
  for (const [k, v] of Object.entries(asRecord(raw))) out[k] = bucket(v);
  return out;
}

function call(raw: unknown): CalibratedCall {
  const r = asRecord(raw);
  return {
    ticker: String(r.ticker ?? ""),
    date: r.date ? String(r.date) : undefined,
    rating: r.rating ? String(r.rating) : undefined,
    confidence: r.confidence ? String(r.confidence) : undefined,
    entry: typeof r.entry === "number" ? r.entry : undefined,
    exit: typeof r.exit === "number" ? r.exit : undefined,
    returnPct: typeof r.return_pct === "number" ? r.return_pct : undefined,
    outcome: String(r.outcome ?? ""),
  };
}

export function parseCalibrationScorecard(
  markdown: string,
): CalibrationScorecard | null {
  if (!markdown) return null;
  const { frontmatter, body } = splitSpsFrontmatter(markdown);
  if (frontmatter === null) return null;
  let front: Record<string, unknown>;
  try {
    front = asRecord(parseYaml(frontmatter));
  } catch {
    return null;
  }
  if (front.hermes_report !== MARKER) return null;

  return {
    horizonDays: num(front.horizon_days),
    bandPct: num(front.band_pct),
    nScored: num(front.n_scored),
    nUnscored: num(front.n_unscored),
    overall: bucket(front.overall),
    byRating: buckets(front.by_rating),
    byConfidence: buckets(front.by_confidence),
    calls: asArray<unknown>(front.calls).map(call),
    bodyMarkdown: body,
  };
}

export function isCalibrationScorecard(markdown: string): boolean {
  return parseCalibrationScorecard(markdown) !== null;
}
