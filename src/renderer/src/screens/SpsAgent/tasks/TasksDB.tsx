// TasksDB.tsx — embedded database: view switch, filter/sort, inline edits.
// Block-controlled + persistent. Ported from tasks.jsx TasksDB.
import { useState } from "react";
import { Icon } from "../components/Icon";
import { STATUS } from "../data/seed";
import { TASKS } from "../data/seed";
import { uid } from "../lib/ids";
import type { Block, DbCol, DbView, StatusKey, Task } from "../types";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { GalleryView } from "./GalleryView";
import { ListView } from "./ListView";
import { TableView } from "./TableView";
import { FsPop } from "./FsPop";
import { PropMenu, type PropState } from "./PropMenu";
import { PRIO_RANK, SORTS, VIEWS, parseDue } from "./taskUtils";

interface Props {
  block: Block;
  update: (patch: Partial<Block>) => void;
  onOpenTask: (t: Task) => void;
}

type FsState = { kind: "filter" | "sort"; x: number; y: number } | null;

export function TasksDB({ block, update, onOpenTask }: Props) {
  const view: DbView = block.view || "board";
  const rows: Task[] = block.rows || TASKS;
  const fStatus: StatusKey[] = block.filter || [];
  const sort = block.sort || "manual";
  const cols: DbCol[] = block.cols || [];
  const [fOpen, setFOpen] = useState<FsState>(null);
  const [prop, setProp] = useState<PropState | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<StatusKey | null>(null);

  const setRows = (fn: (rs: Task[]) => Task[]) => update({ rows: fn(rows) });
  const setField = (id: string, field: keyof Task, val: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  const setCustom = (id: string, colId: string, val: string) =>
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? { ...r, custom: { ...(r.custom || {}), [colId]: val } }
          : r,
      ),
    );
  const cycle = (id: string) => {
    const order: StatusKey[] = ["todo", "doing", "review", "done"];
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? { ...r, status: order[(order.indexOf(r.status) + 1) % 4] }
          : r,
      ),
    );
  };
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        id: uid("t"),
        title: "New task",
        status: "todo",
        prio: "med",
        who: "maya",
        due: "Jun 9",
        est: "1d",
      },
    ]);
  const addCol = () =>
    update({ cols: [...cols, { id: uid("col"), name: "Notes" }] });

  let shown = fStatus.length
    ? rows.filter((r) => fStatus.includes(r.status))
    : rows;
  if (sort !== "manual")
    shown = [...shown].sort((a, b) =>
      sort === "prio"
        ? PRIO_RANK[a.prio] - PRIO_RANK[b.prio]
        : sort === "title"
          ? a.title.localeCompare(b.title)
          : parseDue(a.due) - parseDue(b.due),
    );

  const openProp = (
    e: React.MouseEvent,
    rowId: string,
    field: PropState["field"],
  ) => {
    const r = e.currentTarget.getBoundingClientRect();
    setProp({ rowId, field, x: r.left, y: r.bottom + 4 });
  };

  return (
    <div className="db">
      <div className="db-head">
        {VIEWS.map(([v, label, icon]) => (
          <div
            key={v}
            className={`db-tab ${view === v ? "active" : ""}`}
            onClick={() => update({ view: v })}
          >
            <Icon name={icon} size={15} /> {label}
          </div>
        ))}
        <div className="db-spacer"></div>
        <div
          className={`db-tool ${fStatus.length ? "on" : ""}`}
          onClick={(e) =>
            setFOpen(
              fOpen && fOpen.kind === "filter"
                ? null
                : {
                    kind: "filter",
                    x: e.currentTarget.getBoundingClientRect().left,
                    y: e.currentTarget.getBoundingClientRect().bottom + 4,
                  },
            )
          }
        >
          <Icon name="filter" size={14} /> Filter
          {fStatus.length ? ` (${fStatus.length})` : ""}
        </div>
        <div
          className={`db-tool ${sort !== "manual" ? "on" : ""}`}
          onClick={(e) =>
            setFOpen(
              fOpen && fOpen.kind === "sort"
                ? null
                : {
                    kind: "sort",
                    x: e.currentTarget.getBoundingClientRect().left,
                    y: e.currentTarget.getBoundingClientRect().bottom + 4,
                  },
            )
          }
        >
          <Icon name="sort" size={14} /> Sort
        </div>
      </div>

      {view === "table" && (
        <TableView
          tasks={shown}
          cols={cols}
          onOpenTask={onOpenTask}
          openProp={openProp}
          setCustom={setCustom}
          addRow={addRow}
          addCol={addCol}
        />
      )}
      {view === "board" && (
        <BoardView
          tasks={shown}
          onOpenTask={onOpenTask}
          drag={drag}
          setDrag={setDrag}
          dropCol={dropCol}
          setDropCol={setDropCol}
          setStatus={(id, s) => setField(id, "status", s)}
          addRow={addRow}
        />
      )}
      {view === "list" && (
        <ListView tasks={shown} onOpenTask={onOpenTask} cycle={cycle} />
      )}
      {view === "gallery" && (
        <GalleryView tasks={shown} onOpenTask={onOpenTask} />
      )}
      {view === "calendar" && (
        <CalendarView tasks={shown} onOpenTask={onOpenTask} />
      )}

      {fOpen && fOpen.kind === "filter" && (
        <FsPop
          x={fOpen.x}
          y={fOpen.y}
          onClose={() => setFOpen(null)}
          title="Filter by status"
        >
          <div className="fs-chiprow">
            {Object.entries(STATUS).map(([k, st]) => (
              <div
                key={k}
                className={`fs-chip ${fStatus.includes(k as StatusKey) ? "on" : ""}`}
                onClick={() =>
                  update({
                    filter: fStatus.includes(k as StatusKey)
                      ? fStatus.filter((x) => x !== k)
                      : [...fStatus, k as StatusKey],
                  })
                }
              >
                {st.label}
              </div>
            ))}
          </div>
          {fStatus.length > 0 && (
            <div className="fs-row">
              <button
                style={{
                  color: "var(--accent-text)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                }}
                onClick={() => update({ filter: [] })}
              >
                Clear filter
              </button>
            </div>
          )}
        </FsPop>
      )}
      {fOpen && fOpen.kind === "sort" && (
        <FsPop
          x={fOpen.x}
          y={fOpen.y}
          onClose={() => setFOpen(null)}
          title="Sort by"
        >
          {SORTS.map(([k, label]) => (
            <div
              key={k}
              className="menu-mini"
              onClick={() => {
                update({ sort: k });
                setFOpen(null);
              }}
            >
              {label}
              {sort === k && (
                <span className="menu-sub-arrow">
                  <Icon name="check" size={14} />
                </span>
              )}
            </div>
          ))}
        </FsPop>
      )}
      {prop && (
        <PropMenu
          prop={prop}
          onClose={() => setProp(null)}
          onPick={(val) => {
            setField(prop.rowId, prop.field, val);
            setProp(null);
          }}
        />
      )}
    </div>
  );
}
