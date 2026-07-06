import type * as Api from "../api-types";

export interface ToolsmiscBridgeApi {
  openExternal: (url: string) => Promise<void>;

  // Backup / Import

  runHermesBackup: (
    profile?: string,
  ) => Promise<{ success: boolean; path?: string; error?: string }>;

  runHermesImport: (
    archivePath: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Debug dump

  runHermesDump: () => Promise<string>;

  // Memory providers

  discoverMemoryProviders: (profile?: string) => Promise<
    Array<{
      name: string;
      description: string;
      installed: boolean;
      active: boolean;
      envVars: string[];
    }>
  >;

  // MCP servers

  listMcpServers: (profile?: string) => Promise<Api.McpServerInfo[]>;

  addMcpServer: (
    input: Api.McpServerInput,
    profile?: string,
  ) => Promise<Api.McpOperationResult>;

  removeMcpServer: (
    name: string,
    profile?: string,
  ) => Promise<Api.McpOperationResult>;

  setMcpServerEnabled: (
    name: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<Api.McpOperationResult>;

  testMcpServer: (
    name: string,
    profile?: string,
  ) => Promise<Api.McpOperationResult>;

  listMcpCatalog: (profile?: string) => Promise<Api.McpCatalogResult>;

  installMcpCatalogEntry: (
    name: string,
    env?: Record<string, string>,
    profile?: string,
  ) => Promise<Api.McpOperationResult>;

  getCapabilityRiskSummary: (
    profile?: string,
  ) => Promise<Api.CapabilityRiskSummary>;

  checkCapabilityRisksNow: (
    profile?: string,
  ) => Promise<Api.CapabilityRiskSummary>;

  reviewCapabilityRisk: (
    id: string,
    profile?: string,
  ) => Promise<Api.CapabilityRiskSummary>;

  getResearchReachStatus: () => Promise<Api.ResearchReachStatus>;

  getResearchReachInstallInstructions: () => Promise<string>;

  runResearchReachSafeInstall: () => Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
  }>;

  importAgentReachSkill: (
    profile?: string,
  ) => Promise<{ imported: boolean; path?: string; error?: string }>;

  // Log viewer

  readLogs: (
    logFile?: string,
    lines?: number,
  ) => Promise<{ content: string; path: string }>;

  // Diagnostics (MED-10) — local errors-only sink

  systemOpenLogs: () => Promise<string>;

  systemReadErrorLog: (lines?: number) => Promise<string[]>;

  systemClearErrorLog: () => Promise<boolean>;

  // SPS Agent workspace
}
