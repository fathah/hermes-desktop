import { describe, expect, it } from "vitest";
import {
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

    expect(parsed.database.version).toBe(1);
    expect(parsed.database.views.map((view) => view.type)).toEqual(["board"]);
    expect(parsed.database.items[0].id).toMatch(/^row-/);

    const output = stringifyWorkspaceDatabase(parsed.database);
    expect(output).toContain("version: 1");
    expect(output).toContain("views:");
    expect(output).toContain("id: row-");
  });
});
