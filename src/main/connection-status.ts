import { buildAgentCapabilitySnapshot } from "../shared/agent-capabilities";
import type { ConnectionStatusSnapshot } from "../shared/connection-status";
import {
  getApiServerKeyStatus,
  getConnectionRegistry,
  type ConnectionRecord,
} from "./config";
import {
  getAgentCapabilityEvidence,
  getCachedAgentCapabilityEvidence,
  isGatewayRunning,
  testRemoteConnection,
} from "./hermes";
import { getHermesVersion } from "./installer";
import { probeRemoteAuthMode, remoteOAuthSessionState } from "./remote-oauth";
import { sshGatewayStatus, sshGetHermesVersion } from "./ssh-remote";

function elapsed(startedAt: number): number {
  return Math.max(1, Date.now() - startedAt);
}

async function probeConnection(
  connection: ConnectionRecord,
  profile?: string,
): Promise<
  Pick<
    ConnectionStatusSnapshot,
    "health" | "latencyMs" | "authentication" | "version"
  >
> {
  const startedAt = Date.now();
  const { config } = connection;

  if (config.mode === "local") {
    const health = isGatewayRunning(profile) ? "online" : "offline";
    return {
      health,
      latencyMs: elapsed(startedAt),
      authentication: getApiServerKeyStatus(profile).hasKey
        ? "authenticated"
        : "required",
      version: await getHermesVersion(),
    };
  }

  if (config.mode === "ssh") {
    const [running, version] = await Promise.all([
      sshGatewayStatus(config.ssh, profile),
      sshGetHermesVersion(config.ssh),
    ]);
    return {
      health: running ? "online" : "offline",
      latencyMs: elapsed(startedAt),
      authentication: running || version ? "authenticated" : "unknown",
      version,
    };
  }

  try {
    const detected = await probeRemoteAuthMode(
      config.remoteUrl,
      fetch,
      config.apiKey,
    );
    if (detected.authMode === "oauth") {
      const session = await remoteOAuthSessionState(config.remoteUrl);
      return {
        health: "online",
        latencyMs: elapsed(startedAt),
        authentication: session.signedIn ? "authenticated" : "required",
        version: detected.version,
      };
    }
    const authenticated = await testRemoteConnection(
      config.remoteUrl,
      config.apiKey,
    );
    return {
      health: "online",
      latencyMs: elapsed(startedAt),
      authentication: authenticated
        ? config.apiKey
          ? "authenticated"
          : "not-required"
        : "required",
      version: detected.version,
    };
  } catch {
    return {
      health: "offline",
      latencyMs: elapsed(startedAt),
      authentication: "unknown",
      version: null,
    };
  }
}

// @lat: [[connections#Per-connection status]]
export async function getConnectionStatuses(
  profile?: string,
): Promise<ConnectionStatusSnapshot[]> {
  const registry = getConnectionRegistry();
  return Promise.all(
    registry.connections.map(async (connection) => {
      const checkedAt = Date.now();
      const probe = await probeConnection(connection, profile);
      const evidence =
        connection.connectionId === registry.activeConnectionId
          ? await getAgentCapabilityEvidence(
              profile,
              connection.connectionId,
              connection.config,
            )
          : getCachedAgentCapabilityEvidence(connection.connectionId, profile);
      const versionText =
        probe.version && /^\d/.test(probe.version)
          ? `Hermes Agent v${probe.version}`
          : probe.version;
      return {
        connectionId: connection.connectionId,
        checkedAt,
        ...probe,
        capabilities: buildAgentCapabilitySnapshot({
          ...evidence,
          checkedAt,
          connectionMode: connection.config.mode,
          versionText,
        }),
      };
    }),
  );
}
