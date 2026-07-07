import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-agent-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);
const ORIGINAL_TZ = process.env.TZ;

async function freshConfig(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  process.env.TZ = "America/New_York";
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Hermes Agent update routine state", () => {
  it("defaults to a daily 4 AM local check with auto-apply off", async () => {
    const { getHermesAgentUpdateRoutine } = await freshConfig(TEST_DIR);

    const state = getHermesAgentUpdateRoutine(
      "work",
      new Date("2026-06-20T07:00:00.000Z"),
    );

    expect(state.enabled).toBe(true);
    expect(state.autoApply).toBe(false);
    expect(state.engineUpdateChannel).toBe("release");
    expect(state.timezone).toBe("America/New_York");
    expect(state.schedule).toBe("0 4 * * *");
    expect(state.nextCheckAt).toBe("2026-06-20T08:00:00.000Z");
    expect(state.lastResult).toBeNull();
    expect(state.autoApplySuppressed).toBe(false);
    expect(state.autoApplySuppressionReason).toBeNull();
    expect(state.autoApplySuppressedAt).toBeNull();
    expect(state.autoApplySuppressedSha).toBeNull();
  });

  it("persists per-profile settings without sharing auto-apply or channel", async () => {
    const { getHermesAgentUpdateRoutine, setHermesAgentUpdateRoutine } =
      await freshConfig(TEST_DIR);

    setHermesAgentUpdateRoutine(
      { autoApply: true, engineUpdateChannel: "main" },
      "work",
    );

    const workState = getHermesAgentUpdateRoutine(
      "work",
      new Date("2026-06-20T23:00:00.000Z"),
    );
    const personalState = getHermesAgentUpdateRoutine(
      "personal",
      new Date("2026-06-20T23:00:00.000Z"),
    );

    expect(workState.autoApply).toBe(true);
    expect(workState.engineUpdateChannel).toBe("main");
    expect(personalState.autoApply).toBe(false);
    expect(personalState.engineUpdateChannel).toBe("release");
  });

  it("ignores invalid persisted update channels", async () => {
    const { getHermesAgentUpdateRoutine, setHermesAgentUpdateRoutine } =
      await freshConfig(TEST_DIR);

    setHermesAgentUpdateRoutine({ engineUpdateChannel: "main" }, "work");
    setHermesAgentUpdateRoutine(
      { engineUpdateChannel: "invalid" as "main" },
      "work",
    );

    const state = getHermesAgentUpdateRoutine(
      "work",
      new Date("2026-06-20T23:00:00.000Z"),
    );
    expect(state.engineUpdateChannel).toBe("main");
  });

  it("persists contract-break suppression until explicit acknowledgement", async () => {
    const {
      acknowledgeHermesAgentUpdateContractBreak,
      getHermesAgentUpdateRoutine,
      setHermesAgentUpdateRoutine,
      suppressHermesAgentUpdateAutoApply,
    } = await freshConfig(TEST_DIR);

    setHermesAgentUpdateRoutine({ autoApply: true }, "work");
    suppressHermesAgentUpdateAutoApply(
      "contract-broken",
      "def4567890abcdef1234567890abcdef12345678",
      "2026-06-20T23:05:00.000Z",
      "work",
    );

    const suppressed = getHermesAgentUpdateRoutine(
      "work",
      new Date("2026-06-20T23:10:00.000Z"),
    );
    expect(suppressed.autoApply).toBe(true);
    expect(suppressed.autoApplySuppressed).toBe(true);
    expect(suppressed.autoApplySuppressionReason).toBe("contract-broken");
    expect(suppressed.autoApplySuppressedAt).toBe("2026-06-20T23:05:00.000Z");
    expect(suppressed.autoApplySuppressedSha).toBe(
      "def4567890abcdef1234567890abcdef12345678",
    );

    setHermesAgentUpdateRoutine({ autoApply: false }, "work");
    expect(getHermesAgentUpdateRoutine("work").autoApplySuppressed).toBe(true);

    const acknowledged = acknowledgeHermesAgentUpdateContractBreak("work");
    expect(acknowledged.autoApplySuppressed).toBe(false);
    expect(acknowledged.autoApplySuppressionReason).toBeNull();
    expect(acknowledged.autoApplySuppressedAt).toBeNull();
    expect(acknowledged.autoApplySuppressedSha).toBeNull();
    expect(acknowledged.autoApply).toBe(false);
  });

  it("records the latest check result and keeps the next check on the next local day", async () => {
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
    expect(state.nextCheckAt).toBe("2026-06-21T08:00:00.000Z");
  });

  it("decides due status by local calendar day", async () => {
    const { isHermesAgentUpdateRoutineDue } = await freshConfig(TEST_DIR);

    expect(
      isHermesAgentUpdateRoutineDue(
        { enabled: true, lastCheckedAt: null },
        new Date("2026-06-20T07:50:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isHermesAgentUpdateRoutineDue(
        { enabled: true, lastCheckedAt: null },
        new Date("2026-06-20T08:05:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isHermesAgentUpdateRoutineDue(
        {
          enabled: true,
          lastCheckedAt: "2026-06-20T08:05:00.000Z",
        },
        new Date("2026-06-20T23:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isHermesAgentUpdateRoutineDue(
        {
          enabled: true,
          lastCheckedAt: "2026-06-20T08:05:00.000Z",
        },
        new Date("2026-06-21T08:05:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isHermesAgentUpdateRoutineDue(
        { enabled: false, lastCheckedAt: null },
        new Date("2026-06-20T08:05:00.000Z"),
      ),
    ).toBe(false);
  });
});
