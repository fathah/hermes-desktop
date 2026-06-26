// vaultRowToTask.test.ts — F1: the VaultRow → Task mapping is pure and total.
import { describe, expect, it } from "vitest";
import { vaultRowToTask } from "./vaultRowToTask";
import type { VaultRow } from "../hooks/useNoteIndex";

function row(overrides: Partial<VaultRow>): VaultRow {
  return { path: "db1/r1.md", title: "Row", props: {}, mtime: 1, ...overrides };
}

describe("vaultRowToTask", () => {
  it("uses row.path as the stable id", () => {
    expect(vaultRowToTask(row({ path: "db1/abc.md" })).id).toBe("db1/abc.md");
  });

  it("maps known props onto first-class Task fields", () => {
    const task = vaultRowToTask(
      row({
        title: "Patrol log",
        props: {
          status: "doing",
          prio: "high",
          who: "maya",
          due: "Jun 9",
          est: "2d",
        },
      }),
    );
    expect(task).toMatchObject({
      title: "Patrol log",
      status: "doing",
      prio: "high",
      who: "maya",
      due: "Jun 9",
      est: "2d",
    });
  });

  it("falls back to safe defaults for missing/unknown props", () => {
    const task = vaultRowToTask(row({ title: "", props: {} }));
    expect(task.title).toBe("Untitled");
    expect(task.status).toBe("todo");
    expect(task.prio).toBe("med");
    expect(task.who).toBe("");
    expect(task.due).toBe("");
    expect(task.est).toBe("");
  });

  it("coerces an invalid status/prio to the default rather than crashing", () => {
    const task = vaultRowToTask(
      row({ props: { status: "archived", prio: "urgent" } }),
    );
    expect(task.status).toBe("todo");
    expect(task.prio).toBe("med");
  });

  it("stringifies non-string scalars and routes unknown props to custom", () => {
    const task = vaultRowToTask(
      row({ props: { who: 42, region: "north", count: 3 } }),
    );
    expect(task.who).toBe("42");
    expect(task.custom).toEqual({ region: "north", count: "3" });
  });

  it("carries delegatedTo (the Kanban id) onto the task without leaking it into custom", () => {
    const task = vaultRowToTask(
      row({ props: { route: "ai", delegatedTo: "k-42" } }),
    );
    expect(task.delegatedTo).toBe("k-42");
    expect(task.custom).not.toHaveProperty("delegatedTo");
  });

  it("omits delegatedTo when the row has not been routed to an agent", () => {
    const task = vaultRowToTask(row({ props: { route: "human" } }));
    expect(task.delegatedTo).toBeUndefined();
  });
});
