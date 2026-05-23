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
  fetchSchedules,
  fetchSessions,
  fetchSkills,
  fetchTools,
} from "./subsystems";

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
}
