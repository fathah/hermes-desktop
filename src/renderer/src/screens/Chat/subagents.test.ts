import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applySubagentEvent,
  captureSubagentSnapshot,
  subagentScopeKey,
  clearSessionSubagents,
  getSubagents,
  isSubagentEvent,
  pruneFinishedSubagents,
  reconcileSubagentSnapshot,
  resetSubagents,
  subscribeSubagents,
} from "./subagents";

const SESSION = "20260926_011025_98eb58";

const event = (
  type: string,
  payload: Record<string, unknown>,
): { payload: Record<string, unknown>; type: string } => ({
  type,
  payload,
});

afterEach(() => {
  resetSubagents();
  vi.useRealTimers();
});

describe("subagent event projection", () => {
  it("claims only subagent events", () => {
    expect(isSubagentEvent("subagent.start")).toBe(true);
    expect(isSubagentEvent("message.delta")).toBe(false);
    // A non-subagent event is not ours, so the caller keeps handling it.
    expect(
      applySubagentEvent(SESSION, event("message.delta", { text: "hi" })),
    ).toBe(false);
    expect(getSubagents(SESSION)).toEqual([]);
  });

  it("creates a running row from subagent.start", () => {
    expect(
      applySubagentEvent(
        SESSION,
        event("subagent.start", {
          subagent_id: "sub-1",
          goal: "Audit the auth module",
          task_index: 1,
          task_count: 3,
          model: "sonnet",
        }),
      ),
    ).toBe(true);

    const rows = getSubagents(SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "sub-1",
      goal: "Audit the auth module",
      status: "running",
      taskIndex: 1,
      taskCount: 3,
      model: "sonnet",
      parentId: null,
    });
    expect(rows[0].startedAt).toBeGreaterThan(0);
  });

  it("keeps one row per child and folds later events into it", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.progress", {
        subagent_id: "sub-1",
        text: "🔀 [1/2] read_file, grep",
      }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.tool", {
        subagent_id: "sub-1",
        tool_name: "read_file",
        tool_preview: "src/auth.ts",
      }),
    );

    const rows = getSubagents(SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0].currentTool).toBe("read_file");
    expect(rows[0].stream.map((entry) => entry.text)).toEqual([
      "🔀 [1/2] read_file, grep",
      'Read File("src/auth.ts")',
    ]);
  });

  it("does not append the same line twice", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );
    const progress = event("subagent.progress", {
      subagent_id: "sub-1",
      text: "still working",
    });
    applySubagentEvent(SESSION, progress);
    applySubagentEvent(SESSION, progress);

    expect(getSubagents(SESSION)[0].stream).toHaveLength(1);
  });

  it("completes a row with its summary and clears the active tool", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.tool", { subagent_id: "sub-1", tool_name: "grep" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.complete", {
        subagent_id: "sub-1",
        status: "completed",
        summary: "Found 3 issues",
        duration_seconds: 42.5,
      }),
    );

    const row = getSubagents(SESSION)[0];
    expect(row.status).toBe("completed");
    expect(row.summary).toBe("Found 3 issues");
    expect(row.durationSeconds).toBe(42.5);
    expect(row.currentTool).toBeUndefined();
    expect(row.stream.at(-1)).toMatchObject({
      kind: "summary",
      text: "Found 3 issues",
    });
  });

  it("maps failure and cancellation statuses onto the row status", () => {
    const statuses: Array<[string, string]> = [
      ["timeout", "failed"],
      ["error", "failed"],
      ["cancelled", "interrupted"],
      ["canceled", "interrupted"],
      ["failed", "failed"],
    ];
    statuses.forEach(([wire, expected], index) => {
      const id = `sub-${index}`;
      applySubagentEvent(
        SESSION,
        event("subagent.start", { subagent_id: id, goal: "Task" }),
      );
      applySubagentEvent(
        SESSION,
        event("subagent.complete", {
          subagent_id: id,
          status: wire,
          duration_seconds: 12.3,
        }),
      );
      expect(getSubagents(SESSION).find((row) => row.id === id)?.status).toBe(
        expected,
      );
    });
  });

  it("fails a completion that reports no terminal status", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );
    // A completion event is terminal by definition: an unrecognized status must
    // not leave a dead row spinning as "running" forever.
    applySubagentEvent(
      SESSION,
      event("subagent.complete", { subagent_id: "sub-1", status: "running" }),
    );

    expect(getSubagents(SESSION)[0].status).toBe("failed");
  });

  it("synthesizes a timeout summary from duration_seconds", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.complete", {
        subagent_id: "sub-1",
        status: "timeout",
        duration_seconds: 612.3,
      }),
    );

    const row = getSubagents(SESSION)[0];
    expect(row.summary).toBe("Timed out after 612.3s");
    expect(row.stream.at(-1)).toMatchObject({
      isError: true,
      text: "Timed out after 612.3s",
    });
  });

  it("ignores events it cannot attribute to a session", () => {
    applySubagentEvent(null, event("subagent.start", { subagent_id: "sub-1" }));
    applySubagentEvent(
      SESSION,
      event(
        "subagent.start",
        "not-a-payload" as unknown as Record<string, unknown>,
      ),
    );

    expect(getSubagents(SESSION)).toEqual([]);
  });

  it("keeps each session's roster separate", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "a", goal: "Mine" }),
    );
    applySubagentEvent(
      "other-session",
      event("subagent.start", { subagent_id: "b", goal: "Theirs" }),
    );

    expect(getSubagents(SESSION).map((row) => row.goal)).toEqual(["Mine"]);
    expect(getSubagents("other-session").map((row) => row.goal)).toEqual([
      "Theirs",
    ]);
    expect(getSubagents(null)).toEqual([]);
  });

  it("derives a stable id when the payload carries none", () => {
    const payload = { goal: "Unnamed child", task_index: 2 };
    applySubagentEvent(SESSION, event("subagent.start", payload));
    applySubagentEvent(
      SESSION,
      event("subagent.progress", { ...payload, text: "step" }),
    );

    const rows = getSubagents(SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("root:2:Unnamed child");
  });

  it("notifies subscribers only when rows change", () => {
    let notifications = 0;
    const unsubscribe = subscribeSubagents(() => {
      notifications += 1;
    });

    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );
    const afterStart = notifications;
    // Same payload, same stream: a no-op must not re-render the roster.
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );

    expect(afterStart).toBe(1);
    expect(notifications).toBe(1);

    unsubscribe();
    applySubagentEvent(
      SESSION,
      event("subagent.complete", { subagent_id: "sub-1", status: "completed" }),
    );
    expect(notifications).toBe(1);
  });

  it("returns a stable array for an unchanged session", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );

    expect(getSubagents(SESSION)).toBe(getSubagents(SESSION));
  });
});

