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

  listMcpServers: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; type: string; enabled: boolean; detail: string }>
  >;

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

  // SPS Agent workspace
}
