// ListView.tsx — compact list with status cycle. Ported from tasks.jsx.
import { Icon } from "../components/Icon";
import type { Task } from "../types";
import { Avatar, KanbanStatusBadge, StatusChip } from "./chips";

interface Props {
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  cycle: (id: string) => void;
  // Live Kanban status for a delegated row's `delegatedTo` id. Absent ⇒ no
  // agent badge (the embedded TasksDB has no delegated rows).
  statusFor?: (id: string | null | undefined) => string | undefined;
}

export function ListView({ tasks, onOpenTask, cycle, statusFor }: Props) {
  return (
    <div className="lst">
      {tasks.map((t) => (
        <div className="lst-row" key={t.id}>
          <div
            className={`check ${t.status === "done" ? "done" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              cycle(t.id);
            }}
          >
            {t.status === "done" && (
              <Icon name="check" size={13} stroke={2.4} />
            )}
          </div>
          <span
            className="c-name"
            onClick={() => onOpenTask(t)}
            style={
              t.status === "done"
                ? { color: "var(--tx-3)", textDecoration: "line-through" }
                : {}
            }
          >
            {t.title}
          </span>
          <StatusChip s={t.status} />
          {t.delegatedTo && (
            <KanbanStatusBadge status={statusFor?.(t.delegatedTo)} />
          )}
          <span className="person">
            <Avatar who={t.who} />
          </span>
          <span
            className="num"
            style={{
              fontSize: 12,
              color: "var(--tx-3)",
              width: 52,
              textAlign: "right",
            }}
          >
            {t.due}
          </span>
        </div>
      ))}
    </div>
  );
}
