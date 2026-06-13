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
                  <div
                    className="jr-entry-title"
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <span
                      className="jr-task-badge"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: isDone ? "var(--accent)" : "transparent",
                        border: "1.5px solid var(--hair-strong)",
                        color: isDone ? "#fff" : "transparent",
                        fontSize: 10,
                        fontWeight: "bold",
                      }}
                    >
                      ✓
                    </span>
                    <span
                      style={{
                        textDecoration: isDone ? "line-through" : "none",
                        color: isDone ? "var(--tx-3)" : "var(--tx-1)",
                      }}
                    >
                      {t.title}
                    </span>
                    {pr && (
                      <span
                        className="work-priority-badge"
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background:
                            pr === "P0"
                              ? "rgba(229, 72, 77, 0.1)"
                              : "var(--hair-soft)",
                          color: pr === "P0" ? "#e5484d" : "var(--tx-2)",
                          fontWeight: "600",
                        }}
                      >
                        {pr}
                      </span>
                    )}
                    <span
                      className="work-status-badge"
                      style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: isDone
                          ? "rgba(76, 175, 80, 0.1)"
                          : t.status === "blocked"
                            ? "rgba(229, 72, 77, 0.1)"
                            : "var(--hair-soft)",
                        color: isDone
                          ? "#4caf50"
                          : t.status === "blocked"
                            ? "#e5484d"
                            : "var(--tx-3)",
                        textTransform: "uppercase",
                        letterSpacing: 0.2,
                      }}
                    >
                      {t.status}
                    </span>
                  </div>
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        color: "var(--tx-2)",
                        paddingLeft: 26,
                      }}
                    >
                      {t.body && (
                        <p style={{ whiteSpace: "pre-wrap", margin: "0 0 6px 0" }}>
                          {t.body}
                        </p>
                      )}
                      {t.assignee && (
                        <p style={{ margin: "4px 0 0 0", color: "var(--tx-3)" }}>
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

