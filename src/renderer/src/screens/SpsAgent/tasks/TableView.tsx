// TableView.tsx — table view with inline-editable custom columns. Ported from tasks.jsx.
import { Icon } from "../components/Icon";
import { PEOPLE } from "../data/seed";
import type { DbCol, Task } from "../types";
import { Avatar, PrioChip, StatusChip } from "./chips";
import type { PropState } from "./PropMenu";

interface Props {
  tasks: Task[];
  cols: DbCol[];
  onOpenTask: (t: Task) => void;
  openProp: (
    e: React.MouseEvent,
    rowId: string,
    field: PropState["field"],
  ) => void;
  setCustom: (id: string, colId: string, val: string) => void;
  addRow: () => void;
  addCol: () => void;
  // F1: optional per-row delete (folder-backed query databases delete a file).
  // Absent ⇒ no delete affordance (the embedded TasksDB is unchanged).
  onDelete?: (id: string) => void;
}

export function TableView({
  tasks,
  cols,
  onOpenTask,
  openProp,
  setCustom,
  addRow,
  addCol,
  onDelete,
}: Props) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ minWidth: 220 }}>
              <Icon name="text" size={13} />
              Task
            </th>
            <th>
              <Icon name="board" size={13} />
              Status
            </th>
            <th>
              <Icon name="flag" size={13} />
              Priority
            </th>
            <th>
              <Icon name="home" size={13} />
              Owner
            </th>
            <th>
              <Icon name="calendar" size={13} />
              Due
            </th>
            {cols.map((c) => (
              <th key={c.id}>{c.name}</th>
            ))}
            <th style={{ width: 34 }}>
              <span
                className="db-tool"
                style={{ padding: 3 }}
                onClick={addCol}
                title="Add property"
              >
                <Icon name="plus" size={14} />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="c-name" onClick={() => onOpenTask(t)}>
                {t.title}
              </td>
              <td
                style={{ cursor: "pointer" }}
                onClick={(e) => openProp(e, t.id, "status")}
              >
                <StatusChip s={t.status} />
              </td>
              <td
                style={{ cursor: "pointer" }}
                onClick={(e) => openProp(e, t.id, "prio")}
              >
                <PrioChip p={t.prio} />
              </td>
              <td
                style={{ cursor: "pointer" }}
                onClick={(e) => openProp(e, t.id, "who")}
              >
                <span className="person">
                  <Avatar who={t.who} />
                  {PEOPLE[t.who]?.name ?? t.who}
                </span>
              </td>
              <td className="num">{t.due}</td>
              {cols.map((c) => (
                <td key={c.id}>
                  <span
                    className="cell-edit"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onBlur={(e) =>
                      setCustom(t.id, c.id, e.currentTarget.textContent || "")
                    }
                  >
                    {(t.custom && t.custom[c.id]) || ""}
                  </span>
                </td>
              ))}
              <td>
                {onDelete && (
                  <button
                    className="qdb-del"
                    aria-label="Delete row"
                    onClick={() => onDelete(t.id)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          <tr className="db-addrow">
            <td colSpan={6 + cols.length} onClick={addRow}>
              <Icon
                name="plus"
                size={14}
                style={{ verticalAlign: -3, marginRight: 6 }}
              />
              New task
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
