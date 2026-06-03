// ListView.tsx — compact list with status cycle. Ported from tasks.jsx.
import { Icon } from "../components/Icon";
import type { Task } from "../types";
import { Avatar, StatusChip } from "./chips";

interface Props {
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  cycle: (id: string) => void;
}

export function ListView({ tasks, onOpenTask, cycle }: Props) {
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
