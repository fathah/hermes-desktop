import { useState } from "react";
import {
  parseWorkspaceDatabase,
  stringifyWorkspaceDatabase,
  updateWorkspaceDatabaseItem,
  type WorkspaceDatabase,
  type WorkspaceDatabaseView,
} from "./database";

interface DatabaseBlockProps {
  content: string;
  onChange: (content: string) => void;
}

function visibleColumns(
  db: WorkspaceDatabase,
  view: WorkspaceDatabaseView,
): string[] {
  const hidden = new Set(["id", ...(view.hiddenProperties ?? [])]);
  return Object.keys(db.properties).filter((column) => !hidden.has(column));
}

function itemTitle(item: Record<string, unknown>): string {
  return String(item.name ?? item.title ?? item.id ?? "Untitled");
}

export default function DatabaseBlock({
  content,
  onChange,
}: DatabaseBlockProps): React.JSX.Element {
  const [viewId, setViewId] = useState<string | null>(null);
  const parsed = parseWorkspaceDatabase(content);
  if (!parsed.ok) {
    return <div className="workspace-db-error">{parsed.error}</div>;
  }

  const db = parsed.database;
  const activeView =
    db.views.find((view) => view.id === viewId) ?? db.view ?? db.views[0];
  const columns = visibleColumns(db, activeView);
  const groupBy = activeView.groupBy;

  function editItem(index: number, key: string, value: string): void {
    const edited = updateWorkspaceDatabaseItem(db, index, key, value);
    onChange(stringifyWorkspaceDatabase(edited));
  }

  function addRow(): void {
    const row = Object.fromEntries(
      Object.keys(db.properties).map((property) => [property, ""]),
    );
    const edited: WorkspaceDatabase = {
      ...db,
      items: [...db.items, { ...row, id: `row-${db.items.length + 1}` }],
    };
    onChange(stringifyWorkspaceDatabase(edited));
  }

  function renderFields(
    item: Record<string, unknown>,
    index: number,
  ): React.JSX.Element {
    return (
      <>
        {columns.map((column) => (
          <label key={column}>
            <span>{column}</span>
            <input
              value={String(item[column] ?? "")}
              onChange={(event) => editItem(index, column, event.target.value)}
            />
          </label>
        ))}
      </>
    );
  }

  function renderBoard(): React.JSX.Element {
    const options = groupBy ? (db.properties[groupBy]?.options ?? []) : [];
    const groups =
      groupBy && options.length > 0
        ? options
        : groupBy
          ? [...new Set(db.items.map((item) => String(item[groupBy] ?? "")))]
          : ["Items"];
    return (
      <div className="workspace-db-board">
        {groups.map((group) => (
          <section key={group} className="workspace-db-column">
            <div className="workspace-db-column-title">{group || "None"}</div>
            {db.items.map((item, index) =>
              !groupBy || String(item[groupBy] ?? "") === group ? (
                <div
                  key={String(item.id ?? index)}
                  className="workspace-db-card"
                >
                  {renderFields(item, index)}
                </div>
              ) : null,
            )}
          </section>
        ))}
      </div>
    );
  }

  function renderTable(): React.JSX.Element {
    return (
      <table className="workspace-db-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {db.items.map((item, index) => (
            <tr key={String(item.id ?? index)}>
              {columns.map((column) => (
                <td key={column}>
                  <input
                    value={String(item[column] ?? "")}
                    onChange={(event) =>
                      editItem(index, column, event.target.value)
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderCards(className: string): React.JSX.Element {
    return (
      <div className={className}>
        {db.items.map((item, index) => (
          <article key={String(item.id ?? index)} className="workspace-db-card">
            <strong>{itemTitle(item)}</strong>
            {renderFields(item, index)}
          </article>
        ))}
      </div>
    );
  }

  function renderView(): React.JSX.Element {
    if (activeView.type === "board") return renderBoard();
    if (activeView.type === "list") return renderCards("workspace-db-list");
    if (activeView.type === "gallery")
      return renderCards("workspace-db-gallery");
    if (activeView.type === "calendar")
      return renderCards("workspace-db-calendar");
    if (activeView.type === "timeline")
      return renderCards("workspace-db-timeline");
    return renderTable();
  }

  return (
    <div className="workspace-db">
      <div className="workspace-db-header">
        <h1>{db.title}</h1>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={addRow}
        >
          New row
        </button>
      </div>
      <div
        className="workspace-db-views"
        role="tablist"
        aria-label="Database views"
      >
        {db.views.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={activeView.id === view.id}
            className={activeView.id === view.id ? "active" : ""}
            onClick={() => setViewId(view.id)}
          >
            {view.name}
          </button>
        ))}
      </div>
      {renderView()}
    </div>
  );
}
