// DayTimeline.tsx — the time-sorted list of entries for the selected day, plus
// a "this day in previous years" throwback. Clicking an entry opens it in the
// document editor.
import { useState, useEffect } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { prettyDate, shiftYears } from "../lib/journalDates";
import type { JournalEntry } from "./useJournalEntries";
import type { KanbanTask } from "../../../../../shared/kanban";

const MOODS = ["😄", "🙂", "😐", "😔", "😣", "😡", "🥱", "❤️"];

interface Props {
  date: string;
  byDate: Map<string, JournalEntry[]>;
  onNewEntry: () => void;
}

interface TimelineItem {
  type: "journal" | "task";
  id: string;
  time: string;
  // journal properties
  title: string;
  mood?: string;
  icon?: string;
  // task properties
  task?: KanbanTask;
}

function priorityLabel(p: number): string {
  if (p >= 10) return "P0";
  if (p >= 5) return "P1";
  if (p > 0) return "P2";
  return "";
}

function isoFromTimestamp(sec: number | null): string | null {
  if (!sec) return null;
  const d = new Date(sec * 1000);
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function hmFromTimestamp(sec: number): string {
  const d = new Date(sec * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DayTimeline({ date, byDate, onNewEntry }: Props) {
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const setEntryMood = useStore((s) => s.setEntryMood);
  const [moodFor, setMoodFor] = useState<string | null>(null);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Fetch tasks
  useEffect(() => {
    let active = true;
    if (window.hermesAPI?.kanbanListTasks) {
      window.hermesAPI
        .kanbanListTasks({ includeArchived: false })
        .then((res) => {
          if (active && res && res.success) {
            setTasks(res.data || []);
          }
        })
        .catch(console.error);
    }
    return () => {
      active = false;
    };
  }, [date]);

  const open = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };

  // 1. Process Journal Entries
  const journalItems: TimelineItem[] = (byDate.get(date) ?? []).map((e) => ({
    type: "journal",
    id: e.id,
    time: e.time || "—",
    title: e.title,
    mood: e.mood,
    icon: e.icon,
  }));

  // 2. Process Kanban Tasks
  const taskItems: TimelineItem[] = tasks
    .filter((t) => {
      const createdDate = isoFromTimestamp(t.created_at);
      const completedDate = isoFromTimestamp(t.completed_at);
      return createdDate === date || completedDate === date;
    })
    .map((t) => {
      const completedDate = isoFromTimestamp(t.completed_at);
      const isCompletedOnDay = completedDate === date;
      const displayTime =
        isCompletedOnDay && t.completed_at
          ? hmFromTimestamp(t.completed_at)
          : t.created_at
            ? hmFromTimestamp(t.created_at)
            : "—";

      return {
        type: "task",
        id: t.id,
        time: displayTime,
        title: t.title,
        task: t,
      };
    });

  // 3. Merge and Sort by time
  const allItems = [...journalItems, ...taskItems].sort((a, b) => {
    if (a.time === "—" && b.time !== "—") return 1;
    if (a.time !== "—" && b.time === "—") return -1;
    return a.time.localeCompare(b.time);
  });

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

      {allItems.length === 0 ? (
        <div className="jr-empty">
          No entries or tasks on this day yet. Start one with “New entry”.
        </div>
      ) : (
        allItems.map((item) => {
          if (item.type === "journal") {
            const moodForActive = moodFor === item.id;
            return (
              <div key={item.id} className="jr-entry">
                <span className="jr-entry-time">{item.time}</span>
                <div className="jr-entry-body" onClick={() => open(item.id)}>
                  <div className="jr-entry-title">
                    <span aria-hidden>{item.mood || item.icon || "📄"}</span>
                    {item.title}
                  </div>
                </div>
                <div className="jr-mood-wrap">
                  <button
                    className="jr-icon-btn"
                    title="Set mood"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setMoodFor(moodForActive ? null : item.id);
                    }}
                  >
                    {item.mood || "＋"}
                  </button>
                  {moodForActive && (
                    <div className="jr-mood-pop">
                      {MOODS.map((m) => (
                        <button
                          key={m}
                          className="jr-mood-opt"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setEntryMood(item.id, item.mood === m ? "" : m);
                            setMoodFor(null);
                          }}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          } else {
            // Task item
            const t = item.task!;
            const pr = priorityLabel(t.priority);
            const isDone = t.status === "done";
            const isExpanded = expandedTaskId === t.id;
            return (
              <div
                key={t.id}
                className={`jr-entry jr-task-item ${isDone ? "done" : ""}`}
              >
                <span className="jr-entry-time">{item.time}</span>
                <div
                  className="jr-entry-body"
                  onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                >
                  <div className="jr-entry-title jr-entry-title-row">
                    <span
                      className={`jr-task-badge ${isDone ? "is-done" : ""}`}
                    >
                      ✓
                    </span>
                    <span
                      className={`jr-task-title ${isDone ? "is-done" : ""}`}
                    >
                      {t.title}
                    </span>
                    {pr && (
                      <span
                        className={`work-priority-badge jr-work-priority-badge ${pr === "P0" ? "p0" : ""}`}
                      >
                        {pr}
                      </span>
                    )}
                    <span
                      className={`work-status-badge jr-work-status-badge ${isDone ? "is-done" : t.status === "blocked" ? "blocked" : ""}`}
                    >
                      {t.status}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="jr-task-details">
                      {t.body && <p className="jr-task-body-text">{t.body}</p>}
                      {t.assignee && (
                        <p className="jr-task-assignee-text">
                          Assigned: @{t.assignee}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          }
        })
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
