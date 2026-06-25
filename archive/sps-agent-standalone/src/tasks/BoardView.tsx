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
}

const COLS: StatusKey[] = ["todo", "doing", "review", "done"];

export function BoardView({
  tasks,
  onOpenTask,
  drag,
  setDrag,
  dropCol,
  setDropCol,
  setStatus,
  addRow,
}: Props) {
  return (
    <div className="board scroll">
      {COLS.map((c) => {
        const items = tasks.filter((t) => t.status === c);
        return (
          <div
            className={`board-col ${dropCol === c ? "drop-target" : ""}`}
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
                className="dot"
                style={{ background: STATUS[c].dot }}
              ></span>
              {STATUS[c].label} <span className="count">{items.length}</span>
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
                <div className="card-title">{t.title}</div>
                <div className="card-foot">
                  <PrioChip p={t.prio} />
                  <span style={{ flex: 1 }}></span>
                  <span
                    className="num"
                    style={{ fontSize: 12, color: "var(--tx-3)" }}
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
