import { describe, expect, it } from "vitest";
import { PRIO_RANK, parseDue, parseDueParts } from "../src/tasks/taskUtils";
import type { Task } from "../src/types";

describe("task due-date parsing + sort", () => {
  it("parses month/day", () => {
    expect(parseDueParts("Jun 4")).toEqual({ mon: 5, day: 4 });
    expect(parseDueParts("May 30")).toEqual({ mon: 4, day: 30 });
    expect(parseDueParts("nonsense")).toBeNull();
  });

  it("orders due dates chronologically", () => {
    expect(parseDue("May 30")).toBeLessThan(parseDue("Jun 4"));
    expect(parseDue("Jun 4")).toBeLessThan(parseDue("Jun 9"));
  });

  it("ranks priorities high < med < low", () => {
    expect(PRIO_RANK.high).toBeLessThan(PRIO_RANK.med);
    expect(PRIO_RANK.med).toBeLessThan(PRIO_RANK.low);
  });

  it("sorts a task list by priority", () => {
    const tasks: Pick<Task, "prio">[] = [
      { prio: "low" },
      { prio: "high" },
      { prio: "med" },
    ];
    const sorted = [...tasks]
      .sort((a, b) => PRIO_RANK[a.prio] - PRIO_RANK[b.prio])
      .map((t) => t.prio);
    expect(sorted).toEqual(["high", "med", "low"]);
  });
});
