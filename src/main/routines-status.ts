import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getDesktopUpdateRoutine } from "./config";
import { getHermesAgentUpdateRoutine } from "./engine-update-state";
import { getOwnerDeliverySummary } from "./owner-delivery";
import { listCronJobs } from "./cronjobs";
import { getSchedulerSkips } from "./scheduler";
import { profileHome } from "./utils";
import type {
  ClosedAppGatewaySummary,
  OwnerDeliverySummary,
  OwnerRoutineJobSummary,
  RoutinePanelStatus,
  RoutineResultSummary,
  RoutineSkipSummary,
  RoutinesStatusReport,
} from "../shared/routines-status";

function latestSkip(): RoutineSkipSummary {
  const entries = Object.values(getSchedulerSkips());
  const skipCount = entries.reduce(
    (sum, info) => sum + Math.max(0, Math.floor(info.skipCount ?? 0)),
    0,
  );
  const latest = entries
    .filter((info) => Number.isFinite(info.lastSkipAt))
    .sort((a, b) => b.lastSkipAt - a.lastSkipAt)[0];
  return {
    skipCount,
    lastSkipAt: latest?.lastSkipAt ?? null,
    lastReason: latest?.lastReason ?? null,
  };
}

function summarizeRoutine(input: {
  id: RoutineResultSummary["id"];
  label: string;
  enabled: boolean;
  lastCheckedAt?: string | null;
  lastResult?: { status?: string; error?: string; checkedAt?: string } | null;
}): RoutineResultSummary {
  return {
    id: input.id,
    label: input.label,
    enabled: input.enabled,
    lastStatus: input.enabled ? input.lastResult?.status || null : "disabled",
    lastCheckedAt: input.lastCheckedAt || input.lastResult?.checkedAt || null,
    lastError: input.lastResult?.error || null,
  };
}

function readClosedAppGatewayState(
  profile?: string,
): ClosedAppGatewaySummary | null {
  const statePath = join(profileHome(profile), "closed-app-gateway.json");
  if (!existsSync(statePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf-8")) as Record<
      string,
      unknown
    >;
    return {
      status: typeof raw.status === "string" ? raw.status : "unknown",
      message: typeof raw.message === "string" ? raw.message : null,
      lastCheckedAt:
        typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : null,
      lastRestartAt:
        typeof raw.lastRestartAt === "string" ? raw.lastRestartAt : null,
      lastOutageMs:
        typeof raw.lastOutageMs === "number" ? raw.lastOutageMs : null,
      lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    };
  } catch {
    return null;
  }
}

function summarizeOwnerJob(job: {
  id: string;
  name: string;
  schedule: string;
  state: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  deliver: string[];
}): OwnerRoutineJobSummary {
  return {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    state: job.state,
    enabled: job.enabled,
    nextRunAt: job.next_run_at,
    lastRunAt: job.last_run_at,
    lastStatus: job.last_status,
    lastError: job.last_error,
    deliver: job.deliver,
  };
}

function routineFailed(routine: RoutineResultSummary): boolean {
  return Boolean(
    routine.lastError ||
    routine.lastStatus === "failed" ||
    routine.lastStatus === "error",
  );
}

function reportStatus(input: {
  scheduler: RoutineSkipSummary;
  updateRoutines: RoutineResultSummary[];
  ownerRoutineJobs: OwnerRoutineJobSummary[];
  closedAppGateway: ClosedAppGatewaySummary | null;
  ownerDelivery: OwnerDeliverySummary;
}): RoutinePanelStatus {
  if (
    input.updateRoutines.some(routineFailed) ||
    input.ownerRoutineJobs.some((job) => job.lastError) ||
    input.closedAppGateway?.status === "restart-failed" ||
    input.ownerDelivery.status === "failed"
  ) {
    return "failure";
  }
  if (
    input.scheduler.skipCount > 0 ||
    input.ownerRoutineJobs.some((job) => job.state === "paused") ||
    (input.closedAppGateway &&
      input.closedAppGateway.status !== "healthy" &&
      input.closedAppGateway.status !== "managed-by-desktop") ||
    input.ownerDelivery.status === "warning"
  ) {
    return "warning";
  }
  return "healthy";
}

export async function getRoutinesStatus(
  profile = "default",
): Promise<RoutinesStatusReport> {
  const scheduler = latestSkip();
  const [jobs, desktopUpdateRoutine, agentUpdateRoutine, ownerDelivery] =
    await Promise.all([
      listCronJobs(true, profile),
      Promise.resolve(getDesktopUpdateRoutine()),
      Promise.resolve(getHermesAgentUpdateRoutine(profile)),
      Promise.resolve(getOwnerDeliverySummary(profile)),
    ]);
  const updateRoutines = [
    summarizeRoutine({
      id: "desktop-update",
      label: "Desktop updates",
      ...desktopUpdateRoutine,
    }),
    summarizeRoutine({
      id: "hermes-agent-update",
      label: "Hermes Agent updates",
      ...agentUpdateRoutine,
    }),
  ];
  const ownerRoutineJobs = jobs
    .filter((job) => job.name.startsWith("owner-routine:"))
    .map(summarizeOwnerJob);
  const closedAppGateway = readClosedAppGatewayState(profile);
  const status = reportStatus({
    scheduler,
    updateRoutines,
    ownerRoutineJobs,
    closedAppGateway,
    ownerDelivery,
  });
  return {
    generatedAt: new Date().toISOString(),
    status,
    scheduler,
    updateRoutines,
    ownerRoutineJobs,
    closedAppGateway,
    ownerDelivery,
  };
}
