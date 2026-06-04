// QueryDatabase.tsx — Part 2 / S4: a folder-backed "query database".
//
// Rows live as markdown row-files under <vault>/<source>/; this renders them via
// the note index (useVaultQuery) and the inline form writes a new row-file (the
// "Form"). Distinct from the embedded-rows <TasksDB> — a database block opts in
// by carrying a `source` folder. Nothing here touches the JSON store.
import { useState } from "react";
import { Icon } from "../components/Icon";
import { useVaultQuery } from "../hooks/useNoteIndex";
import { rowToMarkdown } from "../editor/rowMarkdown";
import { uid } from "../lib/ids";
import type { Block, StatusKey } from "../types";

const STATUSES: StatusKey[] = ["todo", "doing", "review", "done"];
// Let the chokidar-backed index pick up the new/removed file before refetching.
const INDEX_LAG_MS = 200;

export function QueryDatabase({ block }: { block: Block }) {
  const source = block.source || "";
  const { rows, refetch } = useVaultQuery(source);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<StatusKey>("todo");

  const addRow = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed || !source) return;
    const api = window.hermesAPI;
    if (!api?.spsExportRow) return;
    const markdown = rowToMarkdown({ title: trimmed, status });
    await api.spsExportRow(source, uid("row"), markdown);
    setTitle("");
    setTimeout(refetch, INDEX_LAG_MS);
  };

  const deleteRow = async (path: string): Promise<void> => {
    const rowId = (path.split("/").pop() || "").replace(/\.md$/, "");
    const api = window.hermesAPI;
    if (!api?.spsDeleteRow || !rowId) return;
    await api.spsDeleteRow(source, rowId);
    setTimeout(refetch, INDEX_LAG_MS);
  };

  return (
    <div className="qdb" contentEditable={false}>
      <table className="qdb-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path}>
              <td>{r.title || "Untitled"}</td>
              <td>{String(r.props.status ?? "")}</td>
              <td>
                <button
                  className="qdb-del"
                  aria-label="Delete row"
                  onClick={() => deleteRow(r.path)}
                >
                  <Icon name="x" size={13} />
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="qdb-empty" colSpan={3}>
                No rows yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="qdb-form">
        <input
          className="qdb-input"
          value={title}
          placeholder="New row…"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addRow();
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
        <button className="qdb-add" onClick={() => void addRow()}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>
    </div>
  );
}
