// Calibration view — were my calls right? Renders the hit-rate scorecard:
// overall + by-rating + by-confidence badges (each with n + horizon so a thin
// sample never reads as precise), plus the per-call return/outcome table. Save
// persists the scorecard as a vault row (reusing spsExportRow); Discard leaves
// it ephemeral.

import React from "react";
import type { CalibrationScorecard, HitBucket } from "./calibrationContract";

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function Badge({
  label,
  bucket,
}: {
  label: string;
  bucket: HitBucket;
}): React.JSX.Element {
  return (
    <div className="eq-cal-badge">
      <div className="eq-cal-badge-label">{label}</div>
      <div className="eq-cal-badge-rate">{pct(bucket.hit_rate)}</div>
      <div className="eq-cal-badge-sub">
        n={bucket.n} · {bucket.hit}H / {bucket.miss}M / {bucket.flat}F
      </div>
    </div>
  );
}

function outcomeClass(outcome: string): string {
  if (outcome === "hit") return "eq-cal-hit";
  if (outcome === "miss") return "eq-cal-miss";
  return "eq-cal-flat";
}

export function CalibrationView({
  scorecard,
  onSave,
  onDiscard,
  saving,
}: {
  scorecard: CalibrationScorecard;
  onSave?: () => void;
  onDiscard?: () => void;
  saving?: boolean;
}): React.JSX.Element {
  const { overall, byRating, byConfidence } = scorecard;

  return (
    <div className="eq-cal">
      <div className="eq-basket-header">
        <div>
          <h2 className="eq-basket-title">Thesis calibration</h2>
          <div className="eq-basket-sub">
            {scorecard.nScored} scored · {scorecard.horizonDays}d horizon · ±
            {scorecard.bandPct}% band · {scorecard.nUnscored} not yet scorable
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
                {saving ? "Saving…" : "Save scorecard"}
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

      <div className="eq-cal-badges">
        <Badge label="Overall" bucket={overall} />
        {Object.entries(byRating).map(([rating, b]) => (
          <Badge key={`r-${rating}`} label={rating} bucket={b} />
        ))}
      </div>

      <h3 className="eq-cal-h3">
        By confidence — does high-confidence outperform?
      </h3>
      <div className="eq-cal-badges">
        {Object.entries(byConfidence).map(([conf, b]) => (
          <Badge key={`c-${conf}`} label={conf} bucket={b} />
        ))}
      </div>

      {scorecard.calls.length > 0 && (
        <div className="eq-chart-scroll">
          <table className="eq-basket-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ticker</th>
                <th>Rating</th>
                <th>Confidence</th>
                <th className="eq-basket-num">Entry</th>
                <th className="eq-basket-num">Exit</th>
                <th className="eq-basket-num">Return</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {scorecard.calls.map((c, i) => (
                <tr key={`${c.ticker}-${c.date}-${i}`}>
                  <td>{c.date ?? "—"}</td>
                  <td className="eq-basket-ticker">{c.ticker}</td>
                  <td>{c.rating ?? "—"}</td>
                  <td>{c.confidence ?? "—"}</td>
                  <td className="eq-basket-num">{c.entry ?? "—"}</td>
                  <td className="eq-basket-num">{c.exit ?? "—"}</td>
                  <td className="eq-basket-num">
                    {c.returnPct === undefined ? "—" : `${c.returnPct}%`}
                  </td>
                  <td>
                    <span className={`eq-cal-tag ${outcomeClass(c.outcome)}`}>
                      {c.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
