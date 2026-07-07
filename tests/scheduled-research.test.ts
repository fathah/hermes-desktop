import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const state = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-sr-${Date.now()}`),
    gatewayFetch: vi.fn(),
  };
});

vi.mock("../src/main/utils", () => ({
  profileHome: () => state.TEST_HOME,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: state.TEST_HOME,
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
}));

vi.mock("../src/main/security/network-policy", () => ({
  gatewayFetch: state.gatewayFetch,
}));

vi.mock("../src/main/cronjobs", () => ({
  createCronJob: vi.fn(async () => ({ success: false })),
  removeCronJob: vi.fn(async () => ({ success: true })),
  pauseCronJob: vi.fn(async () => ({ success: true })),
  resumeCronJob: vi.fn(async () => ({ success: true })),
  listCronJobs: vi.fn(async () => []),
}));

import {
  createSchedule,
  listSchedules,
  triggerScheduleNow,
} from "../src/main/scheduled-research";

function gatewayTextResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => ({
      choices: [{ message: { content: text } }],
    }),
  } as unknown as Response;
}

describe("scheduled research failure visibility", () => {
  beforeEach(() => {
    rmSync(state.TEST_HOME, { recursive: true, force: true });
    mkdirSync(join(state.TEST_HOME, "sps-agent"), { recursive: true });
    state.gatewayFetch.mockReset();
  });

  afterEach(() => {
    rmSync(state.TEST_HOME, { recursive: true, force: true });
  });

  it("persists run failures on the schedule as lastError", async () => {
    state.gatewayFetch.mockResolvedValue(gatewayTextResponse("offline", 503));
    const created = await createSchedule({
      topic: "AI agents",
      cadence: "daily",
    });

    const result = await triggerScheduleNow(created.item!.id);

    expect(result).toEqual({
      outcome: "error",
      summary: "gateway 503: offline",
    });
    expect(listSchedules()[0].lastError).toBe("gateway 503: offline");
    expect(listSchedules()[0].lastRunAt).toBeGreaterThan(0);
  });

  it("clears a previous lastError after a non-error run", async () => {
    state.gatewayFetch
      .mockResolvedValueOnce(gatewayTextResponse("offline", 503))
      .mockResolvedValueOnce(gatewayTextResponse("No web access today."));
    const created = await createSchedule({
      topic: "AI agents",
      cadence: "daily",
    });

    await triggerScheduleNow(created.item!.id);
    await triggerScheduleNow(created.item!.id);

    expect(listSchedules()[0].lastError).toBeUndefined();
    expect(listSchedules()[0].lastRunAt).toBeGreaterThan(0);
  });
});
