/**
 * Telemetry IPC surface — registered from src/main/index.ts.
 *
 * Phase A wires the foundation plus three subsystem reads:
 * Gateway / Tools / Memory. Schedules and Kanban are
 * intentionally out of scope for this PR (no claim-conformant
 * upstream contract — see PR body).
 */

import type { IpcMain } from "electron";
import {
  fetchGatewayStatus,
  fetchMemory,
  fetchTools,
} from "./subsystems";

export function registerTelemetryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("telemetry-gateway-status", () => fetchGatewayStatus());
  ipcMain.handle("telemetry-tools", () => fetchTools());
  ipcMain.handle("telemetry-memory", () => fetchMemory());
}