describe("subagent roster reconciliation", () => {
  it("seeds a cold row from the roster's last tool without a live stream", () => {
    reconcileSubagentSnapshot(SESSION, [
      {
        accepting_steer: true,
        goal: "Cold child",
        last_tool: "read_file",
        parent_id: "parent-1",
        started_at: 1_700_000_000,
        status: "running",
        subagent_id: "sub-1",
        tool_count: 4,
      },
    ]);

    const row = getSubagents(SESSION)[0];
    expect(row).toMatchObject({
      goal: "Cold child",
      id: "sub-1",
      parentId: "parent-1",
      status: "running",
      toolCount: 4,
    });
    expect(row.startedAt).toBe(1_700_000_000_000);
    expect(row.stream.map((entry) => entry.text)).toEqual(["Read File"]);
  });

  it("never overwrites a live stream with a repeat snapshot", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.progress", {
        subagent_id: "sub-1",
        text: "auth.ts:42 failing",
      }),
    );

    reconcileSubagentSnapshot(SESSION, [
      {
        goal: "Task",
        last_tool: "grep",
        status: "running",
        subagent_id: "sub-1",
      },
    ]);

    expect(getSubagents(SESSION)[0].stream.map((entry) => entry.text)).toEqual([
      "auth.ts:42 failing",
    ]);
  });

  it("retires a live row the roster no longer reports", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "gone", goal: "Vanished" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "done", goal: "Finished" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.complete", { subagent_id: "done", status: "completed" }),
    );

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_001);
    reconcileSubagentSnapshot(SESSION, []);
    // Repeated absence after the start grace retires the identified child.
    reconcileSubagentSnapshot(SESSION, [
      { goal: "Sibling", status: "running", subagent_id: "sibling" },
    ]);

    expect(getSubagents(SESSION).map((row) => row.id)).toEqual([
      "done",
      "sibling",
    ]);
  });

  it("keeps live rows when the roster is empty", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Just started" }),
    );

    // `subagent.start` is relayed before the child registers, so an empty
    // snapshot must not retire the row the live event just created.
    reconcileSubagentSnapshot(SESSION, []);

    expect(getSubagents(SESSION).map((row) => row.id)).toEqual(["sub-1"]);
  });

  it("keeps a row whose identity is only derived", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { goal: "No id", task_index: 1 }),
    );

    reconcileSubagentSnapshot(SESSION, [
      { goal: "Sibling", status: "running", subagent_id: "sibling" },
    ]);

    expect(getSubagents(SESSION).map((row) => row.goal)).toEqual([
      "No id",
      "Sibling",
    ]);
  });

  it("does not resurrect a terminal row from a stale roster", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "sub-1", goal: "Task" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.complete", {
        subagent_id: "sub-1",
        status: "completed",
        summary: "done",
      }),
    );

    reconcileSubagentSnapshot(SESSION, [
      { goal: "Task", status: "running", subagent_id: "sub-1" },
    ]);

    expect(getSubagents(SESSION)[0].status).toBe("completed");
    expect(getSubagents(SESSION)[0].summary).toBe("done");
  });

  it("skips roster entries without a subagent id", () => {
    reconcileSubagentSnapshot(SESSION, [
      { goal: "No id here", status: "running" },
    ]);

    expect(getSubagents(SESSION)).toEqual([]);
  });
});

