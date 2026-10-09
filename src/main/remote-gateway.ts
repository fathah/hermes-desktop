import { getConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";

// Remote (HTTP) mode gateway lifecycle for the Gateway screen. The dashboard
// spawns the real `hermes gateway <verb>` on the server and returns
// immediately ({ ok, pid }); liveness comes from GET /api/status. The Gateway
// screen already re-polls status after start/restart, so "started" is enough.

function profileQuery(path: string, profile?: string): string {
  return profile && profile !== "default"
    ? `${path}?profile=${encodeURIComponent(profile)}`
    : path;
}

export async function remoteGatewayStatus(profile?: string): Promise<boolean> {
  try {
    const status = await remoteDashboardRequestJson<{
      gateway_running?: boolean;
    }>(getConnectionConfig(), profileQuery("/api/status", profile));
    return status?.gateway_running === true;
  } catch {
    return false;
  }
}

async function spawnGatewayAction(
  action: "start" | "stop" | "restart",
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await remoteDashboardRequestJson<{ ok?: boolean }>(
      getConnectionConfig(),
      profileQuery(`/api/gateway/${action}`, profile),
      { method: "POST" },
    );
    return result?.ok
      ? { success: true }
      : { success: false, error: `Remote gateway ${action} did not start.` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const remoteStartGateway = (profile?: string) =>
  spawnGatewayAction("start", profile);
export const remoteStopGateway = (profile?: string) =>
  spawnGatewayAction("stop", profile);
export const remoteRestartGateway = (profile?: string) =>
  spawnGatewayAction("restart", profile);
