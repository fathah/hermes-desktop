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
  options: {
    gitStatus?: string;
    runUpdateError?: Error;
    gatewayRunning?: boolean;
    restartError?: Error;
  } = {},
): Promise<typeof import("../src/main/hermes-agent-updates")> {
  vi.resetModules();
  process.env.HERMES_HOME = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "hermes-agent", ".git"), { recursive: true });

  vi.doMock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>();
    const execFile = vi.fn(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
      ) =>
        callback(null, Buffer.from(options.gitStatus ?? ""), Buffer.from("")),
    );
    return {
      ...actual,
      execFile,
      default: { ...actual, execFile },
    };
  });
  vi.doMock("../src/main/installer", () => ({
    HERMES_HOME: TEST_DIR,
    HERMES_REPO: join(TEST_DIR, "hermes-agent"),
    checkHermesUpdate: vi.fn().mockResolvedValue(update),
    getChangelog: vi.fn().mockResolvedValue(""),
    getEnhancedPath: vi.fn(() => process.env.PATH || ""),
    runHermesUpdate: options.runUpdateError
      ? vi.fn().mockRejectedValue(options.runUpdateError)
      : vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("../src/main/hermes", () => ({
    isGatewayRunning: vi.fn(() => options.gatewayRunning ?? false),
    isRemoteMode: vi.fn(() => false),
    restartGateway: options.restartError
      ? vi.fn(() => {
          throw options.restartError;
        })
      : vi.fn(),
  }));

  return await import("../src/main/hermes-agent-updates");
}

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  vi.doUnmock("../src/main/installer");
  vi.doUnmock("../src/main/hermes");
  vi.doUnmock("child_process");
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
    expect(result.phase).toBe("check");
    expect(result.reason).toBe("fetch-failed");
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
    expect(result.phase).toBe("check");
    expect(result.reason).toBe("not-a-git-repo");
    expect(result.message).toContain("not-a-git-repo");
  });

  it("records dirty auto-apply skips separately from fetch failures", async () => {
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck(
      {
        available: true,
        localHead: "abc123",
        upstreamHead: "def456",
        behindBy: 2,
      },
      { gitStatus: " M run_agent.py\n" },
    );

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
    });

    expect(result.status).toBe("skipped");
    expect(result.phase).toBe("update");
    expect(result.reason).toBe("dirty-repo");
    expect(result.restartStatus).toBe("not-needed");
  });

  it("records update failures without hiding the check result", async () => {
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck(
      {
        available: true,
        localHead: "abc123",
        upstreamHead: "def456",
        behindBy: 2,
      },
      { runUpdateError: new Error("hermes update failed") },
    );

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
    });

    expect(result.status).toBe("error");
    expect(result.phase).toBe("update");
    expect(result.reason).toBe("update-failed");
    expect(result.restartStatus).toBe("not-needed");
    expect(result.localHead).toBe("abc123");
    expect(result.upstreamHead).toBe("def456");
  });

  it("records restart failures separately after a successful update", async () => {
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck(
      {
        available: true,
        localHead: "abc123",
        upstreamHead: "def456",
        behindBy: 2,
      },
      {
        gatewayRunning: true,
        restartError: new Error("gateway restart failed"),
      },
    );

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
    });

    expect(result.status).toBe("updated");
    expect(result.phase).toBe("restart");
    expect(result.reason).toBe("restart-failed");
    expect(result.restartStatus).toBe("failed");
    expect(result.restartMessage).toContain("gateway restart failed");
  });
});
