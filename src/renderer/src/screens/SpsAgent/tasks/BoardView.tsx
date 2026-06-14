// BoardView.tsx — kanban board with drag-between-columns. Ported from tasks.jsx.
import { Icon } from "../components/Icon";
import { STATUS } from "../data/seed";
import type { StatusKey, Task } from "../types";
import { Avatar, PrioChip } from "./chips";

interface Props {
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  drag: string | null;
  setDrag: (id: string | null) => void;
  dropCol: StatusKey | null;
  setDropCol: (c: StatusKey | null) => void;
  setStatus: (id: string, s: StatusKey) => void;
  addRow: () => void;
  kanbanPreset?: "standard" | "personal";
}

export function BoardView({
  tasks,
  onOpenTask,
  drag,
  setDrag,
  dropCol,
  setDropCol,
  setStatus,
  addRow,
  kanbanPreset = "standard",
}: Props) {
  const cols: StatusKey[] =
    kanbanPreset === "personal"
      ? ["inbox", "this_week", "doing", "blocked", "done"]
      : ["todo", "doing", "review", "done"];

  const getWipLimit = (c: StatusKey): number | null => {
    if (kanbanPreset === "personal" && c === "doing") return 3;
    return null;
  };

  return (
    <div className="board scroll">
      {cols.map((c) => {
        const items = tasks.filter((t) => t.status === c);
        const limit = getWipLimit(c);
        const limitExceeded = limit !== null && items.length > limit;

        return (
          <div
            className={`board-col ${dropCol === c ? "drop-target" : ""} ${limitExceeded ? "wip-exceeded" : ""}`}
            key={c}
            onDragOver={(e) => {
              e.preventDefault();
              setDropCol(c);
            }}
            onDrop={() => {
              if (drag) setStatus(drag, c);
              setDrag(null);
              setDropCol(null);
            }}
          >
            <div className="board-col-head">
              <span
                className={`dot ${STATUS[c]?.cls || ""}`}
              ></span>
              {STATUS[c]?.label || c}{" "}
              <span className="count">
                {items.length}
                {limit !== null && ` / ${limit}`}
              </span>
              {limitExceeded && (
                <span className="wip-warning">
                  🚨 OVER WIP LIMIT
                </span>
              )}
            </div>
            {items.map((t) => (
              <div
                className={`card ${drag === t.id ? "dragging" : ""}`}
                key={t.id}
                draggable
                onDragStart={() => setDrag(t.id)}
                onDragEnd={() => {
                  setDrag(null);
                  setDropCol(null);
                }}
                onClick={() => onOpenTask(t)}
              >
                {t.custom?.label && (
                  <div className="card-label-container">
                    <span
                      className={`card-label-tag ${
                        t.custom.label === "Quick Win"
                          ? "tag-quick-win"
                          : t.custom.label === "Project"
                            ? "tag-project"
                            : t.custom.label === "Routine"
                              ? "tag-routine"
                              : ""
                      }`}
                    >
                      {t.custom.label}
                    </span>
                  </div>
                )}
                <div className="card-title">{t.title}</div>
                <div className="card-foot">
                  <PrioChip p={t.prio} />
                  <span className="flex-grow"></span>
                  <span
                    className="num card-due"
                  >
                    {t.due}
                  </span>
                  <Avatar who={t.who} />
                </div>
              </div>
            ))}
            <div className="card-add" onClick={addRow}>
              <Icon name="plus" size={14} /> New
            </div>
          </div>
        );
      })}
    </div>
  );
}
