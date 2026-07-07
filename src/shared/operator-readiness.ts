import type { ConfigHealthReport } from "./config-health";
import type { GatewayHealthStatus } from "./gateway";
import type { ChatReadiness } from "./validation";

export type OperatorReadinessStatus = "ready" | "attention" | "blocked";

export type OperatorReadinessTarget =
  | {
      kind: "settings";
      view:
        | "overview"
        | "aiSetup"
        | "models"
        | "dataPrivacy"
        | "connectedApps"
        | "troubleshooting"
        | "advanced";
    }
  | { kind: "surface"; surface: "review" | "health" | "work" }
  | { kind: "modal"; modal: "scheduled" };

export interface OperatorReadinessAction {
  label: string;
  target: OperatorReadinessTarget;
}

export interface OperatorReadinessItem {
  id:
    | "ai"
    | "gateway"
    | "config"
    | "vault"
    | "review"
    | "scheduler"
    | "desktop-update"
    | "agent-update"
    | "storage";
  title: string;
  status: OperatorReadinessStatus;
  summary: string;
  action: OperatorReadinessAction;
}

export interface OperatorReadinessReport {
  profile: string;
  status: OperatorReadinessStatus;
  headline: string;
  summary: string;
  generatedAt: number;
  items: OperatorReadinessItem[];
}

export interface OperatorReadinessRoutineState {
  enabled: boolean;
  lastStatus?: "ok" | "available" | "updated" | "failed" | "disabled" | string;
}

export interface OperatorReadinessVaultSummary {
  orphans: number;
  brokenLinks: number;
  stale: number;
  duplicateTitles: number;
  duplicateAliases: number;
  missingSchemaFields: number;
  staleCaptures: number;
  unprocessedPdfs: number;
  weaklyConnected: number;
}

export interface OperatorReadinessFacts {
  profile: string;
  chatReadiness: ChatReadiness;
  gatewayHealth: GatewayHealthStatus;
  configHealthSummary: ConfigHealthReport["summary"];
  vaultHealthSummary: OperatorReadinessVaultSummary;
  pendingVaultProposals: number;
  schedulerEnabled: boolean;
  schedulerSkipCount: number;
  desktopUpdateRoutine?: OperatorReadinessRoutineState;
  agentUpdateRoutine?: OperatorReadinessRoutineState;
  mirrorWarningCount?: number;
  writeWarningCount?: number;
  generatedAt?: number;
}

const STATUS_RANK: Record<OperatorReadinessStatus, number> = {
  blocked: 0,
  attention: 1,
  ready: 2,
};

function statusHeadline(status: OperatorReadinessStatus): string {
  if (status === "blocked") return "Blocked before serious use";
  if (status === "attention") return "Ready with follow-up work";
  return "Ready for serious use";
}

function aiAction(readiness: ChatReadiness): OperatorReadinessAction {
  if (readiness.fixLocation === "models") {
    return {
      label: "Open Models",
      target: { kind: "settings", view: "models" },
    };
  }
  if (readiness.fixLocation === "gateway") {
    return {
      label: "Open Connected Apps",
      target: { kind: "settings", view: "connectedApps" },
    };
  }
  if (
    readiness.fixLocation === "setup" ||
    readiness.fixLocation === "providers"
  ) {
    return {
      label: "Open AI Setup",
      target: { kind: "settings", view: "aiSetup" },
    };
  }
  return {
    label: readiness.ok ? "Open AI Setup" : "Run Diagnostics",
    target: {
      kind: "settings",
      view: readiness.ok ? "aiSetup" : "troubleshooting",
    },
  };
}

function totalVaultIssues(summary: OperatorReadinessVaultSummary): number {
  return Object.values(summary).reduce((sum, count) => sum + count, 0);
}

function routineItem(
  id: "desktop-update" | "agent-update",
  title: string,
  routine: OperatorReadinessRoutineState | undefined,
): OperatorReadinessItem {
  const disabled = routine?.enabled === false;
  const failed =
    routine?.lastStatus === "failed" || routine?.lastStatus === "error";
  const status: OperatorReadinessStatus =
    disabled || failed ? "attention" : "ready";
  const subject = id === "desktop-update" ? "Desktop" : "Hermes Agent";
  return {
    id,
    title,
    status,
    summary: disabled
      ? `${subject} update checks are disabled.`
      : failed
        ? `${subject} update check failed last run.`
        : `${subject} update checks are ready.`,
    action: {
      label: id === "desktop-update" ? "Open Data & Privacy" : "Open AI Setup",
      target: {
        kind: "settings",
        view: id === "desktop-update" ? "dataPrivacy" : "aiSetup",
      },
    },
  };
}

export function countReadinessItemsByStatus(
  items: OperatorReadinessItem[],
): Record<OperatorReadinessStatus, number> {
  return items.reduce(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { ready: 0, attention: 0, blocked: 0 },
  );
}

