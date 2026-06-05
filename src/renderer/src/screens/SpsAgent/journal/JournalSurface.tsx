// JournalSurface.tsx — the calendar/diary home. A month grid on top, the
// selected day's timeline below. "New entry" creates a journal page and drops
// the user straight into the block editor (where they add text + media).
import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { JournalCalendar } from "./JournalCalendar";
import { DayTimeline } from "./DayTimeline";
import { useJournalEntries, groupByDate } from "./useJournalEntries";
import {
  addMonths,
  isoFromDate,
  monthLabel,
  parseISO,
} from "../lib/journalDates";

export function JournalSurface() {
  const selected = useStore((s) => s.journalDate);
  const setJournalDate = useStore((s) => s.setJournalDate);
  const createJournalEntry = useStore((s) => s.createJournalEntry);

  // The month the grid shows. Independent of the selected day so you can browse
  // months without losing your place; defaults to the selected day's month.
  const [monthAnchor, setMonthAnchor] = useState(selected);

  const entries = useJournalEntries();
  const byDate = groupByDate(entries);
  const today = isoFromDate(new Date());

  const parts = parseISO(monthAnchor) ?? parseISO(today)!;
  const goToday = (): void => {
    setMonthAnchor(today);
    setJournalDate(today);
  };

  return (
    <div className="doc-scroll scroll">
      <div className="jr">
        <div className="jr-head">
          <span className="jr-title">
            {monthLabel(parts.year, parts.month)}
          </span>
          <span className="jr-spacer" />
          <button
            className="jr-icon-btn"
            title="Previous month"
            onClick={() => setMonthAnchor(addMonths(monthAnchor, -1))}
          >
            <Icon
              name="chevR"
              size={15}
              style={{ transform: "rotate(180deg)" }}
            />
          </button>
          <button className="jr-btn" onClick={goToday}>
            Today
          </button>
          <button
            className="jr-icon-btn"
            title="Next month"
            onClick={() => setMonthAnchor(addMonths(monthAnchor, 1))}
          >
            <Icon name="chevR" size={15} />
          </button>
          <button
            className="jr-btn primary"
            onClick={() => createJournalEntry(selected)}
          >
            <Icon name="plus" size={14} /> New entry
          </button>
        </div>

        <JournalCalendar
          monthAnchor={monthAnchor}
          selected={selected}
          today={today}
          byDate={byDate}
          onSelectDay={setJournalDate}
        />

        <DayTimeline
          date={selected}
          byDate={byDate}
          onNewEntry={() => createJournalEntry(selected)}
        />
      </div>
    </div>
  );
}
