import { ipcRenderer } from "electron";
import type { CapabilityRiskSummary } from "../../shared/capability-risk";
import type { ResearchReachStatus } from "../../shared/research-reach";

export const toolsmiscBridge = {
  // Shell
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),

  // Backup / Import
  runHermesBackup: (
    profile?: string,
  ): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("run-hermes-backup", profile),

  runHermesImport: (
    archivePath: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("run-hermes-import", archivePath, profile),

  // Debug dump
  runHermesDump: (): Promise<string> => ipcRenderer.invoke("run-hermes-dump"),

  // Memory providers
  discoverMemoryProviders: (
    profile?: string,
  ): Promise<
    Array<{
      name: string;
      description: string;
      installed: boolean;
      active: boolean;
      envVars: string[];
    }>
  > => ipcRenderer.invoke("discover-memory-providers", profile),

  // MCP servers
  listMcpServers: (
    profile?: string,
  ): Promise<
    Array<{ name: string; type: string; enabled: boolean; detail: string }>
  > => ipcRenderer.invoke("list-mcp-servers", profile),
  getCapabilityRiskSummary: (
    profile?: string,
  ): Promise<CapabilityRiskSummary> =>
    ipcRenderer.invoke("capability-risk-summary", profile),
  checkCapabilityRisksNow: (profile?: string): Promise<CapabilityRiskSummary> =>
    ipcRenderer.invoke("capability-risk-check-now", profile),
  reviewCapabilityRisk: (
    id: string,
    profile?: string,
  ): Promise<CapabilityRiskSummary> =>
    ipcRenderer.invoke("capability-risk-review", id, profile),

  // Research Reach
  getResearchReachStatus: (): Promise<ResearchReachStatus> =>
    ipcRenderer.invoke("research-reach-status"),
  getResearchReachInstallInstructions: (): Promise<string> =>
    ipcRenderer.invoke("research-reach-install-instructions"),
  runResearchReachSafeInstall: (): Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
  }> => ipcRenderer.invoke("research-reach-safe-install"),
  importAgentReachSkill: (
    profile?: string,
  ): Promise<{ imported: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("research-reach-import-skill", profile),

  // Log viewer
  readLogs: (
    logFile?: string,
    lines?: number,
  ): Promise<{ content: string; path: string }> =>
    ipcRenderer.invoke("read-logs", logFile, lines),
};
