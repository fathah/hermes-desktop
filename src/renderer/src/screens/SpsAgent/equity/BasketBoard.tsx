// Basket ranking board — the cross-name decision surface. Renders the ranked
// rows from a parsed BasketBoard as a sortable table: relative value, dividend
// yield, dividend-floor cushion, risk, commodity tilt, and an explicit
// Add / Trim / Hold call with the driving reason. Pure SPS tokens, no deps.

import React, { useMemo, useState } from "react";
import type {
  BasketBoard as BasketBoardData,
  BasketRow,
} from "./basketContract";

type SortKey = "rank" | "upsidePct" | "divYield" | "floorCushion" | "composite";

const NUMERIC_COLS: Array<{ key: SortKey; label: string; suffix?: string }> = [
  { key: "upsidePct", label: "Upside", suffix: "%" },
  { key: "divYield", label: "Div yield", suffix: "%" },
  { key: "floorCushion", label: "Floor cushion", suffix: "%" },
  { key: "composite", label: "Composite" },
];

function ratingClass(rating?: string): string {
  return `eq-rating eq-rating-${String(rating ?? "hold").toLowerCase()}`;
}

function suggestionClass(action?: string): string {
  const a = String(action ?? "").toLowerCase();
  if (a === "add") return "eq-basket-call eq-basket-add";
  if (a === "trim") return "eq-basket-call eq-basket-trim";
  return "eq-basket-call eq-basket-hold";
}

function fmt(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined) return "—";
  const rounded = Math.round(value * 10) / 10;
  const sign = suffix === "%" && rounded > 0 ? "+" : "";
  return `${sign}${rounded}${suffix}`;
}

function sortValue(row: BasketRow, key: SortKey): number {
  const raw = row[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  // rank ascending should keep undefined last; metrics descending push nulls last.
  return key === "rank" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

export function BasketBoard({
  board,
  onSave,
  onDiscard,
  saving,
}: {
  board: BasketBoardData;
  onSave?: () => void;
  onDiscard?: () => void;
  saving?: boolean;
}): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [desc, setDesc] = useState(false);

  const rows = useMemo(() => {
    const copy = [...board.rows];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      return desc ? bv - av : av - bv;
    });
    return copy;
  }, [board.rows, sortKey, desc]);

  const toggleSort = (key: SortKey): void => {
    if (key === sortKey) {
      setDesc((d) => !d);
    } else {
      setSortKey(key);
      // metrics read best high→low; rank reads best low→high
      setDesc(key !== "rank");
    }
  };

  const { summary } = board;

  return (
    <div className="eq-basket">
      <div className="eq-basket-header">
        <div>
          <h2 className="eq-basket-title">{board.name}</h2>
          <div className="eq-basket-sub">
            {summary.n} names · top pick{" "}
            <strong>{summary.topPick ?? "—"}</strong> · {summary.add.length} add
            · {summary.trim.length} trim
          </div>
        </div>
        {(onSave || onDiscard) && (
          <div className="eq-basket-actions">
            {onSave && (
              <button
                className="eq-save-btn"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save basket"}
              </button>
            )}
            {onDiscard && (
              <button className="eq-save-btn" onClick={onDiscard}>
                Discard
              </button>
            )}
          </div>
        )}
      </div>

      <div className="eq-chart-scroll">
        <table className="eq-basket-table">
          <thead>
            <tr>
              <th
                className="eq-basket-sortable"
                onClick={() => toggleSort("rank")}
              >
                #{sortKey === "rank" ? (desc ? " ↓" : " ↑") : ""}
              </th>
              <th>Ticker</th>
              <th>Rating</th>
              {NUMERIC_COLS.map((col) => (
                <th
                  key={col.key}
                  className="eq-basket-sortable eq-basket-num"
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key ? (desc ? " ↓" : " ↑") : ""}
                </th>
              ))}
              <th>Risk</th>
              <th>Commodity</th>
              <th>Call</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ticker}>
                <td className="eq-basket-num">{row.rank ?? "—"}</td>
                <td className="eq-basket-ticker">{row.ticker}</td>
                <td>
                  <span className={ratingClass(row.rating)}>
                    {row.rating ?? "—"}
                  </span>
                </td>
                <td className="eq-basket-num">{fmt(row.upsidePct, "%")}</td>
                <td className="eq-basket-num">{fmt(row.divYield, "%")}</td>
                <td className="eq-basket-num">{fmt(row.floorCushion, "%")}</td>
                <td className="eq-basket-num">{fmt(row.composite)}</td>
                <td className="eq-basket-risk">
                  {row.riskWorstSeverity ?? fmt(row.riskScore)}
                </td>
                <td>{row.commodity ?? "—"}</td>
                <td>
                  <span className={suggestionClass(row.suggestion)}>
                    {row.suggestion ?? "—"}
                  </span>
                </td>
                <td className="eq-basket-why">{row.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {board.dataGaps.length > 0 && (
        <details className="eq-basket-gaps">
          <summary>{board.dataGaps.length} data gaps</summary>
          <ul>
            {board.dataGaps.map((gap, i) => (
              <li key={i}>{gap}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
