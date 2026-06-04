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
import type { Block, DbCol, DbView, StatusKey, Task } from "../types";
import { vaultRowToTask } from "./vaultRowToTask";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { GalleryView } from "./GalleryView";
import { ListView } from "./ListView";
import { TableView } from "./TableView";
import { PropMenu, type PropState } from "./PropMenu";
import { VIEWS } from "./taskUtils";

const STATUSES: StatusKey[] = ["todo", "doing", "review", "done"];
// Let the chokidar-backed index pick up the new/removed file before refetching.
const INDEX_LAG_MS = 200;

const MD_SUFFIX = /\.md$/;
const rowIdOf = (path: string): string =>
  (path.split("/").pop() || "").replace(MD_SUFFIX, "");

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
  const { rows, refetch } = useVaultQuery(source);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<StatusKey>("todo");
  const [prop, setProp] = useState<PropState | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<StatusKey | null>(null);

  const tasks: Task[] = rows.map(vaultRowToTask);
  const rowByPath = new Map(rows.map((r) => [r.path, r] as const));

  // Write-back: merge a property patch into the row's existing frontmatter and
  // re-serialize the row file. Title is always written so the index keeps it,
  // and unknown props (region, custom columns, …) survive the round-trip.
  const writeRow = async (taskId: string, patch: RowProps): Promise<void> => {
    const row = rowByPath.get(taskId);
    const api = window.hermesAPI;
    if (!row || !source || !api?.spsExportRow) return;
    const next: RowProps = { title: row.title, ...row.props, ...patch };
    const markdown = rowToMarkdown(next);
    await api.spsExportRow(source, rowIdOf(row.path), markdown);
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
      STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length];
    void writeRow(id, { status: next });
  };

  const createRow = async (props: RowProps): Promise<void> => {
    const api = window.hermesAPI;
    if (!source || !api?.spsExportRow) return;
    const markdown = rowToMarkdown(props);
    await api.spsExportRow(source, uid("row"), markdown);
    setTimeout(refetch, INDEX_LAG_MS);
  };

  const addRow = (): void =>
    void createRow({ title: "New row", status: "todo" });

  const addFromForm = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await createRow({ title: trimmed, status });
    setTitle("");
  };

  const deleteRow = async (taskId: string): Promise<void> => {
    const api = window.hermesAPI;
    const rowId = rowIdOf(taskId);
    if (!api?.spsDeleteRow || !source || !rowId) return;
    await api.spsDeleteRow(source, rowId);
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

  // Query-database rows are not pages, so there is no task-detail surface to
  // open; clicking a card/title is a no-op (edits happen inline / via the form).
  const noop = (): void => {};

  return (
    <div className="qdb" contentEditable={false}>
      <div className="db-head">
        {VIEWS.map(([v, label, icon]) => (
          <div
            key={v}
            className={`db-tab ${view === v ? "active" : ""}`}
            onClick={() => update?.({ view: v })}
          >
            <Icon name={icon} size={15} /> {label}
          </div>
        ))}
      </div>

      {view === "table" && (
        <TableView
          tasks={tasks}
          cols={cols}
          onOpenTask={noop}
          openProp={openProp}
          setCustom={setCustom}
          addRow={addRow}
          addCol={addCol}
          onDelete={(id) => void deleteRow(id)}
        />
      )}
      {view === "board" && (
        <BoardView
          tasks={tasks}
          onOpenTask={noop}
          drag={drag}
          setDrag={setDrag}
          dropCol={dropCol}
          setDropCol={setDropCol}
          setStatus={(id, s) => setField(id, "status", s)}
          addRow={addRow}
        />
      )}
      {view === "list" && (
        <ListView tasks={tasks} onOpenTask={noop} cycle={cycleStatus} />
      )}
      {view === "gallery" && <GalleryView tasks={tasks} onOpenTask={noop} />}
      {view === "calendar" && <CalendarView tasks={tasks} onOpenTask={noop} />}

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
        />
        <select
          className="qdb-select"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusKey)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
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
