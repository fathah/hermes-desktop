import type {
  SshConnectionConfig,
  PublicConnectionConfig,
} from "../../shared/connection";
import { readDesktopConfig, writeDesktopConfig } from "./desktop-store";

export type { SshConnectionConfig, PublicConnectionConfig };

// ── Connection Config (local / remote / ssh) ─────────────

export interface ConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  apiKey: string;
  ssh: SshConnectionConfig;
}

export function getConnectionConfig(): ConnectionConfig {
  const data = readDesktopConfig();
  const ssh = (data.sshConfig as Partial<SshConnectionConfig>) ?? {};
  return {
    mode: (data.connectionMode as "local" | "remote" | "ssh") || "local",
    remoteUrl: (data.remoteUrl as string) || "",
    apiKey: (data.remoteApiKey as string) || "",
    ssh: {
      host: (ssh.host as string) || "",
      port: (ssh.port as number) || 22,
      username: (ssh.username as string) || "",
      keyPath: (ssh.keyPath as string) || "",
      remotePort: (ssh.remotePort as number) || 8642,
      localPort: (ssh.localPort as number) || 18642,
    },
  };
}

export function getPublicConnectionConfig(): PublicConnectionConfig {
  const config = getConnectionConfig();
  return {
    mode: config.mode,
    remoteUrl: config.remoteUrl,
    hasApiKey: config.apiKey.length > 0,
    apiKeyLength: config.apiKey.length,
    ssh: config.ssh,
  };
}

export function setConnectionConfig(config: ConnectionConfig): void {
  const data = readDesktopConfig();
  data.connectionMode = config.mode;
  data.remoteUrl = config.remoteUrl;
  data.remoteApiKey = config.apiKey;
  if (config.mode === "ssh") {
    data.sshConfig = config.ssh;
  }
  writeDesktopConfig(data);
}

export function resolveConnectionApiKeyUpdate(
  existing: ConnectionConfig,
  mode: "local" | "remote" | "ssh",
  remoteUrl: string,
  apiKey?: string,
): string {
  if (apiKey !== undefined) return apiKey;
  if (existing.mode === mode && existing.remoteUrl === remoteUrl) {
    return existing.apiKey;
  }
  return "";
}
