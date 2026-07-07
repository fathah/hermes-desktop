import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  skips: {},
  jobs: [],
  desktopRoutine: {
    enabled: true,
    autoDownload: false,
    lastCheckedAt: null,
    nextCheckAt: null,
    lastResult: null,
  },
  agentRoutine: {
    enabled: true,
    autoApply: false,
    engineUpdateChannel: "release",
    lastCheckedAt: null,
    nextCheckAt: null,
    lastResult: null,
  },
  closedAppGateway: "",
  ownerDelivery: {
    status: "not-configured",
    summary: "No owner delivery attempts recorded yet.",
    lastDeliveredAt: null,
    lastError: null,
  },
}));

vi.mock("fs", () => {
  const fns = {
    existsSync: () => Boolean(state.closedAppGateway),
    readFileSync: () => state.closedAppGateway,
  };
  return { ...fns, default: fns };
});

vi.mock("../src/main/utils", () => ({
  profileHome: (profile?: string) => `/tmp/hermes/${profile ?? "default"}`,
}));

vi.mock("../src/main/scheduler", () => ({
  getSchedulerSkips: () => state.skips,
}));

vi.mock("../src/main/cronjobs", () => ({
  listCronJobs: () => Promise.resolve(state.jobs),
}));

vi.mock("../src/main/config", () => ({
  getDesktopUpdateRoutine: () => state.desktopRoutine,
}));

vi.mock("../src/main/engine-update-state", () => ({
  getHermesAgentUpdateRoutine: () => state.agentRoutine,
}));

vi.mock("../src/main/owner-delivery", () => ({
  getOwnerDeliverySummary: () => state.ownerDelivery,
}));

describe("getRoutinesStatus", () => {
  beforeEach(() => {
    state.skips = {};
    state.jobs = [];
    state.desktopRoutine = {
      enabled: true,
      autoDownload: false,
      lastCheckedAt: null,
      nextCheckAt: null,
      lastResult: null,
    };
    state.agentRoutine = {
      enabled: true,
      autoApply: false,
      engineUpdateChannel: "release",
      lastCheckedAt: null,
      nextCheckAt: null,
      lastResult: null,
    };
    state.closedAppGateway = "";
    state.ownerDelivery = {
      status: "not-configured",
      summary: "No owner delivery attempts recorded yet.",
      lastDeliveredAt: null,
      lastError: null,
    };
  });

  it("aggregates scheduler skips, owner jobs, update errors, and closed-app gateway state", async () => {
    state.skips = {
      job1: { skipCount: 2, lastSkipAt: 10, lastReason: "lock held" },
    };
    state.jobs = [
      {
        id: "owner1",
        name: "owner-routine:morning-brief",
        schedule: "0 7 * * *",
        prompt: "",
        state: "active",
        enabled: true,
        next_run_at: null,
        last_run_at: null,
        last_status: "failed",
        last_error: "gateway down",
        repeat: null,
        deliver: ["local"],
        skills: [],
        script: null,
      },
      {
        id: "other",
        name: "unrelated",
        schedule: "* * * * *",
        prompt: "",
        state: "active",
        enabled: true,
        next_run_at: null,
        last_run_at: null,
        last_status: "ok",
        last_error: null,
        repeat: null,
        deliver: ["local"],
        skills: [],
        script: null,
      },
    ];
    state.agentRoutine = {
      ...state.agentRoutine,
      lastResult: {
        status: "failed",
        checkedAt: "2026-07-07T00:00:00.000Z",
        error: "contract broken",
      },
    };
    state.closedAppGateway = JSON.stringify({
      status: "restart-failed",
      lastError: "missing python",
      lastCheckedAt: "2026-07-07T00:00:00.000Z",
    });
    const { getRoutinesStatus } = await import("../src/main/routines-status");

    const report = await getRoutinesStatus("default");

    expect(report.status).toBe("failure");
    expect(report.scheduler).toMatchObject({
      skipCount: 2,
      lastReason: "lock held",
    });
    expect(report.ownerRoutineJobs).toHaveLength(1);
    expect(report.ownerRoutineJobs[0].lastError).toBe("gateway down");
    expect(report.updateRoutines[1].lastError).toBe("contract broken");
    expect(report.closedAppGateway?.lastError).toBe("missing python");
  });

  it("includes owner delivery status in the panel severity", async () => {
    state.ownerDelivery = {
      status: "failed",
      summary: "Failed via email.",
      lastDeliveredAt: "2026-07-07T09:00:00.000Z",
      lastError: "email: send-failed",
    };
    const { getRoutinesStatus } = await import("../src/main/routines-status");

    const report = await getRoutinesStatus("default");

    expect(report.status).toBe("failure");
    expect(report.ownerDelivery.summary).toBe("Failed via email.");
    expect(report.ownerDelivery.lastError).toBe("email: send-failed");
  });
});
