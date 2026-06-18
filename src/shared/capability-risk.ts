export type CapabilityKind = "skill" | "mcp" | "local-expert-check";

export type CapabilityRiskSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type CapabilityRiskStatus = "safe" | "warning" | "blocked" | "unknown";

export type CapabilityReviewState = "unreviewed" | "reviewed" | "needsReview";

export type CapabilityUpdateStatus =
  | "current"
  | "updateAvailable"
  | "rescanPassed"
  | "rescanWarn"
  | "rescanBlocked"
  | "unknown"
  | "checkFailed";

export interface CapabilityRiskFinding {
  id: string;
  severity: CapabilityRiskSeverity;
  title: string;
  detail: string;
  source:
    | "deterministic"
    | "upstream"
    | "cisco-mcp-scanner"
    | "snyk-agent-scan"
    | "skillspector"
    | "tencent-ai-infra-guard"
    | "pipelock";
}

export interface CapabilitySourceInfo {
  localPath?: string;
  gitRoot?: string;
  gitHead?: string;
  gitRemoteHead?: string;
  packageSpec?: string;
  packageCurrent?: string;
  packageLatest?: string;
  packageRegistry?: "npm" | "pypi";
  remoteUrl?: string;
  updateError?: string;
}

export interface CapabilityRiskReport {
  id: string;
  kind: CapabilityKind;
  name: string;
  enabled: boolean;
  installedFingerprint: string;
  latestFingerprint?: string;
  source: CapabilitySourceInfo;
  status: CapabilityRiskStatus;
  updateStatus: CapabilityUpdateStatus;
  reviewState: CapabilityReviewState;
  findings: CapabilityRiskFinding[];
  summary: string;
  lastCheckedAt: number;
  lastReviewedAt?: number;
  scanner: "deterministic-v1";
}

export interface CapabilityScannerStatus {
  id:
    | "cisco-mcp-scanner"
    | "snyk-agent-scan"
    | "skillspector"
    | "tencent-ai-infra-guard"
    | "pipelock";
  label: string;
  configured: boolean;
  lastRunAt?: number;
  lastError?: string;
}

export interface CapabilityRiskRegistry {
  schemaVersion: 1;
  updatedAt: number;
  reports: CapabilityRiskReport[];
  scanners?: CapabilityScannerStatus[];
}

export interface CapabilityRiskSummary {
  checkedAt: number;
  reports: CapabilityRiskReport[];
  scanners: CapabilityScannerStatus[];
  stats: {
    total: number;
    safe: number;
    warning: number;
    blocked: number;
    unreviewed: number;
    updates: number;
    failed: number;
  };
}

const SEVERITY_WEIGHT: Record<CapabilityRiskSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function highestRiskStatus(
  findings: CapabilityRiskFinding[],
): CapabilityRiskStatus {
  if (findings.length === 0) return "safe";
  const max = Math.max(...findings.map((f) => SEVERITY_WEIGHT[f.severity]));
  if (max >= SEVERITY_WEIGHT.high) return "blocked";
  if (max >= SEVERITY_WEIGHT.low) return "warning";
  return "safe";
}

export function capabilityRiskStats(
  reports: CapabilityRiskReport[],
): CapabilityRiskSummary["stats"] {
  return {
    total: reports.length,
    safe: reports.filter((r) => r.status === "safe").length,
    warning: reports.filter((r) => r.status === "warning").length,
    blocked: reports.filter((r) => r.status === "blocked").length,
    unreviewed: reports.filter((r) => r.reviewState !== "reviewed").length,
    updates: reports.filter((r) =>
      [
        "updateAvailable",
        "rescanPassed",
        "rescanWarn",
        "rescanBlocked",
      ].includes(r.updateStatus),
    ).length,
    failed: reports.filter((r) => r.updateStatus === "checkFailed").length,
  };
}