export function highestReadinessStatus(
  items: OperatorReadinessItem[],
): OperatorReadinessStatus {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (items.some((item) => item.status === "attention")) return "attention";
  return "ready";
}

export function summarizeOperatorReadiness(
  facts: OperatorReadinessFacts,
): OperatorReadinessReport {
  const vaultIssueCount = totalVaultIssues(facts.vaultHealthSummary);
  const storageWarningCount =
    (facts.mirrorWarningCount ?? 0) + (facts.writeWarningCount ?? 0);
  const configErrors = facts.configHealthSummary.errors;
  const configWarnings = facts.configHealthSummary.warnings;

  const items: OperatorReadinessItem[] = [
    {
      id: "ai",
      title: "AI setup",
      status: facts.chatReadiness.ok ? "ready" : "blocked",
      summary: facts.chatReadiness.ok
        ? "Chat is configured and ready."
        : facts.chatReadiness.message || "Chat setup needs attention.",
      action: aiAction(facts.chatReadiness),
    },
    {
      id: "gateway",
      title: "Gateway",
      status:
        facts.gatewayHealth === "down"
          ? "blocked"
          : facts.gatewayHealth === "healthy"
            ? "ready"
            : "attention",
      summary:
        facts.gatewayHealth === "healthy"
          ? "Gateway supervisor is healthy."
          : `Gateway supervisor is ${facts.gatewayHealth}.`,
      action: {
        label: "Open Connected Apps",
        target: { kind: "settings", view: "connectedApps" },
      },
    },
    {
      id: "config",
      title: "Configuration health",
      status:
        configErrors > 0
          ? "blocked"
          : configWarnings > 0
            ? "attention"
            : "ready",
      summary:
        configErrors > 0
          ? `${configErrors} config error${configErrors === 1 ? "" : "s"} and ${configWarnings} warning${configWarnings === 1 ? "" : "s"} found.`
          : configWarnings > 0
            ? `${configWarnings} config warning${configWarnings === 1 ? "" : "s"} found.`
            : "Configuration health is clean.",
      action: {
        label: "Open Troubleshooting",
        target: { kind: "settings", view: "troubleshooting" },
      },
    },
    {
      id: "vault",
      title: "Vault health",
      status: vaultIssueCount > 0 ? "attention" : "ready",
      summary:
        vaultIssueCount > 0
          ? `${vaultIssueCount} vault health issue${vaultIssueCount === 1 ? "" : "s"} need review.`
          : "Vault health has no reported issues.",
      action: {
        label: "Open Vault Health",
        target: { kind: "surface", surface: "health" },
      },
    },
    {
      id: "review",
      title: "Review queue",
      status: facts.pendingVaultProposals > 0 ? "attention" : "ready",
      summary:
        facts.pendingVaultProposals > 0
          ? `${facts.pendingVaultProposals} pending vault proposal${facts.pendingVaultProposals === 1 ? "" : "s"} need review.`
          : "No pending vault proposals.",
      action: {
        label: "Open Review Queue",
        target: { kind: "surface", surface: "review" },
      },
    },
    {
      id: "scheduler",
      title: "Scheduler",
      status:
        !facts.schedulerEnabled || facts.schedulerSkipCount > 0
          ? "attention"
          : "ready",
      summary: !facts.schedulerEnabled
        ? "Scheduler is disabled."
        : facts.schedulerSkipCount > 0
          ? `${facts.schedulerSkipCount} scheduled job skip${facts.schedulerSkipCount === 1 ? "" : "s"} recorded.`
          : "Scheduler is enabled with no recorded skips.",
      action: {
        label: "Open Scheduled",
        target: { kind: "modal", modal: "scheduled" },
      },
    },
    routineItem(
      "desktop-update",
      "Desktop updates",
      facts.desktopUpdateRoutine,
    ),
    routineItem(
      "agent-update",
      "Hermes Agent updates",
      facts.agentUpdateRoutine,
    ),
    {
      id: "storage",
      title: "Storage writes",
      status: storageWarningCount > 0 ? "attention" : "ready",
      summary:
        storageWarningCount > 0
          ? `${storageWarningCount} storage warning${storageWarningCount === 1 ? "" : "s"} reported.`
          : "Vault mirror and write queue have no reported warnings.",
      action: {
        label: "Open Data & Privacy",
        target: { kind: "settings", view: "dataPrivacy" },
      },
    },
  ];
  items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

  const status = highestReadinessStatus(items);
  const counts = countReadinessItemsByStatus(items);

  return {
    profile: facts.profile,
    status,
    headline: statusHeadline(status),
    summary: `${counts.blocked} blocked, ${counts.attention} need attention, ${counts.ready} ready.`,
    generatedAt: facts.generatedAt ?? Date.now(),
    items,
  };
}
