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

export function registerTelemetryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("telemetry-gateway-status", () => fetchGatewayStatus());
}
