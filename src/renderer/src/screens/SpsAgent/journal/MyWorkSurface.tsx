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
import {
  QuickActions,
  Glance,
  PinnedNotes,
  AgentStatus,
} from "../cockpit/CockpitSurface";

export function MyWorkSurface() {
  const selected = useStore((s) => s.journalDate);
  const setJournalDate = useStore((s) => s.setJournalDate);
  const createJournalEntry = useStore((s) => s.createJournalEntry);

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
      <div className="work-unified-container">
        {/* Left pane: Journal / Timeline */}
        <div className="work-unified-left">
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

        {/* Right pane: Cockpit widgets */}
        <div className="work-unified-right">
          <div className="work-right-section-title">
            <Icon name="board" size={16} />
            <span>At a Glance</span>
          </div>
          <div className="work-widget-card">
            <Glance />
          </div>

          <div className="work-right-section-title">
            <Icon name="wand" size={16} />
            <span>Quick Actions</span>
          </div>
          <div className="work-widget-card">
            <QuickActions />
          </div>

          <div className="work-right-section-title">
            <Icon name="code" size={16} />
            <span>Assistant Status</span>
          </div>
          <div className="work-widget-card">
            <AgentStatus />
          </div>

          <div className="work-right-section-title">
            <Icon name="comment" size={16} />
            <span>Pinned Notes</span>
          </div>
          <div className="work-widget-card">
            <PinnedNotes />
          </div>
        </div>
      </div>
    </div>
  );
}
