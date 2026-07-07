import { describe, expect, it } from "vitest";
import {
  countReadinessItemsByStatus,
  summarizeOperatorReadiness,
} from "../src/shared/operator-readiness";

const healthyVault = {
  orphans: 0,
  brokenLinks: 0,
  stale: 0,
  duplicateTitles: 0,
  duplicateAliases: 0,
  missingSchemaFields: 0,
  staleCaptures: 0,
  unprocessedPdfs: 0,
  weaklyConnected: 0,
};

describe("operator readiness summary", () => {
  it("reports ready when the daily operating surface has no blockers or queued review work", () => {
    const report = summarizeOperatorReadiness({
      profile: "default",
      chatReadiness: { ok: true },
      gatewayHealth: "healthy",
      configHealthSummary: { errors: 0, warnings: 0, infos: 0 },
      vaultHealthSummary: healthyVault,
      pendingVaultProposals: 0,
      schedulerEnabled: true,
      schedulerSkipCount: 0,
      desktopUpdateRoutine: { enabled: true, lastStatus: "ok" },
      agentUpdateRoutine: { enabled: true, lastStatus: "ok" },
      mirrorWarningCount: 0,
      writeWarningCount: 0,
    });

    expect(report.status).toBe("ready");
    expect(report.headline).toBe("Ready for serious use");
    expect(countReadinessItemsByStatus(report.items)).toEqual({
      ready: report.items.length,
      attention: 0,
      blocked: 0,
    });
  });

  it("prioritizes blockers and sends setup failures to the existing fix surface", () => {
    const report = summarizeOperatorReadiness({
      profile: "default",
      chatReadiness: {
        ok: false,
        code: "MISSING_API_KEY",
        message: "Anthropic API key is missing.",
        fixLocation: "providers",
      },
      gatewayHealth: "down",
      configHealthSummary: { errors: 1, warnings: 2, infos: 0 },
      vaultHealthSummary: healthyVault,
      pendingVaultProposals: 0,
      schedulerEnabled: true,
      schedulerSkipCount: 0,
      desktopUpdateRoutine: { enabled: true, lastStatus: "ok" },
      agentUpdateRoutine: { enabled: true, lastStatus: "ok" },
    });

    expect(report.status).toBe("blocked");
    expect(report.items.slice(0, 3).map((item) => item.status)).toEqual([
      "blocked",
      "blocked",
      "blocked",
    ]);
    expect(report.items[0]).toMatchObject({
      id: "ai",
      action: {
        label: "Open AI Setup",
        target: { kind: "settings", view: "aiSetup" },
      },
    });
    expect(report.items.find((item) => item.id === "gateway")).toMatchObject({
      action: {
        label: "Open Connected Apps",
        target: { kind: "settings", view: "connectedApps" },
      },
    });
  });

  it("marks review, scheduler, vault, update, and write warnings as attention work", () => {
    const report = summarizeOperatorReadiness({
      profile: "default",
      chatReadiness: { ok: true },
      gatewayHealth: "recovering",
      configHealthSummary: { errors: 0, warnings: 1, infos: 0 },
      vaultHealthSummary: {
        ...healthyVault,
        brokenLinks: 2,
        staleCaptures: 1,
      },
      pendingVaultProposals: 3,
      schedulerEnabled: false,
      schedulerSkipCount: 2,
      desktopUpdateRoutine: { enabled: false, lastStatus: "disabled" },
      agentUpdateRoutine: { enabled: true, lastStatus: "failed" },
      mirrorWarningCount: 1,
      writeWarningCount: 1,
    });

    expect(report.status).toBe("attention");
    expect(countReadinessItemsByStatus(report.items)).toMatchObject({
      attention: 8,
      blocked: 0,
    });
    expect(report.items.find((item) => item.id === "review")).toMatchObject({
      summary: "3 pending vault proposals need review.",
      action: {
        label: "Open Review Queue",
        target: { kind: "surface", surface: "review" },
      },
    });
    expect(report.items.find((item) => item.id === "scheduler")).toMatchObject({
      action: {
        label: "Open Scheduled",
        target: { kind: "modal", modal: "scheduled" },
      },
    });
    expect(report.items.find((item) => item.id === "vault")).toMatchObject({
      action: {
        label: "Open Vault Health",
        target: { kind: "surface", surface: "health" },
      },
    });
  });
});
