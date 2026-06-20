import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-agent-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

async function freshConfig(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Hermes Agent update routine state", () => {
  it("defaults to a daily 4 AM IST check with auto-apply off", async () => {
    const { getHermesAgentUpdateRoutine } = await freshConfig(TEST_DIR);

    const state = getHermesAgentUpdateRoutine(
      "work",
      new Date("2026-06-20T21:00:00.000Z"),
    );

    expect(state.enabled).toBe(true);
    expect(state.autoApply).toBe(false);
    expect(state.timezone).toBe("Asia/Kolkata");
    expect(state.schedule).toBe("0 4 * * *");
    expect(state.nextCheckAt).toBe("2026-06-20T22:30:00.000Z");
    expect(state.lastResult).toBeNull();
  });

  it("persists per-profile settings without sharing auto-apply", async () => {
    const { getHermesAgentUpdateRoutine, setHermesAgentUpdateRoutine } =
      await freshConfig(TEST_DIR);

    setHermesAgentUpdateRoutine({ autoApply: true }, "work");

    expect(
      getHermesAgentUpdateRoutine(
        "work",
        new Date("2026-06-20T23:00:00.000Z"),
      ).autoApply,
    ).toBe(true);
    expect(
      getHermesAgentUpdateRoutine(
        "personal",
        new Date("2026-06-20T23:00:00.000Z"),
      ).autoApply,
    ).toBe(false);
  });

  it("records the latest check result and keeps the next check on the next IST day", async () => {
    const { getHermesAgentUpdateRoutine, recordHermesAgentUpdateResult } =
      await freshConfig(TEST_DIR);

    recordHermesAgentUpdateResult(
      {
        checkedAt: "2026-06-20T23:05:00.000Z",
        status: "available",
        message: "Update available",
        localHead: "abc123",
        upstreamHead: "def456",
        behindBy: 3,
        changelog: "def456 Add update",
      },
      "work",
    );

    const state = getHermesAgentUpdateRoutine(
      "work",
      new Date("2026-06-20T23:10:00.000Z"),
    );
    expect(state.lastCheckedAt).toBe("2026-06-20T23:05:00.000Z");
    expect(state.lastResult?.status).toBe("available");
    expect(state.nextCheckAt).toBe("2026-06-21T22:30:00.000Z");
  });

  it("decides due status by IST calendar day", async () => {
    const { isHermesAgentUpdateRoutineDue } = await freshConfig(TEST_DIR);

    expect(
      isHermesAgentUpdateRoutineDue(
        { enabled: true, lastCheckedAt: null },
        new Date("2026-06-20T22:20:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isHermesAgentUpdateRoutineDue(
        { enabled: true, lastCheckedAt: null },
        new Date("2026-06-20T22:35:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isHermesAgentUpdateRoutineDue(
        {
          enabled: true,
          lastCheckedAt: "2026-06-20T22:35:00.000Z",
        },
        new Date("2026-06-20T23:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isHermesAgentUpdateRoutineDue(
        { enabled: false, lastCheckedAt: null },
        new Date("2026-06-20T22:35:00.000Z"),
      ),
    ).toBe(false);
  });
});
