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
  const kanbanPreset = block.kanbanPreset || "standard";
  const [fOpen, setFOpen] = useState<FsState>(null);
  const [prop, setProp] = useState<PropState | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<StatusKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

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
    const order: StatusKey[] =
      kanbanPreset === "personal"
        ? ["inbox", "this_week", "doing", "blocked", "done"]
        : ["todo", "doing", "review", "done"];
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? {
              ...r,
              status: order[(order.indexOf(r.status) + 1) % order.length],
            }
          : r,
      ),
    );
  };
  const addRow = (template?: "quick" | "project" | "routine") => {
    const defaultStatus: StatusKey =
      kanbanPreset === "personal" ? "inbox" : "todo";
    let templateProps: Partial<Task> = {};
    if (template === "quick") {
      templateProps = {
        title: "New Quick Win",
        prio: "low",
        custom: { label: "Quick Win" },
      };
    } else if (template === "project") {
      templateProps = {
        title: "New Project",
        prio: "high",
        custom: { label: "Project" },
        desc: "Definition of Done:\n",
        checklist: [
          {
            id: uid("item"),
            text: "Prerequisite: What do I need to buy/find?",
            checked: false,
          },
          {
            id: uid("item"),
            text: "Action Step: First micro-task (15 min)",
            checked: false,
          },
        ],
      };
    } else if (template === "routine") {
      templateProps = {
        title: "New Routine",
        prio: "med",
        custom: { label: "Routine" },
        desc: "Links/Resources:\n",
        checklist: [
          {
            id: uid("item"),
            text: "SOP Step 1: Start process",
            checked: false,
          },
          {
            id: uid("item"),
            text: "SOP Step 2: Complete routine",
            checked: false,
          },
        ],
      };
    } else {
      templateProps = {
        title: "New task",
        prio: "med",
      };
    }

    setRows((rs) => [
      ...rs,
      {
        id: uid("t"),
        status: defaultStatus,
        who: "you",
        due: "",
        est: "",
        ...templateProps,
      } as Task,
    ]);
  };
  const weeklyReset = () => {
    setRows((rs) => rs.filter((r) => r.status !== "done"));
  };
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
        {/* View Switcher Dropdown */}
        <div className="db-view-dropdown-container">
          <button
            type="button"
            className="db-tool db-view-dropdown-btn"
            onClick={() => setViewMenuOpen(!viewMenuOpen)}
            title="Switch Database View"
          >
            <Icon
              name={VIEWS.find(([v]) => v === view)?.[2] || VIEWS[0][2]}
              size={15}
            />
            <span>
              {VIEWS.find(([v]) => v === view)?.[1] || VIEWS[0][1]} View
            </span>
            <span className="db-view-chevron">▾</span>
          </button>
          {viewMenuOpen && (
            <div
              className="db-template-menu left-align"
              onMouseLeave={() => setViewMenuOpen(false)}
            >
              {VIEWS.map(([v, label, icon]) => (
                <div
                  key={v}
                  className={`db-template-item ${view === v ? "active" : ""}`}
                  onClick={() => {
                    update({ view: v });
                    setViewMenuOpen(false);
                  }}
                >
                  <Icon name={icon} size={15} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

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

        {/* More Options Dropdown */}
        <div className="db-more-dropdown-container">
          <button
            type="button"
            className="db-tool"
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            title="More Options"
          >
            <Icon name="dots" size={15} />
          </button>
          {moreMenuOpen && (
            <div
              className="db-template-menu right-align"
              onMouseLeave={() => setMoreMenuOpen(false)}
            >
              <div
                className="db-template-item"
                onClick={() => {
                  update({
                    kanbanPreset:
                      kanbanPreset === "standard" ? "personal" : "standard",
                  });
                  setMoreMenuOpen(false);
                }}
              >
                <Icon name="board" size={14} />
                <span>
                  Layout:{" "}
                  {kanbanPreset === "personal" ? "Personal" : "Standard"}
                </span>
              </div>
              <div
                className="db-template-item"
                onClick={() => {
                  weeklyReset();
                  setMoreMenuOpen(false);
                }}
              >
                <Icon name="x" size={14} />
                <span>Weekly Reset</span>
              </div>
            </div>
          )}
        </div>
        <div className="db-new-btn-group">
          <button className="db-tool db-new-btn-main" onClick={() => addRow()}>
            <Icon name="plus" size={14} /> Add Task
          </button>
          <button
            className="db-tool db-new-btn-arrow"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ▾
          </button>
          {menuOpen && (
            <div
              className="db-template-menu"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <div
                className="db-template-item"
                onClick={() => {
                  addRow();
                  setMenuOpen(false);
                }}
              >
                📄 Blank Task
              </div>
              <div
                className="db-template-item"
                onClick={() => {
                  addRow("quick");
                  setMenuOpen(false);
                }}
              >
                ⚡ Quick Win
              </div>
              <div
                className="db-template-item"
                onClick={() => {
                  addRow("project");
                  setMenuOpen(false);
                }}
              >
                🏗️ Deep Work / Project
              </div>
              <div
                className="db-template-item"
                onClick={() => {
                  addRow("routine");
                  setMenuOpen(false);
                }}
              >
                🔁 Routine / Habit
              </div>
            </div>
          )}
        </div>
      </div>

      {view === "table" && (
        <TableView
          tasks={shown}
          cols={cols}
          onOpenTask={onOpenTask}
          openProp={openProp}
          setCustom={setCustom}
          addRow={() => addRow()}
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
          addRow={() => addRow()}
          kanbanPreset={kanbanPreset}
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
                className="db-clear-filter"
                onClick={() => update({ filter: [] })}
                title="Clear filter"
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
