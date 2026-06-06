// Pure helpers for storing an equity report as a row in the "equity-research"
// folder-backed query DB. No React / no IPC — fully unit-tested.
//
// A row file = row-property frontmatter + a 3-region body:
//   <!-- sps:equity:report --> … generated report markdown … <!-- /… -->  (replaced on refresh)
//   ## Run history    — append-only dated table (thesis-evolution timeline)
//   ## My notes       — human-owned, never overwritten
// This separation is what makes "update whenever I feel like" safe.

import type { EquityReport } from "./reportContract";
import type { RowProps } from "../editor/rowMarkdown";

export const DB_FOLDER = "equity-research";

const REPORT_START = "<!-- sps:equity:report -->";
const REPORT_END = "<!-- /sps:equity:report -->";
const RUN_HISTORY_H = "## Run history";
const NOTES_H = "## My notes";
const NOTES_PLACEHOLDER =
  "_Your notes, theses, and addenda — never overwritten by a refresh._";

// ---- identity -------------------------------------------------------------

export function tickerSlug(ticker: string): string {
  const slug = (ticker || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

// ---- auto-tags (controlled facets; user tags live separately) -------------

function sectorFacet(sector: string | undefined): string | null {
  if (!sector) return null;
  const first = sector.toLowerCase().match(/[a-z]+/)?.[0];
  return first ? `sector:${first}` : null;
}

export function deriveAutoTags(report: EquityReport): string[] {
  const tags = new Set<string>();
  const sf = sectorFacet(report.sector);
  if (sf) tags.add(sf);
  if (report.rating) tags.add(`rating:${report.rating.toLowerCase()}`);
  const sector = (report.sector || "").toLowerCase();
  if (/psu|government|govt/.test(sector)) tags.add("PSU");
  if (/coal|mining|mineral/.test(sector)) tags.add("commodity:coal");
  if (/oil|gas|petroleum|upstream/.test(sector)) tags.add("commodity:crude");
  if (/power|energy|electric/.test(sector)) tags.add("theme:power");
  return [...tags];
}

// ---- row properties (projection of the report, for table/filter/sort) -----

function num(...candidates: unknown[]): number | null {
  for (const c of candidates)
    if (typeof c === "number" && !Number.isNaN(c)) return c;
  return null;
}

export function deriveRowProps(report: EquityReport, now: string): RowProps {
  const val = report.valuation || {};
  return {
    title: `${report.ticker} — Equity Research`,
    ticker: report.ticker,
    sector: report.sector ?? "",
    rating: report.rating,
    confidence: report.confidence,
    composite: num(report.scores?.composite),
    intrinsic: num(val.intrinsic_per_share, val.intrinsic_inr, val.intrinsic),
    price: num(report.price),
    upside_pct: num(val.upside, val.upside_pct),
    as_of: report.asOf ?? "",
    run_id:
      typeof report.provenance?.run_id === "string"
        ? report.provenance.run_id
        : "",
    tags: deriveAutoTags(report),
    updated: now,
  };
}

/** Regenerate machine fields but preserve the human-owned ones. */
export function mergeRowProps(
  oldProps: RowProps,
  freshProps: RowProps,
): RowProps {
  const userTags = Array.isArray(oldProps.user_tags) ? oldProps.user_tags : [];
  return { ...freshProps, user_tags: userTags };
}

// ---- run history ----------------------------------------------------------

export interface RunHistoryRow {
  date: string;
  rating: string;
  composite: number | null;
  intrinsic: number | null;
  note: string;
}

export function runRowFromReport(
  report: EquityReport,
  date: string,
  note = "",
): RunHistoryRow {
  const val = report.valuation || {};
  return {
    date,
    rating: report.rating,
    composite: num(report.scores?.composite),
    intrinsic: num(val.intrinsic_per_share, val.intrinsic_inr, val.intrinsic),
    note,
  };
}

export function parseRunHistory(section: string): RunHistoryRow[] {
  const rows: RunHistoryRow[] = [];
  for (const line of section.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 5) continue;
    if (/^date$/i.test(cells[0]) || /^-+$/.test(cells[0])) continue; // header / separator
    const composite =
      cells[2] === "—" || cells[2] === "" ? null : Number(cells[2]);
    const intrinsic =
      cells[3] === "—" || cells[3] === "" ? null : Number(cells[3]);
    rows.push({
      date: cells[0],
      rating: cells[1],
      composite: Number.isNaN(composite as number) ? null : composite,
      intrinsic: Number.isNaN(intrinsic as number) ? null : intrinsic,
      note: cells[4],
    });
  }
  return rows;
}

function renderRunHistory(rows: RunHistoryRow[]): string {
  const head =
    "| Date | Rating | Composite | Intrinsic | Note |\n|---|---|---|---|---|";
  const body = rows
    .map(
      (r) =>
        `| ${r.date} | ${r.rating} | ${r.composite ?? "—"} | ${r.intrinsic ?? "—"} | ${r.note} |`,
    )
    .join("\n");
  return `${head}\n${body}`;
}

// ---- body regions ---------------------------------------------------------

export interface BodyRegions {
  report: string;
  runHistory: RunHistoryRow[];
  notes: string;
}

export function splitRegions(body: string): BodyRegions {
  let report = "";
  const start = body.indexOf(REPORT_START);
  const end = body.indexOf(REPORT_END);
  if (start !== -1 && end !== -1 && end > start) {
    report = body.slice(start + REPORT_START.length, end).trim();
  }

  const rhIdx = body.indexOf(RUN_HISTORY_H);
  const notesIdx = body.indexOf(NOTES_H);
  let runSection = "";
  if (rhIdx !== -1) {
    const stop = notesIdx !== -1 && notesIdx > rhIdx ? notesIdx : body.length;
    runSection = body.slice(rhIdx + RUN_HISTORY_H.length, stop);
  }
  const notes =
    notesIdx !== -1 ? body.slice(notesIdx + NOTES_H.length).trim() : "";

  return { report, runHistory: parseRunHistory(runSection), notes };
}

/** The generated report markdown the renderer should feed to parseEquityReport. */
export function extractGeneratedReport(body: string): string {
  return splitRegions(body).report;
}

export function buildRowBody(regions: BodyRegions): string {
  const notes = regions.notes.trim() || NOTES_PLACEHOLDER;
  return [
    REPORT_START,
    regions.report.trim(),
    REPORT_END,
    "",
    RUN_HISTORY_H,
    "",
    renderRunHistory(regions.runHistory),
    "",
    NOTES_H,
    "",
    notes,
    "",
  ].join("\n");
}

// ---- the merge (refresh-in-place) -----------------------------------------

export interface MergedRow {
  props: RowProps;
  body: string;
}

/**
 * Produce the row (props + body) for a fresh report, merging into an existing
 * row when present: the report region is replaced, run history is appended, and
 * the human notes + user_tags are preserved verbatim.
 */
export function mergeRow(
  existing: { props: RowProps; body: string } | null,
  report: EquityReport,
  reportMd: string,
  now: string,
  note = "",
): MergedRow {
  const fresh = deriveRowProps(report, now);
  const date = (now || "").slice(0, 10);
  const runRow = runRowFromReport(
    report,
    date,
    note || (existing ? "refresh" : "initial"),
  );

  if (!existing) {
    return {
      props: { ...fresh, user_tags: [] },
      body: buildRowBody({ report: reportMd, runHistory: [runRow], notes: "" }),
    };
  }

  const prior = splitRegions(existing.body);
  // Skip a no-op history row (same rating/score/intrinsic as the last entry) so
  // repeated/duplicate saves don't spam the timeline; only real changes append.
  const last = prior.runHistory[prior.runHistory.length - 1];
  const unchanged =
    last &&
    last.rating === runRow.rating &&
    last.composite === runRow.composite &&
    last.intrinsic === runRow.intrinsic;
  const runHistory = unchanged
    ? prior.runHistory
    : [...prior.runHistory, runRow];
  return {
    props: mergeRowProps(existing.props, fresh),
    body: buildRowBody({ report: reportMd, runHistory, notes: prior.notes }),
  };
}
