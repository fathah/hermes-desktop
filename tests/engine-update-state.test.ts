import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-engine-update-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

async function freshEngineUpdateState(): Promise<
  typeof import("../src/main/engine-update-state")
> {
  vi.resetModules();
  return await import("../src/main/engine-update-state");
}

function desktopJsonPath(): string {
  return join(TEST_DIR, "desktop.json");
}

beforeEach(() => {
  process.env.HERMES_HOME = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("engine update state owner", () => {
  it("normalizes legacy routine and capability shapes into one aggregate", async () => {
    writeFileSync(
      desktopJsonPath(),
      JSON.stringify(
        {
          hermesAgentUpdateByProfile: {
            work: {
              enabled: true,
              autoApply: true,
              engineUpdateChannel: "main",
              lastCheckedAt: "2026-07-07T01:00:00.000Z",
              lastResult: {
                checkedAt: "2026-07-07T01:00:00.000Z",
                status: "available",
                message: "Hermes Agent update available.",
                localHead: "old-sha",
                upstreamHead: "new-sha",
                changelog: "v1.2.3",
                updateChannel: "release",
                releaseTag: "v1.2.3",
                releaseSha: "new-sha",
              },
              autoApplySuppressed: true,
              autoApplySuppressionReason: "contract-broken",
              autoApplySuppressedAt: "2026-07-07T01:05:00.000Z",
              autoApplySuppressedSha: "broken-sha",
            },
          },
          engineCapabilitiesByProfile: {
            work: {
              installedSha: "new-sha",
              lastVerifiedSha: "old-sha",
              lastVerification: {
                checkedAt: "2026-07-07T01:03:00.000Z",
                status: "broken",
                findings: [],
              },
              snapshot: {
                status: "ready",
                fetchedAt: "2026-07-07T01:02:00.000Z",
                mode: "local",
                engineSha: "new-sha",
                features: {},
                endpoints: {},
              },
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { getEngineUpdateState } = await freshEngineUpdateState();
    const state = getEngineUpdateState(
      "work",
      new Date("2026-07-07T02:00:00.000Z"),
    );

    expect(state.profileKey).toBe("work");
    expect(state.installedSha).toBe("new-sha");
    expect(state.engineUpdateChannel).toBe("main");
    expect(state.latestReleaseSeen).toEqual({
      tag: "v1.2.3",
      sha: "new-sha",
      seenAt: "2026-07-07T01:00:00.000Z",
    });
    expect(state.pendingUpdate).toMatchObject({
      checkedAt: "2026-07-07T01:00:00.000Z",
      status: "available",
      message: "Hermes Agent update available.",
      upstreamHead: "new-sha",
      releaseTag: "v1.2.3",
      releaseSha: "new-sha",
    });
    expect(state.lastVerifiedSha).toBe("old-sha");
    expect(state.lastContractResult?.status).toBe("broken");
    expect(state.autoApplySuppressed).toBe(true);
    expect(state.autoApplySuppressionReason).toBe("contract-broken");
    expect(state.autoApplySuppressedSha).toBe("broken-sha");
    expect(state.lastNotification).toBeNull();
  });

  it("records update results and notification state under existing desktop keys", async () => {
    const {
      getEngineUpdateState,
      recordEngineUpdateNotification,
      recordHermesAgentUpdateResult,
    } = await freshEngineUpdateState();

    recordHermesAgentUpdateResult(
      {
        checkedAt: "2026-07-07T03:00:00.000Z",
        status: "available",
        message: "Hermes Agent update available.",
        localHead: "old-sha",
        upstreamHead: "new-sha",
        updateChannel: "release",
        releaseTag: "v1.2.3",
        releaseSha: "new-sha",
      },
      "work",
    );
    recordEngineUpdateNotification(
      {
        notifiedAt: "2026-07-07T03:01:00.000Z",
        status: "available",
        message: "Owner saw the update.",
        sha: "new-sha",
      },
      "work",
    );

    const raw = JSON.parse(readFileSync(desktopJsonPath(), "utf-8")) as {
      hermesAgentUpdateByProfile: Record<string, Record<string, unknown>>;
    };
    expect(raw.hermesAgentUpdateByProfile.work.lastResult).toMatchObject({
      status: "available",
      releaseTag: "v1.2.3",
      releaseSha: "new-sha",
    });
    expect(raw.hermesAgentUpdateByProfile.work.latestReleaseSeen).toEqual({
      tag: "v1.2.3",
      sha: "new-sha",
      seenAt: "2026-07-07T03:00:00.000Z",
    });
    expect(raw.hermesAgentUpdateByProfile.work.lastNotification).toEqual({
      notifiedAt: "2026-07-07T03:01:00.000Z",
      status: "available",
      message: "Owner saw the update.",
      sha: "new-sha",
    });

    const state = getEngineUpdateState(
      "work",
      new Date("2026-07-07T03:02:00.000Z"),
    );
    expect(state.latestReleaseSeen?.tag).toBe("v1.2.3");
    expect(state.pendingUpdate?.status).toBe("available");
    expect(state.lastNotification?.notifiedAt).toBe("2026-07-07T03:01:00.000Z");
  });
});
