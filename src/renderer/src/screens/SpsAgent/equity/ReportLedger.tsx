// The research ledger: a searchable, filterable table of every saved report.
// Facets (rating/tag) drive the structured note-index query; the search box runs
// FTS5 over report bodies (scoped to the equity-research folder).
import React, { useEffect, useState } from "react";
import {
  useVaultQuery,
  useVaultSearch,
  type VaultFilter,
  type VaultRow,
} from "../hooks/useNoteIndex";
import { DB_FOLDER } from "./reportRow";
import { pageIdFromPath } from "../lib/pageId";

// The note index ingests vault writes via a live watcher — but rows written
// while the app was closed (cron/headless refreshes) are missed. Rebuild once
// per session when the ledger first opens so it always reflects disk.
let rebuiltThisSession = false;

const RATINGS = ["", "BUY", "ACCUMULATE", "HOLD", "REDUCE", "AVOID"];

function tagsOf(row: VaultRow): string[] {
  const a = Array.isArray(row.props.tags) ? row.props.tags.map(String) : [];
  const u = Array.isArray(row.props.user_tags)
    ? row.props.user_tags.map(String)
    : [];
  return [...a, ...u];
}

export function ReportLedger({
  onOpen,
  reloadKey,
}: {
  onOpen: (slug: string) => void;
  reloadKey: number;
}): React.JSX.Element {
  const [rating, setRating] = useState("");
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");

  const filters: VaultFilter[] = [];
  if (rating) filters.push({ prop: "rating", op: "eq", value: rating });
  if (tag.trim())
    filters.push({
      prop: "tags",
      op: "contains",
      value: tag.trim().replace(/^#/, ""),
    });

  const { rows, refetch } = useVaultQuery(DB_FOLDER, filters, {
    prop: "updated",
    dir: "desc",
  });
  useEffect(() => {
    refetch();
  }, [reloadKey, refetch]);

  // One reindex per session so cron/headless rows written while closed appear.
  useEffect(() => {
    if (rebuiltThisSession) return;
    rebuiltThisSession = true;
    const api = window.hermesAPI;
    if (!api?.spsIndexRebuild) return;
    void api.spsIndexRebuild().then(() => refetch());
  }, [refetch]);

  // FTS over report bodies; scope to our folder.
  const hits = useVaultSearch(query.trim());
  const scopedHits = hits.filter((h) => h.pageId.startsWith(`${DB_FOLDER}/`));
  const searching = query.trim().length > 0;

  return (
    <section className="eq-ledger">
      <div className="eq-ledger-bar">
        <input
          className="eq-search-input"
          value={query}
          placeholder="Search reports (full text)…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="eq-facet"
          value={rating}
          onChange={(e) => setRating(e.target.value)}
        >
          {RATINGS.map((r) => (
            <option key={r} value={r}>
              {r || "All ratings"}
            </option>
          ))}
        </select>
        <input
          className="eq-facet"
          value={tag}
          placeholder="filter #tag"
          onChange={(e) => setTag(e.target.value)}
        />
      </div>

      {searching ? (
        <ul className="eq-hits">
          {scopedHits.length === 0 && <li className="eq-muted">No matches.</li>}
          {scopedHits.map((h) => (
            <li
              key={h.pageId}
              className="eq-hit"
              onClick={() => onOpen(pageIdFromPath(h.pageId))}
            >
              <span className="eq-hit-title">{h.title}</span>
              <span className="eq-hit-snippet">{h.snippet}</span>
            </li>
          ))}
        </ul>
      ) : (
        <table className="eq-ledger-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Sector</th>
              <th>Rating</th>
              <th>Score</th>
              <th>Tags</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="eq-muted">
                  No saved reports yet — run one above.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.path}
                className="eq-ledger-row"
                onClick={() => onOpen(pageIdFromPath(r.path))}
              >
                <td>{String(r.props.ticker ?? pageIdFromPath(r.path))}</td>
                <td>{String(r.props.sector ?? "")}</td>
                <td>
                  <span
                    className={`eq-rating eq-rating-${String(r.props.rating ?? "").toLowerCase()}`}
                  >
                    {String(r.props.rating ?? "—")}
                  </span>
                </td>
                <td>
                  {r.props.composite == null ? "—" : String(r.props.composite)}
                </td>
                <td className="eq-ledger-tags">
                  {tagsOf(r)
                    .map((t) => `#${t}`)
                    .join(" ")}
                </td>
                <td>{String(r.props.as_of ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
