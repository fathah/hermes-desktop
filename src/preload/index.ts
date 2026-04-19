import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

const hermesAPI = {
  // Installation
  checkInstall: (): Promise<{
    installed: boolean;
    configured: boolean;
    hasApiKey: boolean;
  }> => ipcRenderer.invoke("check-install"),

  startInstall: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("start-install"),

  onInstallProgress: (
    callback: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: unknown,
    ): void =>
      callback(
        progress as {
          step: number;
          totalSteps: number;
          title: string;
          detail: string;
          log: string;
        },
      );
    ipcRenderer.on("install-progress", handler);
    return () => ipcRenderer.removeListener("install-progress", handler);
  },

  // Hermes engine info
  getHermesVersion: (): Promise<string | null> =>
    ipcRenderer.invoke("get-hermes-version"),
  refreshHermesVersion: (): Promise<string | null> =>
    ipcRenderer.invoke("refresh-hermes-version"),
  runHermesDoctor: (): Promise<string> =>
    ipcRenderer.invoke("run-hermes-doctor"),
  runHermesUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("run-hermes-update"),

  // OpenClaw migration
  checkOpenClaw: (): Promise<{ found: boolean; path: string | null }> =>
    ipcRenderer.invoke("check-openclaw"),
  runClawMigrate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("run-claw-migrate"),

  getLocale: (): Promise<"en"> => ipcRenderer.invoke("get-locale"),
  setLocale: (locale: "en"): Promise<"en"> =>
    ipcRenderer.invoke("set-locale", locale),

  // Configuration (profile-aware)
  getEnv: (profile?: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke("get-env", profile),

  setEnv: (key: string, value: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("set-env", key, value, profile),

  getConfig: (key: string, profile?: string): Promise<string | null> =>
    ipcRenderer.invoke("get-config", key, profile),

  setConfig: (key: string, value: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("set-config", key, value, profile),

  getHermesHome: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("get-hermes-home", profile),

  getModelConfig: (
    profile?: string,
  ): Promise<{ provider: string; model: string; baseUrl: string }> =>
    ipcRenderer.invoke("get-model-config", profile),

  setModelConfig: (
    provider: string,
    model: string,
    baseUrl: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-model-config", provider, model, baseUrl, profile),

  // Chat
  sendMessage: (
    message: string,
    profile?: string,
    resumeSessionId?: string,
    history?: Array<{ role: string; content: string }>,
  ): Promise<{ response: string; sessionId?: string }> =>
    ipcRenderer.invoke(
      "send-message",
      message,
      profile,
      resumeSessionId,
      history,
    ),

  abortChat: (): Promise<void> => ipcRenderer.invoke("abort-chat"),

  onChatChunk: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string): void =>
      callback(chunk);
    ipcRenderer.on("chat-chunk", handler);
    return () => ipcRenderer.removeListener("chat-chunk", handler);
  },

  onChatDone: (callback: (sessionId?: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      sessionId?: string,
    ): void => callback(sessionId);
    ipcRenderer.on("chat-done", handler);
    return () => ipcRenderer.removeListener("chat-done", handler);
  },

  onChatToolProgress: (callback: (tool: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tool: string): void =>
      callback(tool);
    ipcRenderer.on("chat-tool-progress", handler);
    return () => ipcRenderer.removeListener("chat-tool-progress", handler);
  },

  onChatUsage: (
    callback: (usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cost?: number;
      rateLimitRemaining?: number;
      rateLimitReset?: number;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, usage: unknown): void =>
      callback(
        usage as {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          cost?: number;
          rateLimitRemaining?: number;
          rateLimitReset?: number;
        },
      );
    ipcRenderer.on("chat-usage", handler);
    return () => ipcRenderer.removeListener("chat-usage", handler);
  },

  onChatError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void =>
      callback(error);
    ipcRenderer.on("chat-error", handler);
    return () => ipcRenderer.removeListener("chat-error", handler);
  },

  // Gateway
  startGateway: (): Promise<boolean> => ipcRenderer.invoke("start-gateway"),
  stopGateway: (): Promise<boolean> => ipcRenderer.invoke("stop-gateway"),
  gatewayStatus: (): Promise<boolean> => ipcRenderer.invoke("gateway-status"),

  // Platform toggles
  getPlatformEnabled: (profile?: string): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke("get-platform-enabled", profile),
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-platform-enabled", platform, enabled, profile),

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
  readMemory: (
    profile?: string,
  ): Promise<{
    memory: { content: string; exists: boolean; lastModified: number | null };
    user: { content: string; exists: boolean; lastModified: number | null };
    stats: { totalSessions: number; totalMessages: number };
  }> => ipcRenderer.invoke("read-memory", profile),

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

  // Credential Pool
  getCredentialPool: (): Promise<
    Record<string, Array<{ key: string; label: string }>>
  > => ipcRenderer.invoke("get-credential-pool"),
  setCredentialPool: (
    provider: string,
    entries: Array<{ key: string; label: string }>,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-credential-pool", provider, entries),

  // Models
  listModels: (): Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      createdAt: number;
    }>
  > => ipcRenderer.invoke("list-models"),

  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
  ): Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    createdAt: number;
  }> => ipcRenderer.invoke("add-model", name, provider, model, baseUrl),

  removeModel: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("remove-model", id),

  updateModel: (id: string, fields: Record<string, string>): Promise<boolean> =>
    ipcRenderer.invoke("update-model", id, fields),

  // Claw3D
  claw3dStatus: (): Promise<{
    cloned: boolean;
    installed: boolean;
    devServerRunning: boolean;
    adapterRunning: boolean;
    port: number;
    portInUse: boolean;
    wsUrl: string;
    running: boolean;
    error: string;
  }> => ipcRenderer.invoke("claw3d-status"),

  claw3dSetup: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("claw3d-setup"),

  onClaw3dSetupProgress: (
    callback: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: unknown,
    ): void =>
      callback(
        progress as {
          step: number;
          totalSteps: number;
          title: string;
          detail: string;
          log: string;
        },
      );
    ipcRenderer.on("claw3d-setup-progress", handler);
    return () => ipcRenderer.removeListener("claw3d-setup-progress", handler);
  },

  claw3dGetPort: (): Promise<number> => ipcRenderer.invoke("claw3d-get-port"),
  claw3dSetPort: (port: number): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-set-port", port),
  claw3dGetWsUrl: (): Promise<string> =>
    ipcRenderer.invoke("claw3d-get-ws-url"),
  claw3dSetWsUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-set-ws-url", url),

  claw3dStartAll: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("claw3d-start-all"),
  claw3dStopAll: (): Promise<boolean> => ipcRenderer.invoke("claw3d-stop-all"),
  claw3dGetLogs: (): Promise<string> => ipcRenderer.invoke("claw3d-get-logs"),

  claw3dStartDev: (): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-start-dev"),
  claw3dStopDev: (): Promise<boolean> => ipcRenderer.invoke("claw3d-stop-dev"),
  claw3dStartAdapter: (): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-start-adapter"),
  claw3dStopAdapter: (): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-stop-adapter"),

  // Updates
  checkForUpdates: (): Promise<string | null> =>
    ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke("download-update"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("install-update"),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("get-app-version"),

  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes: string }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown): void =>
      callback(info as { version: string; releaseNotes: string });
    ipcRenderer.on("update-available", handler);
    return () => ipcRenderer.removeListener("update-available", handler);
  },

  onUpdateDownloadProgress: (
    callback: (info: { percent: number }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown): void =>
      callback(info as { percent: number });
    ipcRenderer.on("update-download-progress", handler);
    return () =>
      ipcRenderer.removeListener("update-download-progress", handler);
  },

  onUpdateDownloaded: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("update-downloaded", handler);
    return () => ipcRenderer.removeListener("update-downloaded", handler);
  },

  // Menu events (from native menu bar)
  onMenuNewChat: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("menu-new-chat", handler);
    return () => ipcRenderer.removeListener("menu-new-chat", handler);
  },

  onMenuSearchSessions: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("menu-search-sessions", handler);
    return () => ipcRenderer.removeListener("menu-search-sessions", handler);
  },

  // Cron Jobs
  listCronJobs: (
    includeDisabled?: boolean,
    profile?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      schedule: string;
      prompt: string;
      state: "active" | "paused" | "completed";
      enabled: boolean;
      next_run_at: string | null;
      last_run_at: string | null;
      last_status: string | null;
      last_error: string | null;
      repeat: { times: number | null; completed: number } | null;
      deliver: string[];
      skills: string[];
      script: string | null;
    }>
  > => ipcRenderer.invoke("list-cron-jobs", includeDisabled, profile),

  createCronJob: (
    schedule: string,
    prompt?: string,
    name?: string,
    deliver?: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(
      "create-cron-job",
      schedule,
      prompt,
      name,
      deliver,
      profile,
    ),

  removeCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("remove-cron-job", jobId, profile),

  pauseCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("pause-cron-job", jobId, profile),

  resumeCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("resume-cron-job", jobId, profile),

  triggerCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("trigger-cron-job", jobId, profile),

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

  // Log viewer
  readLogs: (
    logFile?: string,
    lines?: number,
  ): Promise<{ content: string; path: string }> =>
    ipcRenderer.invoke("read-logs", logFile, lines),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("hermesAPI", hermesAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.hermesAPI = hermesAPI;
}
