// QueryDatabase.tsx — Part 2 / S4 + F1: a folder-backed "query database".
//
// Rows live as markdown row-files under <vault>/<source>/; this renders them via
// the note index (useVaultQuery) through the same view components the embedded
// <TasksDB> uses (board/table/list/gallery/calendar). Inline edits merge a
// property patch into the row's existing frontmatter and re-serialize the file
// (markdown stays the source of truth; the index just refetches). The inline
// form writes a new row-file (the "Form"). Nothing here touches the JSON store.
import { useState } from "react";
import { Icon } from "../components/Icon";
import { useVaultQuery } from "../hooks/useNoteIndex";
import { rowToMarkdown, type RowProps } from "../editor/rowMarkdown";
import { uid } from "../lib/ids";
import { pageIdFromPath } from "../lib/pageId";
import type { Block, DbCol, DbView, StatusKey, Task } from "../types";
import { vaultRowToTask } from "./vaultRowToTask";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { GalleryView } from "./GalleryView";
import { ListView } from "./ListView";
import { TableView } from "./TableView";
import { PropMenu, type PropState } from "./PropMenu";
import { VIEWS } from "./taskUtils";
import { useStore } from "../store";
import { STATUS } from "../data/seed";

// Let the chokidar-backed index pick up the new/removed file before refetching.
const INDEX_LAG_MS = 200;

interface Props {
  block: Block;
  // Persists the view switch (and added columns) back onto the block. Optional
  // so the component still renders read-only when no updater is wired in.
  update?: (patch: Partial<Block>) => void;
}

