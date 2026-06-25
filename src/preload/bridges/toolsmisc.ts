import { ipcRenderer } from "electron";
import type { CapabilityRiskSummary } from "../../shared/capability-risk";
import type { ResearchReachStatus } from "../../shared/research-reach";
import type {
  McpCatalogResult,
  McpOperationResult,
  McpServerInfo,
  McpServerInput,
} from "../api-types";
import type { ToolsmiscBridgeApi } from "./toolsmisc.types";

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
  listMcpServers: (profile?: string): Promise<McpServerInfo[]> =>
    ipcRenderer.invoke("list-mcp-servers", profile),
  addMcpServer: (
    input: McpServerInput,
    profile?: string,
  ): Promise<McpOperationResult> =>
    ipcRenderer.invoke("add-mcp-server", input, profile),
  removeMcpServer: (
    name: string,
    profile?: string,
  ): Promise<McpOperationResult> =>
    ipcRenderer.invoke("remove-mcp-server", name, profile),
  setMcpServerEnabled: (
    name: string,
    enabled: boolean,
    profile?: string,
  ): Promise<McpOperationResult> =>
    ipcRenderer.invoke("set-mcp-server-enabled", name, enabled, profile),
  testMcpServer: (
    name: string,
    profile?: string,
  ): Promise<McpOperationResult> =>
    ipcRenderer.invoke("test-mcp-server", name, profile),
  listMcpCatalog: (profile?: string): Promise<McpCatalogResult> =>
    ipcRenderer.invoke("list-mcp-catalog", profile),
  installMcpCatalogEntry: (
    name: string,
    env?: Record<string, string>,
    profile?: string,
  ): Promise<McpOperationResult> =>
    ipcRenderer.invoke("install-mcp-catalog-entry", name, env, profile),
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
} satisfies ToolsmiscBridgeApi;
