// TaskDrawer.tsx — task detail side drawer. Ported from app.jsx TaskDrawer.
import { Icon } from "../components/Icon";
import { PEOPLE } from "../data/seed";
import { Avatar, PrioChip, StatusChip } from "../tasks/chips";
import type { Task } from "../types";

interface Props {
  task: Task;
  onClose: () => void;
}

export function TaskDrawer({ task, onClose }: Props) {
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <button className="tb-btn" onClick={onClose}>
            <Icon name="x" size={17} />
          </button>
          <span style={{ flex: 1 }}></span>
        </div>
        <div className="drawer-body scroll">
          <h1 className="drawer-title">{task.title}</h1>
          <div className="field-grid">
            <div className="fk">
              <Icon name="board" size={15} /> Status
            </div>
            <div className="fv">
              <StatusChip s={task.status} />
            </div>
            <div className="fk">
              <Icon name="flag" size={15} /> Priority
            </div>
            <div className="fv">
              <PrioChip p={task.prio} />
            </div>
            <div className="fk">
              <Icon name="home" size={15} /> Owner
            </div>
            <div className="fv">
              <span className="person">
                <Avatar who={task.who} />
                {PEOPLE[task.who].name}
              </span>
            </div>
            <div className="fk">
              <Icon name="calendar" size={15} /> Due
            </div>
            <div className="fv num">{task.due}</div>
            <div className="fk">
              <Icon name="clock" size={15} /> Estimate
            </div>
            <div className="fv num">{task.est}</div>
          </div>
          <hr className="b-divider" style={{ margin: "18px 0" }} />
          <p style={{ color: "var(--tx-2)", fontSize: 15 }}>
            Add a description, sub-tasks, and comments here. This drawer mirrors
            the page editor — the same blocks, slash menu, and assistant work
            inside a task.
          </p>
          <div className="b-callout" style={{ marginTop: 14 }}>
            <span className="emoji">💬</span>
            <div className="block" style={{ padding: 0 }}>
              Linked from <b>Team Home → Tasks</b>. Changes sync back to the
              board.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
