import { HERMES_HOME } from "./installer";
import { getDesktopUpdateRoutine } from "./config";
import { getHermesAgentUpdateRoutine } from "./engine-update-state";
import { runConfigHealthCheck } from "./config-health";
import { getConnectionGatewayHealthStatus } from "./gateway-status";
import { readMirrorFailRecord } from "./mirror-fail-counter";
import { getSchedulerConfig, getSchedulerSkips } from "./scheduler";
import { validateChatReadiness } from "./validation";
import { buildVaultHealthReport } from "./vault-health";
import { listVaultProposals } from "./vault-review-queue";
import {
  summarizeOperatorReadiness,
  type OperatorReadinessReport,
  type OperatorReadinessRoutineState,
  type OperatorReadinessVaultSummary,
} from "../shared/operator-readiness";
import type { VaultHealthReport } from "../shared/sps-types";

function vaultSummary(
  report: VaultHealthReport,
): OperatorReadinessVaultSummary {
  return {
    orphans: report.orphans.length,
    brokenLinks: report.brokenLinks.length,
    stale: report.stale.length,
    duplicateTitles: report.duplicateTitles.length,
    duplicateAliases: report.duplicateAliases.length,
    missingSchemaFields: report.missingSchemaFields.length,
    staleCaptures: report.staleCaptures.length,
    unprocessedPdfs: report.unprocessedPdfs.length,
    weaklyConnected: report.weaklyConnected.length,
  };
}

function routineState(state: {
  enabled: boolean;
  lastResult?: { status?: string } | null;
}): OperatorReadinessRoutineState {
  return {
    enabled: state.enabled,
    lastStatus: state.enabled ? state.lastResult?.status : "disabled",
  };
}

function totalSchedulerSkips(
  skips: Record<string, { skipCount?: number }>,
): number {
  return Object.values(skips).reduce(
    (sum, info) => sum + Math.max(0, Math.floor(info.skipCount ?? 0)),
    0,
  );
}

export async function getOperatorReadiness(
  profile = "default",
): Promise<OperatorReadinessReport> {
  const [
    vaultHealth,
    proposals,
    chatReadiness,
    configHealth,
    gatewayHealth,
    schedulerConfig,
    schedulerSkips,
    desktopUpdateRoutine,
    agentUpdateRoutine,
    mirrorFailures,
  ] = await Promise.all([
    buildVaultHealthReport(profile),
    listVaultProposals(profile),
    Promise.resolve(validateChatReadiness(profile)),
    Promise.resolve(runConfigHealthCheck(profile)),
    getConnectionGatewayHealthStatus(profile),
    Promise.resolve(getSchedulerConfig()),
    Promise.resolve(getSchedulerSkips()),
    Promise.resolve(getDesktopUpdateRoutine()),
    Promise.resolve(getHermesAgentUpdateRoutine(profile)),
    Promise.resolve(readMirrorFailRecord(HERMES_HOME)),
  ]);

  return summarizeOperatorReadiness({
    profile,
    chatReadiness,
    gatewayHealth,
    configHealthSummary: configHealth.summary,
    vaultHealthSummary: vaultSummary(vaultHealth),
    pendingVaultProposals: proposals.filter(
      (proposal) => proposal.status === "pending",
    ).length,
    schedulerEnabled: schedulerConfig.enabled,
    schedulerSkipCount: totalSchedulerSkips(schedulerSkips),
    desktopUpdateRoutine: routineState(desktopUpdateRoutine),
    agentUpdateRoutine: routineState(agentUpdateRoutine),
    mirrorWarningCount: mirrorFailures.count,
    writeWarningCount: 0,
  });
}
