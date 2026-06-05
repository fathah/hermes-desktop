// DayTimeline.tsx — the time-sorted list of entries for the selected day, plus
// a "this day in previous years" throwback. Clicking an entry opens it in the
// document editor.
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { prettyDate, shiftYears } from "../lib/journalDates";
import type { JournalEntry } from "./useJournalEntries";

interface Props {
  date: string;
  byDate: Map<string, JournalEntry[]>;
  onNewEntry: () => void;
}

export function DayTimeline({ date, byDate, onNewEntry }: Props) {
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);

  const open = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };

  const entries = [...(byDate.get(date) ?? [])].sort((a, b) =>
    (a.time || "").localeCompare(b.time || ""),
  );

  // Throwback: same calendar day, one or more years back.
  const throwbacks: { year: number; entries: JournalEntry[] }[] = [];
  for (let back = 1; back <= 5; back++) {
    const key = shiftYears(date, -back);
    if (!key) continue;
    const hits = byDate.get(key);
    if (hits && hits.length) {
      throwbacks.push({ year: Number(key.slice(0, 4)), entries: hits });
    }
  }

  return (
    <div className="jr-day">
      <div className="jr-day-head">
        <span className="jr-day-title">{prettyDate(date)}</span>
        <span className="jr-spacer" />
        <button className="jr-btn primary" onClick={onNewEntry}>
          <Icon name="plus" size={14} /> New entry
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="jr-empty">
          No entries on this day yet. Start one with “New entry”.
        </div>
      ) : (
        entries.map((e) => (
          <div key={e.id} className="jr-entry" onClick={() => open(e.id)}>
            <span className="jr-entry-time">{e.time || "—"}</span>
            <div className="jr-entry-body">
              <div className="jr-entry-title">
                <span aria-hidden>{e.mood || e.icon}</span>
                {e.title}
              </div>
            </div>
          </div>
        ))
      )}

      {throwbacks.length > 0 && (
        <div className="jr-throwback">
          On this day:{" "}
          {throwbacks.map((tb, i) => (
            <span key={tb.year}>
              {i > 0 && " · "}
              <a onClick={() => open(tb.entries[0].id)}>
                {tb.year} ({tb.entries.length})
              </a>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
