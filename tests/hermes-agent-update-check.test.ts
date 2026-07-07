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
    restartResult?: boolean;
    restartError?: Error;
    channel?: "release" | "main";
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
    getInstalledEngineSha: vi.fn().mockResolvedValue(update.localHead ?? null),
    runHermesUpdate: options.runUpdateError
      ? vi.fn().mockRejectedValue(options.runUpdateError)
      : vi.fn().mockResolvedValue(undefined),
    rollbackEngineTo: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("../src/main/hermes", () => ({
    isGatewayRunning: vi.fn(() => options.gatewayRunning ?? false),
    isRemoteMode: vi.fn(() => false),
    restartGateway: options.restartError
      ? vi.fn().mockRejectedValue(options.restartError)
      : vi.fn().mockResolvedValue(options.restartResult ?? true),
  }));
  vi.doMock("../src/main/engine-capabilities", () => ({
    refreshEngineCapabilities: vi.fn().mockResolvedValue({}),
  }));
  vi.doMock("../src/main/engine-contract-verify", () => ({
    verifyAndRecordEngineContract: vi.fn().mockResolvedValue({
      checkedAt: "2026-06-20T22:35:00.000Z",
      status: "unknown",
      findings: [],
    }),
  }));

  const config = await import("../src/main/config");
  config.setHermesAgentUpdateRoutine(
    { engineUpdateChannel: options.channel ?? "main" },
    "work",
  );

  return await import("../src/main/hermes-agent-updates");
}

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  vi.doUnmock("../src/main/installer");
  vi.doUnmock("../src/main/hermes");
  vi.doUnmock("../src/main/engine-capabilities");
  vi.doUnmock("../src/main/engine-contract-verify");
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

  it("reports current when the release-channel SHA is already installed", async () => {
    const releaseSha = "2222222222222222222222222222222222222222";
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck(
      {
        available: true,
        localHead: "1111111111111111111111111111111111111111",
        upstreamHead: "main-head",
      },
      { channel: "release" },
    );
    const installer = await import("../src/main/installer");
    const resolveLatestRelease = vi.fn().mockResolvedValue({
      tag: "v2026.7.7",
      sha: releaseSha,
      url: "https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.7",
    });

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      getInstalledSha: vi.fn().mockResolvedValue(releaseSha),
      resolveLatestRelease,
    });

    expect(result.status).toBe("current");
    expect(result.reason).toBe("already-current");
    expect(result.updateChannel).toBe("release");
    expect(result.releaseTag).toBe("v2026.7.7");
    expect(result.releaseSha).toBe(releaseSha);
    expect(result.upstreamHead).toBe(releaseSha);
    expect(installer.checkHermesUpdate).not.toHaveBeenCalled();
    expect(installer.runHermesUpdate).not.toHaveBeenCalled();
  });

  it("applies release-channel updates by checking out the latest release SHA", async () => {
    const oldSha = "1111111111111111111111111111111111111111";
    const releaseSha = "2222222222222222222222222222222222222222";
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck(
      {
        available: true,
        localHead: oldSha,
        upstreamHead: "main-head",
      },
      { channel: "release" },
    );
    const installer = await import("../src/main/installer");
    const resolveLatestRelease = vi.fn().mockResolvedValue({
      tag: "v2026.7.7",
      sha: releaseSha,
      url: "https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.7",
    });

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
      getInstalledSha: vi.fn().mockResolvedValue(oldSha),
      resolveLatestRelease,
    });

    expect(result.status).toBe("updated");
    expect(result.reason).toBe("updated");
    expect(result.updateChannel).toBe("release");
    expect(result.releaseTag).toBe("v2026.7.7");
    expect(result.releaseSha).toBe(releaseSha);
    expect(result.localHead).toBe(oldSha);
    expect(result.upstreamHead).toBe(releaseSha);
    expect(installer.rollbackEngineTo).toHaveBeenCalledWith(
      releaseSha,
      expect.any(Function),
    );
    expect(installer.runHermesUpdate).not.toHaveBeenCalled();
  });

  it("keeps the hermes update command on the main channel", async () => {
    const oldSha = "1111111111111111111111111111111111111111";
    const newSha = "2222222222222222222222222222222222222222";
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck(
      {
        available: true,
        localHead: oldSha,
        upstreamHead: newSha,
        behindBy: 1,
      },
      { channel: "main" },
    );
    const installer = await import("../src/main/installer");

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
      getInstalledSha: vi.fn().mockResolvedValue(oldSha),
    });

    expect(result.status).toBe("updated");
    expect(result.updateChannel).toBe("main");
    expect(result.upstreamHead).toBe(newSha);
    expect(installer.runHermesUpdate).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(installer.rollbackEngineTo).not.toHaveBeenCalled();
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

  it("records a false restart result as a restart failure", async () => {
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck(
      {
        available: true,
        localHead: "abc123",
        upstreamHead: "def456",
        behindBy: 2,
      },
      {
        gatewayRunning: true,
        restartResult: false,
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
    expect(result.restartMessage).toContain("gateway restart returned false");
  });

  it("records a passed contract after auto-update", async () => {
    const oldSha = "1111111111111111111111111111111111111111";
    const newSha = "2222222222222222222222222222222222222222";
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck({
      available: true,
      localHead: oldSha,
      upstreamHead: newSha,
      behindBy: 1,
    });

    const contract = {
      checkedAt: "2026-06-20T22:36:00.000Z",
      status: "passed" as const,
      findings: [],
    };
    const refreshCapabilities = vi.fn().mockResolvedValue({});
    const verifyContract = vi.fn().mockResolvedValue(contract);

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
      getInstalledSha: vi.fn().mockResolvedValue(oldSha),
      refreshCapabilities,
      verifyContract,
    });

    expect(result.status).toBe("updated");
    expect(result.contract).toBe(contract);
    expect(refreshCapabilities).toHaveBeenCalledWith("work");
    expect(verifyContract).toHaveBeenCalledWith("work");
  });

  it("suppresses future auto-apply when the post-update contract is broken", async () => {
    const oldSha = "1111111111111111111111111111111111111111";
    const newSha = "2222222222222222222222222222222222222222";
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck({
      available: true,
      localHead: oldSha,
      upstreamHead: newSha,
      behindBy: 1,
    });
    const config = await import("../src/main/config");
    config.recordEngineCapabilitySnapshot(
      {
        status: "ready",
        fetchedAt: "2026-06-20T22:30:00.000Z",
        mode: "local",
        engineSha: oldSha,
        features: {},
        endpoints: {},
      },
      "work",
    );
    config.recordEngineContractVerification(
      {
        checkedAt: "2026-06-20T22:31:00.000Z",
        status: "passed",
        findings: [],
      },
      "work",
    );

    const contract = {
      checkedAt: "2026-06-20T22:36:00.000Z",
      status: "broken" as const,
      findings: [
        {
          entryId: "cli-update",
          kind: "cli" as const,
          value: "update",
          tier: "fail" as const,
          verdict: "broken" as const,
          detail: "Top-level command update is missing.",
        },
      ],
    };
    const refreshCapabilities = vi.fn(async (profile?: string) =>
      config.recordEngineCapabilitySnapshot(
        {
          status: "ready",
          fetchedAt: "2026-06-20T22:35:30.000Z",
          mode: "local",
          engineSha: newSha,
          features: {},
          endpoints: {},
        },
        profile,
      ),
    );
    const verifyContract = vi.fn(async (profile?: string) => {
      config.recordEngineContractVerification(contract, profile);
      return contract;
    });
    const notifyContractBroken = vi.fn();
    const getInstalledSha = vi
      .fn()
      .mockResolvedValueOnce(oldSha)
      .mockResolvedValue(newSha);

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
      getInstalledSha,
      refreshCapabilities,
      verifyContract,
      notifyContractBroken,
    });

    expect(result.status).toBe("contract-broken");
    expect(result.phase).toBe("verify");
    expect(result.reason).toBe("contract-broken");
    expect(result.contract).toBe(contract);
    expect(notifyContractBroken).toHaveBeenCalledOnce();

    const routine = config.getHermesAgentUpdateRoutine("work");
    expect(routine.autoApplySuppressed).toBe(true);
    expect(routine.autoApplySuppressionReason).toBe("contract-broken");
    expect(routine.autoApplySuppressedSha).toBe(newSha);
    const capabilities = config.getEngineCapabilityState("work");
    expect(capabilities.installedSha).toBe(newSha);
    expect(capabilities.lastVerifiedSha).toBe(oldSha);
  });

  it("does not suppress auto-apply when the post-update contract is unknown", async () => {
    const oldSha = "1111111111111111111111111111111111111111";
    const newSha = "2222222222222222222222222222222222222222";
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck({
      available: true,
      localHead: oldSha,
      upstreamHead: newSha,
      behindBy: 1,
    });
    const config = await import("../src/main/config");

    const contract = {
      checkedAt: "2026-06-20T22:36:00.000Z",
      status: "unknown" as const,
      findings: [],
    };
    const verifyContract = vi.fn(async (profile?: string) => {
      config.recordEngineContractVerification(contract, profile);
      return contract;
    });

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
      getInstalledSha: vi.fn().mockResolvedValue(oldSha),
      refreshCapabilities: vi.fn().mockResolvedValue({}),
      verifyContract,
    });

    expect(result.status).toBe("updated");
    expect(result.contract).toBe(contract);
    expect(config.getHermesAgentUpdateRoutine("work").autoApplySuppressed).toBe(
      false,
    );
  });

  it("does not auto-apply while contract-break suppression is active", async () => {
    const oldSha = "1111111111111111111111111111111111111111";
    const newSha = "2222222222222222222222222222222222222222";
    const { runHermesAgentUpdateCheck } = await loadUpdateCheck({
      available: true,
      localHead: oldSha,
      upstreamHead: newSha,
      behindBy: 1,
    });
    const config = await import("../src/main/config");
    const installer = await import("../src/main/installer");
    config.setHermesAgentUpdateRoutine({ autoApply: true }, "work");
    config.suppressHermesAgentUpdateAutoApply(
      "contract-broken",
      newSha,
      "2026-06-20T22:34:00.000Z",
      "work",
    );

    const result = await runHermesAgentUpdateCheck("work", {
      now: new Date("2026-06-20T22:35:00.000Z"),
      autoApply: true,
    });

    expect(result.status).toBe("available");
    expect(result.reason).toBe("auto-apply-suppressed");
    expect(installer.runHermesUpdate).not.toHaveBeenCalled();
  });
});
