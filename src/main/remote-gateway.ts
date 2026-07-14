import type { ConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
import type { GatewayStartResult } from "./hermes";

export async function remoteGatewayStatus(
  connection: ConnectionConfig,
  profile?: string,
): Promise<boolean> {
  const status = await remoteDashboardRequestJson<{
    gateway_running?: boolean;
  }>(connection, "/api/status", {}, profile);
  return status?.gateway_running === true;
}

async function lifecycle(
  connection: ConnectionConfig,
  action: "start" | "stop" | "restart",
  profile?: string,
): Promise<boolean> {
  const result = await remoteDashboardRequestJson<{ ok?: boolean }>(
    connection,
    `/api/gateway/${action}`,
    { method: "POST" },
    profile,
  );
  return result?.ok !== false;
}

export async function remoteStartGateway(
  connection: ConnectionConfig,
  profile?: string,
): Promise<GatewayStartResult> {
  const accepted = await lifecycle(connection, "start", profile);
  return accepted
    ? { success: true, running: true }
    : {
        success: false,
        running: false,
        error: "Remote gateway start request was rejected.",
      };
}

export function remoteStopGateway(
  connection: ConnectionConfig,
  profile?: string,
): Promise<boolean> {
  return lifecycle(connection, "stop", profile);
}

export function remoteRestartGateway(
  connection: ConnectionConfig,
  profile?: string,
): Promise<boolean> {
  return lifecycle(connection, "restart", profile);
}
