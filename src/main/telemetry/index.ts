/**
 * Telemetry IPC surface — registered from src/main/index.ts.
 *
 * Step 0 (PR-A1) ships a single read-only probe handler:
 *   `telemetry-gateway-status`
 *
 * The renderer calls this once on connect and caches the
 * `capabilities[]` list. Per-feature handlers (tools, memory,
 * schedules, kanban) will be added in PR-A2 once the matching
 * backend endpoints exist (PR-B).
 */

import type { IpcMain } from "electron";
import { fetchGatewayStatus } from "./gateway-status";
import {
  fetchKanban,
  fetchMemory,
  fetchPersona,
  fetchProfiles,
  fetchProviders,
  fetchRecentEvents,
  fetchSchedules,
  fetchSessions,
  fetchSkills,
  fetchTools,
  fetchUsageSummary,
} from "./subsystems";
import {
  createCronJob,
  deleteCronJob,
  pauseCronJob,
  resumeCronJob,
  runCronJob,
  updateCronJob,
  type CronJobInput,
  type CronJobPatch,
} from "./cron";
import {
  completeTask,
  createBoard,
  createTask,
  deleteTask,
  removeBoard,
  type CreateBoardInput,
  type CreateTaskInput,
} from "./kanban-mutations";

export function registerTelemetryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("telemetry-gateway-status", () => fetchGatewayStatus());
  ipcMain.handle(
    "telemetry-tools",
    (_event, profile?: string) => fetchTools(profile),
  );
  ipcMain.handle("telemetry-memory", () => fetchMemory());
  ipcMain.handle("telemetry-schedules", () => fetchSchedules());
  ipcMain.handle("telemetry-kanban", () => fetchKanban());
  ipcMain.handle(
    "telemetry-sessions",
    (_event, limit?: number) => fetchSessions(limit),
  );
  ipcMain.handle("telemetry-skills", () => fetchSkills());
  ipcMain.handle("telemetry-profiles", () => fetchProfiles());
  ipcMain.handle("telemetry-providers", () => fetchProviders());
  ipcMain.handle("telemetry-persona", () => fetchPersona());
  ipcMain.handle(
    "telemetry-recent-events",
    (_event, limit?: number, since?: string) =>
      fetchRecentEvents(limit, since),
  );
  ipcMain.handle(
    "telemetry-usage-summary",
    (_event, since?: string) => fetchUsageSummary(since),
  );

  // ---- Phase 4 (PR-E1): cron CRUD mutations -------------------
  ipcMain.handle(
    "cron-create",
    (_event, input: CronJobInput) => createCronJob(input),
  );
  ipcMain.handle(
    "cron-update",
    (_event, jobId: string, patch: CronJobPatch) =>
      updateCronJob(jobId, patch),
  );
  ipcMain.handle(
    "cron-delete",
    (_event, jobId: string) => deleteCronJob(jobId),
  );
  ipcMain.handle(
    "cron-pause",
    (_event, jobId: string) => pauseCronJob(jobId),
  );
  ipcMain.handle(
    "cron-resume",
    (_event, jobId: string) => resumeCronJob(jobId),
  );
  ipcMain.handle("cron-run", (_event, jobId: string) => runCronJob(jobId));

  // ---- Phase 4 (PR-E2): kanban CRUD mutations ----------------
  ipcMain.handle(
    "kanban-create-board",
    (_event, input: CreateBoardInput) => createBoard(input),
  );
  ipcMain.handle(
    "kanban-remove-board",
    (_event, slug: string, hard?: boolean) => removeBoard(slug, !!hard),
  );
  ipcMain.handle(
    "kanban-create-task",
    (_event, input: CreateTaskInput) => createTask(input),
  );
  ipcMain.handle(
    "kanban-delete-task",
    (_event, taskId: string, board?: string) => deleteTask(taskId, board),
  );
  ipcMain.handle(
    "kanban-complete-task",
    (_event, taskId: string, board?: string) => completeTask(taskId, board),
  );
}
