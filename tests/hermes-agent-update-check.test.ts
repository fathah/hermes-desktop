import { describe, it, expect, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-agent-update-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

async function loadUpdateCheck(
  update: {
    available: boolean;
    reason?: string;
    localHead?: string;
    upstreamHead?: string;
    behindBy?: number;
  },
): Promise<typeof import("../src/main/hermes-agent-updates")> {
  vi.resetModules();
  process.env.HERMES_HOME = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });

  vi.doMock("../src/main/installer", () => ({
    HERMES_HOME: TEST_DIR,
    HERMES_REPO: join(TEST_DIR, "hermes-agent"),
    checkHermesUpdate: vi.fn().mockResolvedValue(update),
    getChangelog: vi.fn().mockResolvedValue(""),
    getEnhancedPath: vi.fn(() => process.env.PATH || ""),
    runHermesUpdate: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("../src/main/hermes", () => ({
    isGatewayRunning: vi.fn(() => false),
    isRemoteMode: vi.fn(() => false),
    restartGateway: vi.fn(),
  }));

  return await import("../src/main/hermes-agent-updates");
}

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  vi.doUnmock("../src/main/installer");
  vi.doUnmock("../src/main/hermes");
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Hermes Agent update check safety status", () => {
  it("records fetch/update-check failures as errors", async () => {
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck({
      available: false,
      reason: "fatal: unable to access upstream",
    });

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("fatal: unable to access upstream");
  });

  it("records non-updatable installs as skipped", async () => {
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck({
      available: false,
      reason: "not-a-git-repo",
    });

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("not-a-git-repo");
  });
});