describe("subagent row lifecycle", () => {
  it("prunes finished rows at a new turn but keeps live children", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "live", goal: "Still going" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "done", goal: "Finished" }),
    );
    applySubagentEvent(
      SESSION,
      event("subagent.complete", { subagent_id: "done", status: "completed" }),
    );

    pruneFinishedSubagents(SESSION);

    expect(getSubagents(SESSION).map((row) => row.id)).toEqual(["live"]);
  });

  it("clears a session's roster without touching other sessions", () => {
    applySubagentEvent(
      SESSION,
      event("subagent.start", { subagent_id: "a", goal: "Mine" }),
    );
    applySubagentEvent(
      "other-session",
      event("subagent.start", { subagent_id: "b", goal: "Theirs" }),
    );

    clearSessionSubagents(SESSION);

    expect(getSubagents(SESSION)).toEqual([]);
    expect(getSubagents("other-session")).toHaveLength(1);
  });
});

describe("captured gateway frames", () => {
  // Payloads captured from a live `hermes dashboard` /api/ws session while a
  // delegate_task fan-out ran (toolsets trimmed: the projection ignores them).
  // They pin the projection to the real wire shape, not to an idealized one.
  const frame = (
    type: string,
    payload: Record<string, unknown>,
  ): {
    payload: Record<string, unknown>;
    session_id: string;
    type: string;
  } => ({
    payload,
    session_id: "484ef7cb",
    type,
  });

  it("projects a real subagent.start/tool/complete sequence", () => {
    const base = {
      child_session_id: "20260926_025109_9d7b56",
      delegation_id: "deleg_fe8cf13c",
      depth: 0,
      goal: "Run exactly one trivial shell command using terminal: `echo alpha`.",
      model: "gpt-6-sol-900k",
      subagent_id: "sa-0-c6a08df3",
      task_count: 2,
      task_index: 0,
    };

    applySubagentEvent(SESSION, frame("subagent.start", base));
    applySubagentEvent(
      SESSION,
      frame("subagent.tool", {
        ...base,
        tool_count: 1,
        tool_name: "terminal",
        text: "echo alpha",
        tool_preview: "echo alpha",
      }),
    );
    applySubagentEvent(
      SESSION,
      frame("subagent.complete", {
        ...base,
        duration_seconds: 5.43,
        status: "completed",
        summary: "alpha",
        tool_count: 1,
      }),
    );

    const rows = getSubagents(SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delegationId: "deleg_fe8cf13c",
      durationSeconds: 5.43,
      goal: base.goal,
      id: "sa-0-c6a08df3",
      sessionId: "20260926_025109_9d7b56",
      status: "completed",
      summary: "alpha",
      taskCount: 2,
      taskIndex: 0,
    });
    expect(rows[0].stream.map((entry) => entry.text)).toEqual([
      'Terminal("echo alpha")',
      "alpha",
    ]);
  });

  it("splits a two-task fan-out into two rows and hydrates from the roster", () => {
    const first = {
      goal: "Run echo alpha",
      subagent_id: "sa-0-c6a08df3",
      task_count: 2,
      task_index: 0,
    };
    const second = {
      goal: "Run echo beta",
      subagent_id: "sa-1-dedaf69f",
      task_count: 2,
      task_index: 1,
    };
    applySubagentEvent(SESSION, frame("subagent.start", first));
    applySubagentEvent(SESSION, frame("subagent.start", second));

    // The roster RPC answers in epoch SECONDS with a `last_tool` instead of a
    // stream — the projection must land both on the same rows.
    reconcileSubagentSnapshot(SESSION, [
      {
        accepting_steer: true,
        goal: first.goal,
        last_tool: "terminal",
        parent_id: null,
        started_at: 1_790_387_469.7,
        status: "running",
        subagent_id: first.subagent_id,
        tool_count: 1,
      },
      {
        accepting_steer: true,
        goal: second.goal,
        last_tool: "terminal",
        parent_id: null,
        started_at: 1_790_387_469.7,
        status: "running",
        subagent_id: second.subagent_id,
        tool_count: 1,
      },
    ]);

    const rows = getSubagents(SESSION);
    expect(rows.map((row) => row.id)).toEqual([
      "sa-0-c6a08df3",
      "sa-1-dedaf69f",
    ]);
    // A live row keeps the start time its own event established: the roster's
    // epoch-seconds value only seeds a row that has none.
    expect(rows[0].startedAt).toBeGreaterThan(1_790_387_469_700);
    expect(rows[0].stream.map((entry) => entry.text)).toEqual(["Terminal"]);
    expect(rows[1].goal).toBe("Run echo beta");
  });
});

