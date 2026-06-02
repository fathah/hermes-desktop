import { describe, expect, it } from "vitest";
import {
  applyWorkspaceDatabaseView,
  parseWorkspaceDatabase,
  stringifyWorkspaceDatabase,
  updateWorkspaceDatabaseItem,
} from "../src/renderer/src/screens/Workspace/database";

const yaml = `hermesType: database
title: Sprint Tasks
view:
  type: board
  groupBy: status
properties:
  name: { type: title }
  status: { type: select, options: [Todo, InProgress, Done] }
items:
  - name: Build Split Pane UI
    status: InProgress
`;

describe("workspace database yaml", () => {
  it("parses valid database yaml", () => {
    const db = parseWorkspaceDatabase(yaml);

    expect(db.ok).toBe(true);
    if (!db.ok) return;
    expect(db.database.title).toBe("Sprint Tasks");
    expect(db.database.view).toMatchObject({
      type: "board",
      groupBy: "status",
    });
    expect(db.database.items[0]).toMatchObject({
      name: "Build Split Pane UI",
      status: "InProgress",
    });
  });

  it("returns an error for malformed database yaml", () => {
    const db = parseWorkspaceDatabase("hermesType: database\nitems: [");

    expect(db.ok).toBe(false);
    if (db.ok) return;
    expect(db.error).toContain("Invalid database YAML");
  });

  it("preserves item edits when stringifying", () => {
    const parsed = parseWorkspaceDatabase(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const edited = updateWorkspaceDatabaseItem(
      parsed.database,
      0,
      "status",
      "Done",
    );
    const output = stringifyWorkspaceDatabase(edited);

    expect(output).toContain("title: Sprint Tasks");
    expect(output).toContain("status: Done");
    expect(parseWorkspaceDatabase(output)).toMatchObject({ ok: true });
  });

  it("migrates simple yaml to a versioned database with stable row ids and views", () => {
    const parsed = parseWorkspaceDatabase(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.database.version).toBe(2);
    expect(parsed.database.views.map((view) => view.type)).toEqual(["board"]);
    expect(parsed.database.items[0].id).toMatch(/^row-/);

    const output = stringifyWorkspaceDatabase(parsed.database);
    expect(output).toContain("version: 2");
    expect(output).toContain("views:");
    expect(output).toContain("id: row-");
  });

  it("applies view filters and sorts without mutating row pages", () => {
    const parsed = parseWorkspaceDatabase(`hermesType: database
version: 2
title: Tasks
properties:
  name: { type: title }
  status: { type: status, options: [Todo, Done] }
  priority: { type: number }
views:
  - id: done
    name: Done
    type: table
    openMode: side
    filters:
      operator: and
      filters:
        - property: status
          operator: equals
          value: Done
    sorts:
      - property: priority
        direction: desc
items:
  - id: row-low
    name: Low
    status: Done
    priority: 1
  - id: row-todo
    name: Todo
    status: Todo
    priority: 9
  - id: row-high
    name: High
    status: Done
    priority: 5
rowPages:
  row-high: "High body"
`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const view = parsed.database.views[0];
    expect(view.openMode).toBe("side");
    expect(applyWorkspaceDatabaseView(parsed.database, view)).toEqual([
      {
        id: "row-high",
        name: "High",
        status: "Done",
        priority: 5,
      },
      {
        id: "row-low",
        name: "Low",
        status: "Done",
        priority: 1,
      },
    ]);
    expect(stringifyWorkspaceDatabase(parsed.database)).toContain(
      "row-high: High body",
    );
  });
});
