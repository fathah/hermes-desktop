import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const mocks = vi.hoisted(() => ({
  safeHandle: vi.fn(),
  validateChatReadiness: vi.fn(),
  getConnectionGatewayHealthStatus: vi.fn(),
  runConfigHealthCheck: vi.fn(),
  buildVaultHealthReport: vi.fn(),
  listVaultProposals: vi.fn(),
  getSchedulerConfig: vi.fn(),
  getSchedulerSkips: vi.fn(),
  getDesktopUpdateRoutine: vi.fn(),
  getHermesAgentUpdateRoutine: vi.fn(),
  readMirrorFailRecord: vi.fn(),
}));

vi.mock("../src/main/ipc/safe-handle", () => ({
  safeHandle: mocks.safeHandle,
}));

vi.mock("../src/main/validation", () => ({
  validateChatReadiness: mocks.validateChatReadiness,
}));

vi.mock("../src/main/gateway-status", () => ({
  getConnectionGatewayHealthStatus: mocks.getConnectionGatewayHealthStatus,
}));

vi.mock("../src/main/config-health", () => ({
  runConfigHealthCheck: mocks.runConfigHealthCheck,
}));

vi.mock("../src/main/vault-health", () => ({
  buildVaultHealthReport: mocks.buildVaultHealthReport,
}));

vi.mock("../src/main/vault-review-queue", () => ({
  listVaultProposals: mocks.listVaultProposals,
}));

vi.mock("../src/main/scheduler", () => ({
  getSchedulerConfig: mocks.getSchedulerConfig,
  getSchedulerSkips: mocks.getSchedulerSkips,
}));

vi.mock("../src/main/config", () => ({
  getDesktopUpdateRoutine: mocks.getDesktopUpdateRoutine,
}));

vi.mock("../src/main/engine-update-state", () => ({
  getHermesAgentUpdateRoutine: mocks.getHermesAgentUpdateRoutine,
}));

vi.mock("../src/main/mirror-fail-counter", () => ({
  readMirrorFailRecord: mocks.readMirrorFailRecord,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-test-home",
}));

describe("operator readiness main aggregation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateChatReadiness.mockReturnValue({ ok: true });
    mocks.getConnectionGatewayHealthStatus.mockResolvedValue("healthy");
    mocks.runConfigHealthCheck.mockReturnValue({
      ranAt: 1,
      profile: "work",
      issues: [],
      summary: { errors: 0, warnings: 0, infos: 0 },
    });
    mocks.buildVaultHealthReport.mockResolvedValue({
      orphans: [],
      brokenLinks: [{ source: "a.md", target: "missing.md", type: "wiki" }],
      stale: [],
      duplicateTitles: [],
      duplicateAliases: [],
      missingSchemaFields: [],
      staleCaptures: [{ path: "_inbox/x.md", title: "x", ageDays: 30 }],
      unprocessedPdfs: [],
      weaklyConnected: [],
    });
    mocks.listVaultProposals.mockResolvedValue([
      { id: "p1", status: "pending" },
      { id: "p2", status: "committed" },
      { id: "p3", status: "pending" },
    ]);
    mocks.getSchedulerConfig.mockReturnValue({
      enabled: true,
      tickIntervalMs: 10000,
    });
    mocks.getSchedulerSkips.mockReturnValue({
      job1: { skipCount: 2, lastSkipAt: 1, lastReason: "locked" },
      job2: { skipCount: 1, lastSkipAt: 2, lastReason: "timeout" },
    });
    mocks.getDesktopUpdateRoutine.mockReturnValue({
      enabled: true,
      lastResult: { status: "error" },
    });
    mocks.getHermesAgentUpdateRoutine.mockReturnValue({
      enabled: false,
      lastResult: null,
    });
    mocks.readMirrorFailRecord.mockReturnValue({ count: 1 });
  });

  it("aggregates existing main-process truth sources into a shared readiness report", async () => {
    const { getOperatorReadiness } =
      await import("../src/main/operator-readiness");

    const report = await getOperatorReadiness("work");

    expect(report.profile).toBe("work");
    expect(report.status).toBe("attention");
    expect(report.items.find((item) => item.id === "vault")?.summary).toBe(
      "2 vault health issues need review.",
    );
    expect(report.items.find((item) => item.id === "review")?.summary).toBe(
      "2 pending vault proposals need review.",
    );
    expect(report.items.find((item) => item.id === "scheduler")?.summary).toBe(
      "3 scheduled job skips recorded.",
    );
    expect(
      report.items.find((item) => item.id === "desktop-update")?.status,
    ).toBe("attention");
    expect(report.items.find((item) => item.id === "storage")?.summary).toBe(
      "1 storage warning reported.",
    );
    expect(mocks.validateChatReadiness).toHaveBeenCalledWith("work");
    expect(mocks.getConnectionGatewayHealthStatus).toHaveBeenCalledWith("work");
    expect(mocks.buildVaultHealthReport).toHaveBeenCalledWith("work");
    expect(mocks.listVaultProposals).toHaveBeenCalledWith("work");
    expect(mocks.getHermesAgentUpdateRoutine).toHaveBeenCalledWith("work");
    expect(mocks.readMirrorFailRecord).toHaveBeenCalledWith(
      "/tmp/hermes-test-home",
    );
  });

  it("registers the get-operator-readiness IPC handler", async () => {
    const { registerOperatorReadinessIpc } =
      await import("../src/main/ipc/operator-readiness");

    registerOperatorReadinessIpc();

    expect(mocks.safeHandle).toHaveBeenCalledWith(
      "get-operator-readiness",
      expect.any(Function),
    );
  });

  it("wires operator readiness into the main IPC bootstrap", () => {
    const indexSrc = readFileSync(
      join(__dirname, "../src/main/index.ts"),
      "utf-8",
    );

    expect(indexSrc).toContain("registerOperatorReadinessIpc");
    expect(indexSrc).toContain("registerOperatorReadinessIpc();");
  });
});