// @lat: [[subagents#Recovery regressions#Registration gap]]
it("keeps a new child's controls when a nonempty roster omits it during registration", () => {
  applySubagentEvent(
    SESSION,
    event("subagent.start", { subagent_id: "new", goal: "New" }),
  );
  reconcileSubagentSnapshot(SESSION, [
    { subagent_id: "old", goal: "Older sibling", status: "running" },
  ]);
  expect(getSubagents(SESSION).map((row) => row.id)).toEqual(["new", "old"]);
});

// @lat: [[subagents#Recovery regressions#Missed completion]]
it("retires an identified child after two successful empty polls with the final poll beyond the start grace", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  applySubagentEvent(
    SESSION,
    event("subagent.start", { subagent_id: "ended" }),
  );
  reconcileSubagentSnapshot(SESSION, []);
  expect(getSubagents(SESSION)).toHaveLength(1);
  vi.setSystemTime(110_001);
  reconcileSubagentSnapshot(SESSION, []);
  expect(getSubagents(SESSION)).toEqual([]);
});

// @lat: [[subagents#Recovery regressions#Snapshot ordering]]
it("keeps events newer than a request and rejects older snapshot completions", () => {
  const old = captureSubagentSnapshot(SESSION);
  applySubagentEvent(
    SESSION,
    event("subagent.start", { subagent_id: "new", goal: "Current event" }),
  );
  reconcileSubagentSnapshot(
    SESSION,
    [{ subagent_id: "new", goal: "Old snapshot", status: "queued" }],
    old,
  );
  expect(getSubagents(SESSION)[0]).toMatchObject({
    goal: "Current event",
    status: "running",
  });
  const older = captureSubagentSnapshot(SESSION);
  const newer = captureSubagentSnapshot(SESSION);
  reconcileSubagentSnapshot(
    SESSION,
    [{ subagent_id: "new", goal: "New snapshot", status: "running" }],
    newer,
  );
  reconcileSubagentSnapshot(
    SESSION,
    [{ subagent_id: "new", goal: "Stale snapshot", status: "queued" }],
    older,
  );
  expect(getSubagents(SESSION)[0].goal).toBe("New snapshot");
});

