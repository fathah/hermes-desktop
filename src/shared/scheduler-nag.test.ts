import { describe, expect, it } from "vitest";
import {
  planNagActions,
  type NagTaskMeta,
  type TaskNagRecord,
} from "./tasks-dump";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function record(over: Partial<TaskNagRecord>): TaskNagRecord {
  return {
    rowId: "tasks/t1",
    nagCount: 0,
    nextNagAt: NOW - DAY, // due by default
    cadence: "daily",
    ...over,
  };
}

function meta(over: Partial<NagTaskMeta> = {}): NagTaskMeta {
  return {
    title: "Follow up with the secretary",
    done: false,
    autoSendOnEscalate: false,
    ...over,
  };
}

describe("planNagActions", () => {
  it("fires a due nag at the count's escalation tier and advances it", () => {
    const plan = planNagActions(
      [record({ nagCount: 2 })],
      { "tasks/t1": meta() },
      NOW,
    );
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      rowId: "tasks/t1",
      tier: "notification",
      autoSend: false,
    });
    expect(plan.advanced[0].nagCount).toBe(3);
    expect(plan.staleIds).toEqual([]);
  });

  it("does not fire a nag that is not yet due", () => {
    const plan = planNagActions(
      [record({ nextNagAt: NOW + DAY })],
      { "tasks/t1": meta() },
      NOW,
    );
    expect(plan.actions).toEqual([]);
    expect(plan.advanced).toEqual([]);
  });

  it("drops the record when the task is done or missing", () => {
    const done = planNagActions(
      [record({})],
      { "tasks/t1": meta({ done: true }) },
      NOW,
    );
    expect(done.actions).toEqual([]);
    expect(done.staleIds).toEqual(["tasks/t1"]);

    const missing = planNagActions([record({})], {}, NOW);
    expect(missing.staleIds).toEqual(["tasks/t1"]);
  });

  it("carries autoSend + assignee through to the channel tier", () => {
    const plan = planNagActions(
      [record({ nagCount: 5 })],
      {
        "tasks/t1": meta({ autoSendOnEscalate: true, assigneeId: "p-wife" }),
      },
      NOW,
    );
    expect(plan.actions[0]).toMatchObject({
      tier: "channel",
      autoSend: true,
      assigneeId: "p-wife",
    });
  });
});
