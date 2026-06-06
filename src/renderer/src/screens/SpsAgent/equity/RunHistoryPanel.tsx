// Surfaces the row's append-only run history (thesis-evolution timeline) and the
// human-owned notes, alongside the report. Both live in the row markdown; this
// just makes them visible at a glance instead of only on the vault page.
import React from "react";
import AgentMarkdown from "../../../components/AgentMarkdown";
import type { RunHistoryRow } from "./reportRow";

const PLACEHOLDER =
  "Your notes, theses, and addenda — never overwritten by a refresh.";

export function RunHistoryPanel({
  runHistory,
  notes,
}: {
  runHistory: RunHistoryRow[];
  notes: string;
}): React.JSX.Element | null {
  if (runHistory.length === 0 && !notes) return null;
  const cleanNotes = notes.trim();
  const hasNotes = cleanNotes && !cleanNotes.startsWith("_Your notes");

  return (
    <div className="eq-history">
      {runHistory.length > 0 && (
        <section className="eq-runlog">
          <h3>Run history</h3>
          <table className="eq-ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rating</th>
                <th>Score</th>
                <th>Intrinsic</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {runHistory.map((r, i) => (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td>
                    <span
                      className={`eq-rating eq-rating-${String(r.rating ?? "").toLowerCase()}`}
                    >
                      {r.rating || "—"}
                    </span>
                  </td>
                  <td>{r.composite ?? "—"}</td>
                  <td>{r.intrinsic ?? "—"}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section className="eq-notes">
        <h3>My notes</h3>
        {hasNotes ? (
          <AgentMarkdown>{cleanNotes}</AgentMarkdown>
        ) : (
          <p className="eq-muted">{PLACEHOLDER} Edit them on the vault page.</p>
        )}
      </section>
    </div>
  );
}
