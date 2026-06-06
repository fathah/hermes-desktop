// Persist an equity report as a ROW in the "equity-research" folder-backed query
// DB (vault/equity-research/<ticker>.md), refreshing in place: replace the
// generated report region, append run history, preserve the user's notes +
// user_tags. rowId = ticker slug ⇒ one canonical row per name (no duplicates).

import { useStore } from "../store";
import {
  rowToMarkdown,
  rowFromMarkdown,
  type RowProps,
} from "../editor/rowMarkdown";
import { pageToMarkdown } from "../editor/pageMarkdown";
import { uid } from "../lib/ids";
import type { Block } from "../types";
import { parseEquityReport, type EquityReport } from "./reportContract";
import {
  DB_FOLDER,
  tickerSlug,
  mergeRow,
  extractGeneratedReport,
  splitRegions,
  type RunHistoryRow,
} from "./reportRow";

export { DB_FOLDER } from "./reportRow";

const PROFILE = "default";

/** Find the existing "Equity Research" page (the one hosting the DB block). */
function findEquityDbPage(): string | null {
  const { docs } = useStore.getState();
  for (const [pid, blocks] of Object.entries(docs)) {
    if (blocks.some((b) => b.type === "database" && b.source === DB_FOLDER))
      return pid;
  }
  return null;
}

/** Ensure the "Equity Research" DB page exists (idempotent). Returns its pageId. */
export async function ensureEquityDbPage(): Promise<string> {
  const existing = findEquityDbPage();
  if (existing) return existing;

  const heading: Block = { id: uid("b"), type: "h1", text: "Equity Research" };
  const dbBlock: Block = {
    id: uid("b"),
    type: "database",
    text: "",
    source: DB_FOLDER,
    view: "table",
    cols: [
      { id: "ticker", name: "Ticker" },
      { id: "sector", name: "Sector" },
      { id: "rating", name: "Rating" },
      { id: "composite", name: "Score" },
      { id: "tags", name: "Tags" },
      { id: "as_of", name: "As of" },
    ],
  };
  const info = { icon: "📈", title: "Equity Research" };
  const blocks = [heading, dbBlock];
  const pageId = useStore.getState().makePage(info, blocks, null);
  // Mirror to the vault so the page (and its DB block) survive a blob-mode reload.
  const md = pageToMarkdown(
    { title: "Equity Research", icon: "📈", cover: null },
    blocks,
  );
  await window.hermesAPI.spsExportPage(pageId, md, PROFILE);
  return pageId;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * Save (or refresh) a report as the canonical row for its ticker. Returns the
 * host page id and the row id. `reportMd` is the full orchestrator output
 * (its own contract frontmatter + body) — it becomes the row's generated region.
 */
export async function landReportToDb(
  report: EquityReport,
  reportMd: string,
): Promise<{ pageId: string; rowId: string }> {
  const pageId = await ensureEquityDbPage();
  const slug = tickerSlug(report.ticker);
  const api = window.hermesAPI;

  // Read the existing row body (if any) so the merge can preserve notes/history.
  let existing: { props: RowProps; body: string } | null = null;
  const existingMd = api.spsReadRow
    ? await api.spsReadRow(DB_FOLDER, slug, PROFILE)
    : null;
  if (existingMd) existing = rowFromMarkdown(existingMd);

  const merged = mergeRow(existing, report, reportMd, nowIso());
  await api.spsExportRow(
    DB_FOLDER,
    slug,
    rowToMarkdown(merged.props, merged.body),
    PROFILE,
  );

  useStore.getState().selectPage(pageId);
  return { pageId, rowId: slug };
}

export interface OpenedRow {
  report: EquityReport | null;
  autoTags: string[];
  userTags: string[];
  runHistory: RunHistoryRow[];
  notes: string;
  updated: string;
}

/** Read a saved row by ticker slug and parse its report + tags + run history + notes. */
export async function openRow(slug: string): Promise<OpenedRow | null> {
  const api = window.hermesAPI;
  const md = api.spsReadRow
    ? await api.spsReadRow(DB_FOLDER, slug, PROFILE)
    : null;
  if (!md) return null;
  const { props, body } = rowFromMarkdown(md);
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : [];
  const regions = splitRegions(body);
  return {
    report: parseEquityReport(regions.report || extractGeneratedReport(body)),
    autoTags: asStrings(props.tags),
    userTags: asStrings(props.user_tags),
    runHistory: regions.runHistory,
    notes: regions.notes,
    updated: typeof props.updated === "string" ? props.updated : "",
  };
}

/** Update a row's human-owned tags in place, preserving everything else. */
export async function updateUserTags(
  slug: string,
  userTags: string[],
): Promise<void> {
  const api = window.hermesAPI;
  const md = api.spsReadRow
    ? await api.spsReadRow(DB_FOLDER, slug, PROFILE)
    : null;
  if (!md) return;
  const { props, body } = rowFromMarkdown(md);
  props.user_tags = userTags;
  await api.spsExportRow(DB_FOLDER, slug, rowToMarkdown(props, body), PROFILE);
}
