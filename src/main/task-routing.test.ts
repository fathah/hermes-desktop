import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the heavy/native edges so this stays a pure unit test. createNagRecord
// (pure, from shared/tasks-dump) is left real.
vi.mock("./kanban", () => ({ createTask: vi.fn() }));
vi.mock("./tasks-dump", () => ({ setNagRecord: vi.fn() }));

import { createTask } from "./kanban";
import { setNagRecord } from "./tasks-dump";
import { routeTask } from "./task-routing";
import type { RouteTaskInput, TaskTriageResult } from "../shared/tasks-dump";

function input(triage: Partial<TaskTriageResult>): RouteTaskInput {
  return {
    rowId: "tasks/t1",
    title: "Do the thing",
    body: "",
    triage: { route: "human", ...triage } as TaskTriageResult,
  };
}

describe("routeTask", () => {
  beforeEach(() => {
    vi.mocked(createTask).mockReset();
    vi.mocked(setNagRecord).mockReset();
  });

  it("dispatches a non-risky AI task to Kanban and stores the id", async () => {
    vi.mocked(createTask).mockResolvedValue({
      success: true,
      data: { id: "k-42" },
    });
    const outcome = await routeTask(input({ route: "ai", risky: false }));
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ triage: true, goalMode: true }),
      undefined,
    );
    expect(outcome).toMatchObject({
      route: "ai",
      status: "doing",
      delegatedTo: "k-42",
      dispatched: true,
    });
    expect(setNagRecord).not.toHaveBeenCalled();
  });

  it("falls back to the human lane (with a nag) when dispatch fails", async () => {
    vi.mocked(createTask).mockResolvedValue({
      success: false,
      error: "hermes CLI not found",
    });
    const outcome = await routeTask(
      input({ route: "ai", risky: false, nagCadence: "weekly" }),
    );
    expect(outcome).toMatchObject({
      route: "human",
      status: "todo",
      dispatched: false,
      fellBackToHuman: true,
    });
    expect(setNagRecord).toHaveBeenCalledTimes(1);
    const record = vi.mocked(setNagRecord).mock.calls[0][0];
    expect(record).toMatchObject({ rowId: "tasks/t1", cadence: "weekly" });
  });

  it("holds a risky AI task for review without dispatching", async () => {
    const outcome = await routeTask(input({ route: "ai", risky: true }));
    expect(outcome).toMatchObject({
      route: "ai",
      status: "review",
      dispatched: false,
    });
    expect(createTask).not.toHaveBeenCalled();
    expect(setNagRecord).not.toHaveBeenCalled();
  });

  it("schedules the nag engine for a human task", async () => {
    const outcome = await routeTask(
      input({ route: "human", nagCadence: "daily" }),
    );
    expect(outcome).toMatchObject({ route: "human", status: "todo" });
    expect(setNagRecord).toHaveBeenCalledTimes(1);
    const record = vi.mocked(setNagRecord).mock.calls[0][0];
    expect(record).toMatchObject({
      rowId: "tasks/t1",
      cadence: "daily",
      nagCount: 0,
    });
  });
});
