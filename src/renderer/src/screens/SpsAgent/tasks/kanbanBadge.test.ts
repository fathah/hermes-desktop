// kanbanBadge.test.ts — the pure Kanban-status → badge mapping that decides
// what (if anything) a delegated task row shows for its agent's live state.
import { describe, expect, it } from "vitest";
import { kanbanStatusToBadge } from "./kanbanBadge";

describe("kanbanStatusToBadge", () => {
  it("maps a running agent task to a Running badge", () => {
    const badge = kanbanStatusToBadge("running");
    expect(badge).toEqual({ label: "Running", cls: "s-doing" });
  });

  it("collapses every queued state (triage/todo/ready) to one Queued badge", () => {
    for (const s of ["triage", "todo", "ready"]) {
      expect(kanbanStatusToBadge(s)).toEqual({
        label: "Queued",
        cls: "s-todo",
      });
    }
  });

  it("maps blocked and done to their own badges", () => {
    expect(kanbanStatusToBadge("blocked")).toMatchObject({ label: "Blocked" });
    expect(kanbanStatusToBadge("done")).toMatchObject({ label: "Done" });
  });

  it("is case- and whitespace-insensitive on the raw CLI status", () => {
    expect(kanbanStatusToBadge("  RUNNING ")).toMatchObject({
      label: "Running",
    });
  });

  it("hides the badge (null) for absent or unrecognized status", () => {
    expect(kanbanStatusToBadge(undefined)).toBeNull();
    expect(kanbanStatusToBadge(null)).toBeNull();
    expect(kanbanStatusToBadge("")).toBeNull();
    expect(kanbanStatusToBadge("archived")).toBeNull();
    expect(kanbanStatusToBadge("something-new")).toBeNull();
  });
});