// @lat: [[subagents#Recovery regressions#Target isolation]]
it("isolates the same durable session across connections, profiles and config revisions", () => {
  const scopes = [
    subagentScopeKey("a", "work", SESSION),
    subagentScopeKey("b", "work", SESSION),
    subagentScopeKey("a", "other", SESSION),
    subagentScopeKey("a", "work", SESSION, 1),
  ];
  scopes.forEach((scope, i) =>
    applySubagentEvent(
      scope,
      event("subagent.start", {
        subagent_id: "same-child",
        goal: `Target ${i}`,
      }),
    ),
  );
  scopes.forEach((scope, i) =>
    expect(getSubagents(scope)[0].goal).toBe(`Target ${i}`),
  );
});

// @lat: [[subagents#Recovery regressions#Finished row fencing]]
it("keeps terminal evidence after pruning so late snapshots and progress cannot revive controls", () => {
  applySubagentEvent(SESSION, event("subagent.start", { subagent_id: "done" }));
  const old = captureSubagentSnapshot(SESSION);
  applySubagentEvent(
    SESSION,
    event("subagent.complete", { subagent_id: "done", status: "completed" }),
  );
  pruneFinishedSubagents(SESSION);
  const running = [{ subagent_id: "done", status: "running" }];
  reconcileSubagentSnapshot(SESSION, running, old);
  reconcileSubagentSnapshot(SESSION, running);
  applySubagentEvent(
    SESSION,
    event("subagent.progress", { subagent_id: "done", text: "late" }),
  );
  expect(getSubagents(SESSION)).toEqual([]);
  applySubagentEvent(
    SESSION,
    event("subagent.start", { subagent_id: "done", goal: "New delegation" }),
  );
  expect(getSubagents(SESSION)[0]).toMatchObject({
    goal: "New delegation",
    status: "running",
    stream: [],
  });
});

// @lat: [[subagents#Recovery regressions#Snapshot terminal fencing]]
it.each([false, true])(
  "keeps terminal snapshot evidence after pruning (previously running: %s)",
  (running) => {
    if (running)
      reconcileSubagentSnapshot(SESSION, [
        { subagent_id: "done", status: "running" },
      ]);
    reconcileSubagentSnapshot(SESSION, [
      { subagent_id: "done", status: "completed" },
    ]);
    expect(getSubagents(SESSION)[0].status).toBe("completed");
    pruneFinishedSubagents(SESSION);
    reconcileSubagentSnapshot(SESSION, [
      { subagent_id: "done", status: "running" },
    ]);
    applySubagentEvent(
      SESSION,
      event("subagent.progress", { subagent_id: "done", text: "late" }),
    );
    expect(getSubagents(SESSION)).toEqual([]);
  },
);
