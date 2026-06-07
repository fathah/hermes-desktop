// Shared connection-config IPC types — single source of truth for the
// local / remote / ssh connection surface. Producer: src/main/config.ts.
// Contract: src/preload/index.d.ts. (The private ConnectionConfig — which
// carries the apiKey secret — stays in main; only the Public* shape crosses IPC.)

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

export interface PublicConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  hasApiKey: boolean;
  // Length of the stored API key, exposed so the renderer can show a
  // mask that matches the real value's width. The secret itself never
  // leaves the main process. 0 when no key is set.
  apiKeyLength: number;
  ssh: SshConnectionConfig;
}