export function QueryDatabase({ block, update }: Props) {
  const source = block.source || "";
  const view: DbView = block.view || "table";
  const cols: DbCol[] = block.cols || [];
  const kanbanPreset = block.kanbanPreset || "standard";
  const { rows, refetch } = useVaultQuery(source);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<StatusKey>("todo");
  const [prop, setProp] = useState<PropState | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<StatusKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const setOpenTask = useStore((s) => s.setOpenTask);

  const tasks: Task[] = rows.map(vaultRowToTask);
  const rowByPath = new Map(rows.map((r) => [r.path, r] as const));

  const statuses: StatusKey[] =
    kanbanPreset === "personal"
      ? ["inbox", "this_week", "doing", "blocked", "done"]
      : ["todo", "doing", "review", "done"];

  // Write-back: merge a property patch into the row's existing frontmatter and
  // re-serialize the row file. Title is always written so the index keeps it,
  // and unknown props (region, custom columns, …) survive the round-trip.
  const writeRow = async (taskId: string, patch: RowProps): Promise<void> => {
    const row = rowByPath.get(taskId);
    const api = window.hermesAPI;
    if (!row || !source || !api?.spsExportRow) return;
    const next: RowProps = { title: row.title, ...row.props, ...patch };
    const markdown = rowToMarkdown(next);
    await api.spsExportRow(source, pageIdFromPath(row.path), markdown);
    setTimeout(refetch, INDEX_LAG_MS);
  };

  const setField = (id: string, field: keyof Task, val: string): void =>
    void writeRow(id, { [field]: val });
  const setCustom = (id: string, colId: string, val: string): void =>
    void writeRow(id, { [colId]: val });
  const cycleStatus = (id: string): void => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const next =
      statuses[(statuses.indexOf(task.status) + 1) % statuses.length];
    void writeRow(id, { status: next });
  };

  const createRow = async (props: RowProps, body = ""): Promise<void> => {
    const api = window.hermesAPI;
    if (!source || !api?.spsExportRow) return;
    const markdown = rowToMarkdown(props, body);
    await api.spsExportRow(source, uid("row"), markdown);
    setTimeout(refetch, INDEX_LAG_MS);
  };

  const addRow = (template?: "quick" | "project" | "routine"): void => {
    const defaultStatus: StatusKey = kanbanPreset === "personal" ? "inbox" : "todo";
    const props: RowProps = {
      status: defaultStatus,
      prio: "med",
      who: "you",
      due: "",
      est: ""
    };
    let body = "";
    if (template === "quick") {
      props.title = "New Quick Win";
      props.prio = "low";
      props.label = "Quick Win";
    } else if (template === "project") {
      props.title = "New Project";
      props.prio = "high";
      props.label = "Project";
      body = "Definition of Done:\n\n- [ ] Prerequisite: What do I need to buy/find?\n- [ ] Action Step: First micro-task (15 min)";
    } else if (template === "routine") {
      props.title = "New Routine";
      props.prio = "med";
      props.label = "Routine";
      body = "Links/Resources:\n\n- [ ] SOP Step 1: Start process\n- [ ] SOP Step 2: Complete routine";
    } else {
      props.title = "New row";
    }
    void createRow(props, body);
  };

  const addFromForm = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await createRow({ title: trimmed, status });
    setTitle("");
  };

  const deleteRow = async (taskId: string): Promise<void> => {
    const api = window.hermesAPI;
    const rowId = pageIdFromPath(taskId);
    if (!api?.spsDeleteRow || !source || !rowId) return;
    await api.spsDeleteRow(source, rowId);
    setTimeout(refetch, INDEX_LAG_MS);
  };

  const weeklyReset = async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api?.spsDeleteRow || !source) return;
    const doneTasks = tasks.filter((t) => t.status === "done");
    for (const t of doneTasks) {
      const rowId = pageIdFromPath(t.id);
      if (rowId) await api.spsDeleteRow(source, rowId);
    }
    setTimeout(refetch, INDEX_LAG_MS);
  };

  const addCol = (): void =>
    update?.({ cols: [...cols, { id: uid("col"), name: "Notes" }] });

  const openProp = (
    e: React.MouseEvent,
    rowId: string,
    field: PropState["field"],
  ): void => {
    const r = e.currentTarget.getBoundingClientRect();
    setProp({ rowId, field, x: r.left, y: r.bottom + 4 });
  };

  return (
    <div className="qdb" contentEditable={false}>
      <div className="db-head">
        {/* View Switcher Dropdown */}
        <div className="db-view-dropdown-container">
          <button
            type="button"
            className="db-tool db-view-dropdown-btn"
            onClick={() => setViewMenuOpen(!viewMenuOpen)}
            title="Switch Database View"
          >
            <Icon name={VIEWS.find(([v]) => v === view)?.[2] || VIEWS[0][2]} size={15} />
            <span>{VIEWS.find(([v]) => v === view)?.[1] || VIEWS[0][1]} View</span>
            <span className="db-view-chevron">▾</span>
          </button>
          {viewMenuOpen && (
            <div className="db-template-menu left-align" onMouseLeave={() => setViewMenuOpen(false)}>
              {VIEWS.map(([v, label, icon]) => (
                <div
                  key={v}
                  className={`db-template-item ${view === v ? "active" : ""}`}
                  onClick={() => {
                    update?.({ view: v });
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
            <div className="db-template-menu right-align" onMouseLeave={() => setMoreMenuOpen(false)}>
              <div
                className="db-template-item"
                onClick={() => {
                  update?.({
                    kanbanPreset: kanbanPreset === "standard" ? "personal" : "standard",
                  });
                  setMoreMenuOpen(false);
                }}
              >
                <Icon name="board" size={14} />
                <span>Layout: {kanbanPreset === "personal" ? "Personal" : "Standard"}</span>
              </div>
              <div
                className="db-template-item"
                onClick={() => {
                  void weeklyReset();
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
            <Icon name="plus" size={14} /> Add Row
          </button>
          <button
            className="db-tool db-new-btn-arrow"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ▾
          </button>
          {menuOpen && (
            <div className="db-template-menu" onMouseLeave={() => setMenuOpen(false)}>
              <div className="db-template-item" onClick={() => { addRow(); setMenuOpen(false); }}>
                📄 Blank Row
              </div>
              <div className="db-template-item" onClick={() => { addRow("quick"); setMenuOpen(false); }}>
                ⚡ Quick Win
              </div>
              <div className="db-template-item" onClick={() => { addRow("project"); setMenuOpen(false); }}>
                🏗️ Deep Work / Project
              </div>
              <div className="db-template-item" onClick={() => { addRow("routine"); setMenuOpen(false); }}>
                🔁 Routine / Habit
              </div>
            </div>
          )}
        </div>
      </div>

      {view === "table" && (
        <TableView
          tasks={tasks}
          cols={cols}
          onOpenTask={setOpenTask}
          openProp={openProp}
          setCustom={setCustom}
          addRow={() => addRow()}
          addCol={addCol}
          onDelete={(id) => void deleteRow(id)}
        />
      )}
      {view === "board" && (
        <BoardView
          tasks={tasks}
          onOpenTask={setOpenTask}
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
        <ListView tasks={tasks} onOpenTask={setOpenTask} cycle={cycleStatus} />
      )}
      {view === "gallery" && <GalleryView tasks={tasks} onOpenTask={setOpenTask} />}
      {view === "calendar" && <CalendarView tasks={tasks} onOpenTask={setOpenTask} />}

      {rows.length === 0 && <div className="qdb-empty">No rows yet</div>}

      <div className="qdb-form">
        <input
          className="qdb-input"
          value={title}
          placeholder="New row…"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addFromForm();
          }}
          title="New row title"
        />
        <select
          className="qdb-select"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusKey)}
          title="Status"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {STATUS[s]?.label || s}
            </option>
          ))}
        </select>
        <button className="qdb-add" onClick={() => void addFromForm()}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>

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
