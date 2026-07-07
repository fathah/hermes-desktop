import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let home: string;
const PROFILE = "default";
let activeWorkRuns: typeof import("../src/main/active-work-runs");

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "sps-active-work-"));
  process.env.HERMES_HOME = home;
  vi.resetModules();
  activeWorkRuns = await import("../src/main/active-work-runs");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("active work runs sidecar", () => {
  it("returns [] when no sidecar exists", async () => {
    expect(await activeWorkRuns.listActiveWorkRuns(PROFILE)).toEqual([]);
  });

  it("creates a running SPS work record with criteria", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      {
        source: "sps-work",
        title: "Work: launch plan",
        goal: "Execute the launch plan",
        pageId: "page-1",
        pageTitle: "Launch plan",
        clientRunId: "run-1",
        criteria: [
          { text: "Build it", done: false },
          { text: "Verify it", done: true },
        ],
      },
      PROFILE,
    );

    expect(run.status).toBe("running");
    expect(run.criteria).toHaveLength(2);
    expect(run.createdAt).toBeGreaterThan(0);
    expect(await activeWorkRuns.listActiveWorkRuns(PROFILE)).toEqual([run]);
  });

  it("updates status, session id, tool, and completion fields", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      {
        source: "goal",
        title: "Goal: fix tests",
        goal: "Fix failing tests",
        clientRunId: "run-2",
      },
      PROFILE,
    );

    const updated = await activeWorkRuns.updateActiveWorkRun(
      run.id,
      {
        sessionId: "sess-2",
        lastTool: "terminal",
        status: "completed",
        summary: "Tests pass",
        completedAt: 123,
      },
      PROFILE,
    );

    expect(updated?.sessionId).toBe("sess-2");
    expect(updated?.lastTool).toBe("terminal");
    expect(updated?.status).toBe("completed");
    expect(updated?.summary).toBe("Tests pass");
    expect(updated?.completedAt).toBe(123);
  });

  it("returns null when updating a missing run", async () => {
    expect(
      await activeWorkRuns.updateActiveWorkRun(
        "missing",
        { status: "stopped" },
        PROFILE,
      ),
    ).toBeNull();
  });

  it("treats corrupt JSON as empty instead of crashing", async () => {
    const dir = join(home, "sps-agent");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "active-work-runs.json");
    writeFileSync(p, "{not json", "utf-8");
    expect(await activeWorkRuns.listActiveWorkRuns(PROFILE)).toEqual([]);
  });

  it("gets a run by id", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      { source: "kanban", title: "Task", goal: "Do task", taskId: "t_123" },
      PROFILE,
    );
    expect(await activeWorkRuns.getActiveWorkRun(run.id, PROFILE)).toEqual(run);
    expect(await activeWorkRuns.getActiveWorkRun("nope", PROFILE)).toBeNull();
  });
});
