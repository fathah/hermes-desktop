import { getConnectionConfig } from "./config";
import {
  getGatewayHealthStatus,
  isApiServerReady,
  isGatewayRunning,
  testRemoteConnection,
} from "./hermes";
import { sshGatewayStatus } from "./ssh-remote";
import type { GatewayHealthStatus } from "../shared/gateway";

export interface ConnectionGatewayStatus {
  running: boolean;
  health: GatewayHealthStatus;
}

function healthFromReachable(reachable: boolean): GatewayHealthStatus {
  return reachable ? "healthy" : "down";
}

function localFallbackHealth(running: boolean): GatewayHealthStatus {
  const supervisorHealth = getGatewayHealthStatus();
  if (supervisorHealth !== "healthy") return supervisorHealth;
  return running ? "unhealthy" : "down";
}

export async function getConnectionGatewayStatus(
  profile?: string,
): Promise<ConnectionGatewayStatus> {
  const conn = getConnectionConfig();

  if (conn.mode === "remote") {
    const reachable = conn.remoteUrl
      ? await testRemoteConnection(conn.remoteUrl, conn.apiKey)
      : false;
    return { running: reachable, health: healthFromReachable(reachable) };
  }

  if (conn.mode === "ssh") {
    const running = conn.ssh.host ? await sshGatewayStatus(conn.ssh) : false;
    return { running, health: healthFromReachable(running) };
  }

  const ready = await isApiServerReady(profile);
  if (ready) return { running: true, health: "healthy" };

  const running = isGatewayRunning(profile);
  return { running, health: localFallbackHealth(running) };
}

export async function isConnectionGatewayRunning(
  profile?: string,
): Promise<boolean> {
  return (await getConnectionGatewayStatus(profile)).running;
}

export async function getConnectionGatewayHealthStatus(
  profile?: string,
): Promise<GatewayHealthStatus> {
  return (await getConnectionGatewayStatus(profile)).health;
}
