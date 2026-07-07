import type { OwnerDeliverySummary } from "./owner-notifications";

export type { OwnerDeliverySummary } from "./owner-notifications";

export type RoutinePanelStatus = "healthy" | "warning" | "failure";

export interface RoutineSkipSummary {
  skipCount: number;
  lastSkipAt: number | null;
  lastReason: string | null;
}

export interface RoutineResultSummary {
  id: "desktop-update" | "hermes-agent-update";
  label: string;
  enabled: boolean;
  lastStatus: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface OwnerRoutineJobSummary {
  id: string;
  name: string;
  schedule: string;
  state: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  deliver: string[];
}

export interface ClosedAppGatewaySummary {
  status: string;
  message: string | null;
  lastCheckedAt: string | null;
  lastRestartAt: string | null;
  lastOutageMs: number | null;
  lastError: string | null;
}

export interface RoutinesStatusReport {
  generatedAt: string;
  status: RoutinePanelStatus;
  scheduler: RoutineSkipSummary;
  updateRoutines: RoutineResultSummary[];
  ownerRoutineJobs: OwnerRoutineJobSummary[];
  closedAppGateway: ClosedAppGatewaySummary | null;
  ownerDelivery: OwnerDeliverySummary;
}
