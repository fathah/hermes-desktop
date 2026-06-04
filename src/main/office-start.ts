import type { ConnectionConfig, SshConnectionConfig } from "./config";

type StartResult = { success: boolean; error?: string };

export interface OfficeStartDependencies {
  getConnectionConfig: () => ConnectionConfig;
  isGatewayRunning: (profile?: string) => boolean;
  startGateway: (profile?: string) => boolean;
  sshGatewayStatus: (config: SshConnectionConfig) => Promise<boolean>;
  sshStartGateway: (config: SshConnectionConfig) => Promise<void>;
  startSshTunnel: (config: SshConnectionConfig) => Promise<void>;
  sshReadRemoteApiKey: (config: SshConnectionConfig) => Promise<string>;
  setSshRemoteApiKey: (key: string) => void;
  startClaw3dAll: () => StartResult;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startOfficeStack(
  profile: string | undefined,
  deps: OfficeStartDependencies,
): Promise<StartResult> {
  try {
    const conn = deps.getConnectionConfig();

    if (conn.mode === "ssh") {
      if (!(await deps.sshGatewayStatus(conn.ssh))) {
        await deps.sshStartGateway(conn.ssh);
      }
      await deps.startSshTunnel(conn.ssh);
      deps.setSshRemoteApiKey(await deps.sshReadRemoteApiKey(conn.ssh));
    } else if (conn.mode === "local" && !deps.isGatewayRunning(profile)) {
      deps.startGateway(profile);
    }

    return deps.startClaw3dAll();
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
