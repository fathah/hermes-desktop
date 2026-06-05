// JournalCalendar.tsx — the month grid for the journal surface. Reuses the
// existing .cal* design-system classes (same fonts/colours as the database
// calendar view); each day cell is clickable and shows a count of entries.
import { monthGrid, parseISO } from "../lib/journalDates";
import type { JournalEntry } from "./useJournalEntries";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  /** Any "YYYY-MM-DD" key in the month to render. */
  monthAnchor: string;
  /** The currently selected day (highlighted). */
  selected: string;
  /** Today's key, for the today ring. */
  today: string;
  /** Entries grouped by date key. */
  byDate: Map<string, JournalEntry[]>;
  onSelectDay: (date: string) => void;
}

export function JournalCalendar({
  monthAnchor,
  selected,
  today,
  byDate,
  onSelectDay,
}: Props) {
  const parts = parseISO(monthAnchor) ?? parseISO(today);
  if (!parts) return null;
  const cells = monthGrid(parts.year, parts.month);

  return (
    <div className="cal">
      <div className="cal-head">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((iso, i) => {
          if (iso == null) {
            return <div key={`out-${i}`} className="cal-day out" />;
          }
          const dayNum = Number(iso.slice(8, 10));
          const entries = byDate.get(iso) ?? [];
          const cls = [
            "cal-day",
            iso === today ? "today" : "",
            iso === selected ? "sel" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={iso} className={cls} onClick={() => onSelectDay(iso)}>
              <div className="cal-dn">{dayNum}</div>
              {entries.length > 0 && (
                <span className="cal-count">
                  <span className="cal-dot" />
                  {entries.length}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
