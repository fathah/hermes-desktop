import { ipcRenderer } from "electron";
import type { Attachment } from "../../shared/attachments";
import type { MemoryInfo } from "../../shared/memory";
import type { MemoryTimeline } from "../../shared/memoryTimeline";
import type {
  CreateLearningProposalInput,
  LearningProposal,
  LearningProposalResult,
  SkillUsageEntry,
} from "../../shared/learning";
import type {
  GatewayHealthStatus,
  GatewayHealthChange,
} from "../../shared/gateway";
import type { WhatsAppCloudStatus } from "../../shared/whatsappCloud";

export const agentBridge = {
  // Gateway
  startGateway: (): Promise<boolean> => ipcRenderer.invoke("start-gateway"),
  stopGateway: (): Promise<boolean> => ipcRenderer.invoke("stop-gateway"),
  gatewayStatus: (): Promise<boolean> => ipcRenderer.invoke("gateway-status"),
  gatewayHealthStatus: (): Promise<GatewayHealthStatus> =>
    ipcRenderer.invoke("gateway-health-status"),
  onGatewayHealthChanged: (
    callback: (change: GatewayHealthChange) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ): void => callback(payload as GatewayHealthChange);
    ipcRenderer.on("gateway-health-changed", handler);
    return () => ipcRenderer.removeListener("gateway-health-changed", handler);
  },

  // Platform toggles
  getPlatformEnabled: (profile?: string): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke("get-platform-enabled", profile),
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-platform-enabled", platform, enabled, profile),
  getWhatsAppCloudStatus: (
    profile?: string,
  ): Promise<WhatsAppCloudStatus> =>
    ipcRenderer.invoke("get-whatsapp-cloud-status", profile),

  // Sessions
  listSessions: (
    limit?: number,
    offset?: number,
  ): Promise<
    Array<{
      id: string;
      source: string;
      startedAt: number;
      endedAt: number | null;
      messageCount: number;
      model: string;
      title: string | null;
      preview: string;
    }>
  > => ipcRenderer.invoke("list-sessions", limit, offset),

  getSessionMessages: (
    sessionId: string,
  ): Promise<
    Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      timestamp: number;
      attachments?: Attachment[];
    }>
  > => ipcRenderer.invoke("get-session-messages", sessionId),

  // Profiles
  listProfiles: (): Promise<
    Array<{
      name: string;
      path: string;
      isDefault: boolean;
      isActive: boolean;
      model: string;
      provider: string;
      hasEnv: boolean;
      hasSoul: boolean;
      skillCount: number;
      gatewayRunning: boolean;
    }>
  > => ipcRenderer.invoke("list-profiles"),

  createProfile: (
    name: string,
    clone: boolean,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("create-profile", name, clone),

  deleteProfile: (
    name: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("delete-profile", name),

  setActiveProfile: (name: string): Promise<boolean> =>
    ipcRenderer.invoke("set-active-profile", name),

  // Memory
  readMemory: (profile?: string): Promise<MemoryInfo> =>
    ipcRenderer.invoke("read-memory", profile),

  /** Memory entries enriched with originating-session provenance (idea A4). */
  getMemoryTimeline: (profile?: string): Promise<MemoryTimeline> =>
    ipcRenderer.invoke("get-memory-timeline", profile),

  listLearningProposals: (profile?: string): Promise<LearningProposal[]> =>
    ipcRenderer.invoke("list-learning-proposals", profile),
  createLearningProposal: (
    input: CreateLearningProposalInput,
    profile?: string,
  ): Promise<LearningProposalResult> =>
    ipcRenderer.invoke("create-learning-proposal", input, profile),
  acceptLearningProposal: (
    id: string,
    profile?: string,
  ): Promise<LearningProposalResult> =>
    ipcRenderer.invoke("accept-learning-proposal", id, profile),
  dismissLearningProposal: (
    id: string,
    profile?: string,
  ): Promise<LearningProposalResult> =>
    ipcRenderer.invoke("dismiss-learning-proposal", id, profile),
  rollbackLearningProposal: (
    id: string,
    profile?: string,
  ): Promise<LearningProposalResult> =>
    ipcRenderer.invoke("rollback-learning-proposal", id, profile),

  addMemoryEntry: (
    content: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("add-memory-entry", content, profile),
  updateMemoryEntry: (
    index: number,
    content: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("update-memory-entry", index, content, profile),
  removeMemoryEntry: (index: number, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("remove-memory-entry", index, profile),
  writeUserProfile: (
    content: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("write-user-profile", content, profile),
  writeMemory: (
    content: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("write-memory", content, profile),

  // Personalization (focus.md + daily-context hook)
  readFocus: (): Promise<string> => ipcRenderer.invoke("read-focus"),
  writeFocus: (
    content: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("write-focus", content),
  getDailyContextHookStatus: (
    profile?: string,
  ): Promise<{
    configured: boolean;
    allowlisted: boolean;
    scriptExists: boolean;
    enabled: boolean;
  }> => ipcRenderer.invoke("get-daily-context-hook-status", profile),
  setDailyContextHookEnabled: (
    enabled: boolean,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-daily-context-hook-enabled", enabled, profile),

  // Soul
  readSoul: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("read-soul", profile),
  writeSoul: (content: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("write-soul", content, profile),
  resetSoul: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("reset-soul", profile),

  // Tools
  getToolsets: (
    profile?: string,
  ): Promise<
    Array<{ key: string; label: string; description: string; enabled: boolean }>
  > => ipcRenderer.invoke("get-toolsets", profile),
  setToolsetEnabled: (
    key: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-toolset-enabled", key, enabled, profile),

  // Skills
  listInstalledSkills: (
    profile?: string,
  ): Promise<
    Array<{ name: string; category: string; description: string; path: string }>
  > => ipcRenderer.invoke("list-installed-skills", profile),
  listBundledSkills: (): Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      installed: boolean;
    }>
  > => ipcRenderer.invoke("list-bundled-skills"),
  getSkillContent: (skillPath: string): Promise<string> =>
    ipcRenderer.invoke("get-skill-content", skillPath),
  loadSkillToChat: (
    name: string,
    profile?: string,
  ): Promise<{
    ok: boolean;
    name?: string;
    path?: string;
    alreadyLoaded?: boolean;
    error?: string;
  }> => ipcRenderer.invoke("load-skill-to-chat", name, profile),
  unloadSkillFromChat: (
    name?: string,
    profile?: string,
  ): Promise<{ ok: boolean; removed: string[] }> =>
    ipcRenderer.invoke("unload-skill-from-chat", name, profile),
  listActiveSkills: (
    profile?: string,
  ): Promise<Array<{ name: string; path: string }>> =>
    ipcRenderer.invoke("list-active-skills", profile),
  listSkillUsage: (
    profile?: string,
  ): Promise<Record<string, SkillUsageEntry>> =>
    ipcRenderer.invoke("list-skill-usage", profile),
  installSkill: (
    identifier: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("install-skill", identifier, profile),
  uninstallSkill: (
    name: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("uninstall-skill", name, profile),
  searchSkills: (
    query: string,
  ): Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      installed: boolean;
    }>
  > => ipcRenderer.invoke("search-skills", query),
  createSkill: (input: {
    name: string;
    description?: string;
    category?: string;
    body?: string;
    profile?: string;
  }): Promise<{ success: boolean; error?: string; path?: string }> =>
    ipcRenderer.invoke("create-skill", input),
  writeSkillContent: (
    skillPath: string,
    content: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("write-skill-content", skillPath, content, profile),
  listDisabledSkills: (
    profile?: string,
  ): Promise<
    Array<{ name: string; category: string; description: string; path: string }>
  > => ipcRenderer.invoke("list-disabled-skills", profile),
  setSkillEnabled: (
    skillPath: string,
    enabled: boolean,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-skill-enabled", skillPath, enabled, profile),
  discoverLocalSkills: (
    profile?: string,
  ): Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      sourcePath: string;
    }>
  > => ipcRenderer.invoke("discover-local-skills", profile),
  importLocalSkill: (
    sourcePath: string,
    category?: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("import-local-skill", sourcePath, category, profile),
  generateSkillFromRepo: (
    repoPath: string,
    profile?: string,
  ): Promise<{
    success: boolean;
    draft?: { name: string; description: string; body: string };
    error?: string;
  }> => ipcRenderer.invoke("generate-skill-from-repo", repoPath, profile),

  // Session cache (fast local cache with generated titles)
  listCachedSessions: (
    limit?: number,
    offset?: number,
  ): Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
    }>
  > => ipcRenderer.invoke("list-cached-sessions", limit, offset),

  syncSessionCache: (): Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
    }>
  > => ipcRenderer.invoke("sync-session-cache"),

  updateSessionTitle: (sessionId: string, title: string): Promise<void> =>
    ipcRenderer.invoke("update-session-title", sessionId, title),
  deleteSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("delete-session", sessionId),

  // Session search
  searchSessions: (
    query: string,
    limit?: number,
  ): Promise<
    Array<{
      sessionId: string;
      title: string | null;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      snippet: string;
    }>
  > => ipcRenderer.invoke("search-sessions", query, limit),

  getObsidianConfig: (profile?: string) =>
    ipcRenderer.invoke("get-obsidian-config", profile),
  setObsidianConfig: (
    input: {
      vaultPath: string;
      vaultName?: string;
      vaultId?: string;
      bridgeUrl?: string;
      bridgeToken?: string;
    },
    profile?: string,
  ) => ipcRenderer.invoke("set-obsidian-config", input, profile),
  getObsidianTree: (profile?: string) =>
    ipcRenderer.invoke("get-obsidian-tree", profile),
  readObsidianFile: (path: string, profile?: string) =>
    ipcRenderer.invoke("read-obsidian-file", path, profile),
  writeObsidianFile: (path: string, content: string, profile?: string) =>
    ipcRenderer.invoke("write-obsidian-file", path, content, profile),
  appendObsidianFile: (path: string, content: string, profile?: string) =>
    ipcRenderer.invoke("append-obsidian-file", path, content, profile),
  searchObsidian: (query: string, limit?: number, profile?: string) =>
    ipcRenderer.invoke("search-obsidian", query, limit, profile),
  openObsidianNote: (path: string, profile?: string) =>
    ipcRenderer.invoke("open-obsidian-note", path, profile),
  callObsidianFunction: (
    name:
      | "status"
      | "active-note"
      | "open-note"
      | "insert-at-cursor"
      | "replace-selection"
      | "run-command"
      | "write-note",
    payload?: Record<string, unknown>,
    profile?: string,
  ) => ipcRenderer.invoke("call-obsidian-function", name, payload, profile),
  onObsidianFileChanged: (
    callback: (event: { path: string; content: string }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ): void => callback(payload as { path: string; content: string });
    ipcRenderer.on("obsidian-file-changed", handler);
    return () => ipcRenderer.removeListener("obsidian-file-changed", handler);
  },
};
