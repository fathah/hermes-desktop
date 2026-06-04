import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppLocale } from "../shared/i18n/types";
import type { Attachment } from "../shared/attachments";
import type { UsageAggregate } from "../shared/usage";
import type { MemoryTimeline } from "../shared/memoryTimeline";
import type { SearchSummary } from "../shared/searchSummary";
import type { LoadedSkin } from "../shared/skins";

/**
 * Mirror of the renderer-side `CredentialPoolEntry` ambient type
 * (src/preload/index.d.ts) — preload is type-checked under
 * tsconfig.node.json which doesn't include the .d.ts. See #367.
 */
interface CredentialPoolEntry {
  id?: string;
  label?: string;
  auth_type?: "api_key" | "oauth_device_code" | string;
  priority?: number;
  source?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  base_url?: string;
  request_count?: number;
  key?: string;
}

const electronAPI = {
  process: {
    platform: process.platform,
    versions: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  },
};

const hermesAPI = {
  // Installation
  checkInstall: (): Promise<{
    installed: boolean;
    configured: boolean;
    hasApiKey: boolean;
  }> => ipcRenderer.invoke("check-install"),

  verifyInstall: (): Promise<boolean> => ipcRenderer.invoke("verify-install"),

  startInstall: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("start-install"),

  // Pre-install inspection + "use an existing installation" (issue #272)
  inspectInstallTarget: (): Promise<{
    hermesHome: string;
    repoPath: string;
    state: "fresh" | "update" | "replace";
  }> => ipcRenderer.invoke("inspect-install-target"),

  validateHermesHome: (dir: string): Promise<boolean> =>
    ipcRenderer.invoke("validate-hermes-home", dir),

  adoptHermesHome: (dir: string): Promise<boolean> =>
    ipcRenderer.invoke("adopt-hermes-home", dir),

  quitApp: (): Promise<void> => ipcRenderer.invoke("quit-app"),

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

  // OAuth provider sign-in
  oauthLogin: (
    provider: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("oauth-login", provider, profile),
  cancelOAuthLogin: (): Promise<boolean> =>
    ipcRenderer.invoke("oauth-login-cancel"),
  onOAuthLoginProgress: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: unknown): void =>
      callback(String(chunk));
    ipcRenderer.on("oauth-login-progress", handler);
    return () => ipcRenderer.removeListener("oauth-login-progress", handler);
  },

  getLocale: (): Promise<AppLocale> => ipcRenderer.invoke("get-locale"),
  setLocale: (locale: AppLocale): Promise<AppLocale> =>
    ipcRenderer.invoke("set-locale", locale),

  // Configuration (profile-aware)
  getEnv: (profile?: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke("get-env", profile),

  setEnv: (key: string, value: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("set-env", key, value, profile),

  validateChatReadiness: (
    profile?: string,
  ): Promise<{
    ok: boolean;
    code?:
      | "NO_ACTIVE_MODEL"
      | "NO_PROVIDER"
      | "NO_BASE_URL"
      | "MISSING_API_KEY"
      | "GATEWAY_DOWN";
    message?: string;
    fixLocation?: "providers" | "models" | "gateway" | "setup";
    expectedEnvKey?: string;
  }> => ipcRenderer.invoke("validate-chat-readiness", profile),

  getConfigHealth: (profile?: string): Promise<unknown> =>
    ipcRenderer.invoke("get-config-health", profile),
  rerunConfigHealth: (profile?: string): Promise<unknown> =>
    ipcRenderer.invoke("rerun-config-health", profile),
  autofixConfigIssue: (
    code: string,
    profile?: string,
    context?: Record<string, string>,
  ): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke("autofix-config-issue", code, profile, context),
  getConfigFixLog: (maxEntries?: number): Promise<unknown[]> =>
    ipcRenderer.invoke("get-config-fix-log", maxEntries),

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

  // Connection mode (local / remote / ssh)
  isRemoteMode: (): Promise<boolean> => ipcRenderer.invoke("is-remote-mode"),
  isRemoteOnlyMode: (): Promise<boolean> =>
    ipcRenderer.invoke("is-remote-only-mode"),
  getConnectionConfig: (): Promise<{
    mode: "local" | "remote" | "ssh";
    remoteUrl: string;
    hasApiKey: boolean;
    ssh: {
      host: string;
      port: number;
      username: string;
      keyPath: string;
      remotePort: number;
      localPort: number;
    };
  }> => ipcRenderer.invoke("get-connection-config"),

  /** Usage / cost analytics for a profile (idea A2). */
  getUsageStats: (profile?: string): Promise<UsageAggregate> =>
    ipcRenderer.invoke("get-usage-stats", profile),

  /** Summarize session-search results for a query, with citations (idea A5). */
  summarizeSearch: (query: string, profile?: string): Promise<SearchSummary> =>
    ipcRenderer.invoke("summarize-search", query, profile),

  /** List validated skins (+ CSS-var maps) for a profile (idea A6). */
  listSkins: (profile?: string): Promise<LoadedSkin[]> =>
    ipcRenderer.invoke("list-skins", profile),

  /** Resolve a pending command-approval request (idea B1). */
  respondApproval: (
    runId: string,
    choice: "once" | "session" | "always" | "deny",
    profile?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("respond-approval", runId, choice, profile),

  setConnectionConfig: (
    mode: "local" | "remote" | "ssh",
    remoteUrl: string,
    apiKey?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-connection-config", mode, remoteUrl, apiKey),

  setSshConfig: (
    host: string,
    port: number,
    username: string,
    keyPath: string,
    remotePort: number,
    localPort: number,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "set-ssh-config",
      host,
      port,
      username,
      keyPath,
      remotePort,
      localPort,
    ),

  testRemoteConnection: (url: string, apiKey?: string): Promise<boolean> =>
    ipcRenderer.invoke("test-remote-connection", url, apiKey),

  testSshConnection: (
    host: string,
    port: number,
    username: string,
    keyPath: string,
    remotePort: number,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "test-ssh-connection",
      host,
      port,
      username,
      keyPath,
      remotePort,
    ),

  isSshTunnelActive: (): Promise<boolean> =>
    ipcRenderer.invoke("is-ssh-tunnel-active"),

  startSshTunnel: (): Promise<boolean> =>
    ipcRenderer.invoke("start-ssh-tunnel"),

  stopSshTunnel: (): Promise<boolean> => ipcRenderer.invoke("stop-ssh-tunnel"),

  // Chat
  sendMessage: (
    message: string,
    profile?: string,
    resumeSessionId?: string,
    history?: Array<{ role: string; content: string }>,
    attachments?: Attachment[],
    contextFolder?: string,
  ): Promise<{ response: string; sessionId?: string }> =>
    ipcRenderer.invoke(
      "send-message",
      message,
      profile,
      resumeSessionId,
      history,
      attachments,
      contextFolder,
    ),

  abortChat: (): Promise<void> => ipcRenderer.invoke("abort-chat"),

  getApiServerKeyStatus: (profile?: string): Promise<{ hasKey: boolean }> =>
    ipcRenderer.invoke("get-api-server-key-status", profile),

  generateApiServerKey: (profile?: string): Promise<{ key: string }> =>
    ipcRenderer.invoke("generate-api-server-key", profile),

  copyToClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke("copy-to-clipboard", text),

  // Media (agent-generated images / files — issue #299)
  readMediaFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("read-media-file", filePath),
  saveMediaFile: (src: string, name: string): Promise<boolean> =>
    ipcRenderer.invoke("save-media-file", src, name),
  mediaFileExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke("media-file-exists", filePath),
  showMediaMenu: (
    src: string,
    name: string,
    labels: { open: string; saveAs: string },
  ): void => {
    ipcRenderer.send("show-media-menu", src, name, labels);
  },

  // Resolve the absolute filesystem path for a File coming from drag-drop
  // or the file picker.  Returns "" for blobs that have no origin path
  // (e.g. clipboard paste) — caller should stageAttachment for those.
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },

  stageAttachment: (
    sessionId: string,
    filename: string,
    base64Bytes: string,
  ): Promise<string> =>
    ipcRenderer.invoke("stage-attachment", sessionId, filename, base64Bytes),

  clearStagedAttachments: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("clear-staged-attachments", sessionId),

  discoverProviderModels: (
    provider: string,
    baseUrl?: string,
    apiKey?: string,
    profile?: string,
  ): Promise<{
    models: string[];
    status: "ok" | "no-key" | "unsupported" | "unknown-host";
    cached: boolean;
    /** Subset of `models` flagged as free per the provider catalog
     *  (Nous Portal today). Optional — providers without pricing
     *  metadata return undefined. Issue #367. */
    freeModels?: string[];
  }> =>
    ipcRenderer.invoke(
      "discover-provider-models",
      provider,
      baseUrl,
      apiKey,
      profile,
    ),

  onChatChunk: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string): void =>
      callback(chunk);
    ipcRenderer.on("chat-chunk", handler);
    return () => ipcRenderer.removeListener("chat-chunk", handler);
  },

  /** Streaming reasoning / thinking tokens — separate from `onChatChunk`
   *  so the renderer can render a "thinking" bubble that grows
   *  independently of the assistant's content (#352). */
  onChatReasoningChunk: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string): void =>
      callback(chunk);
    ipcRenderer.on("chat-reasoning-chunk", handler);
    return () => ipcRenderer.removeListener("chat-reasoning-chunk", handler);
  },

  onChatDone: (callback: (sessionId?: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      sessionId?: string,
    ): void => callback(sessionId);
    ipcRenderer.on("chat-done", handler);
    return () => ipcRenderer.removeListener("chat-done", handler);
  },

  onContextMenuCopyChat: (
    callback: (format: "text" | "markdown") => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      format: "text" | "markdown",
    ): void => callback(format);
    ipcRenderer.on("context-menu-copy-chat", handler);
    return () => ipcRenderer.removeListener("context-menu-copy-chat", handler);
  },

  onContextMenuSelectBubble: (
    callback: (point: { x: number; y: number }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      point: { x: number; y: number },
    ): void => callback(point);
    ipcRenderer.on("context-menu-select-bubble", handler);
    return () =>
      ipcRenderer.removeListener("context-menu-select-bubble", handler);
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
      model?: string;
      sessionId?: string;
      cacheRead?: number;
      cacheWrite?: number;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, usage: unknown): void =>
      callback(usage as Parameters<typeof callback>[0]);
    ipcRenderer.on("chat-usage", handler);
    return () => ipcRenderer.removeListener("chat-usage", handler);
  },

  onChatError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void =>
      callback(error);
    ipcRenderer.on("chat-error", handler);
    return () => ipcRenderer.removeListener("chat-error", handler);
  },

  /** Gateway requested approval for a dangerous command (idea B1). The
   *  renderer renders an approval card and replies via `respondApproval`. */
  onChatApprovalRequest: (
    callback: (req: {
      id: string;
      command?: string;
      toolName?: string;
      patternKey?: string;
      description?: string;
      sessionKey?: string;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, req: unknown): void =>
      callback(req as Parameters<typeof callback>[0]);
    ipcRenderer.on("chat-approval-request", handler);
    return () => ipcRenderer.removeListener("chat-approval-request", handler);
  },

  /** Gateway recorded a filesystem checkpoint (idea B2). */
  onChatCheckpoint: (
    callback: (cp: {
      id: string;
      label?: string;
      turn?: number;
      createdAt?: string;
      sessionKey?: string;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, cp: unknown): void =>
      callback(cp as Parameters<typeof callback>[0]);
    ipcRenderer.on("chat-checkpoint", handler);
    return () => ipcRenderer.removeListener("chat-checkpoint", handler);
  },

  /** A delegated subagent reported progress (idea B3). */
  onChatDelegateProgress: (
    callback: (p: {
      id: string;
      parentId?: string;
      goal?: string;
      status: string;
      depth?: number;
      tool?: string;
      label?: string;
      sessionKey?: string;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, p: unknown): void =>
      callback(p as Parameters<typeof callback>[0]);
    ipcRenderer.on("chat-delegate-progress", handler);
    return () => ipcRenderer.removeListener("chat-delegate-progress", handler);
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
  readMemory: (
    profile?: string,
  ): Promise<{
    memory: { content: string; exists: boolean; lastModified: number | null };
    user: { content: string; exists: boolean; lastModified: number | null };
    stats: { totalSessions: number; totalMessages: number };
  }> => ipcRenderer.invoke("read-memory", profile),

  /** Memory entries enriched with originating-session provenance (idea A4). */
  getMemoryTimeline: (profile?: string): Promise<MemoryTimeline> =>
    ipcRenderer.invoke("get-memory-timeline", profile),

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

  // Credential Pool (profile-aware: reads/writes the named profile's
  // auth.json; defaults to the currently active profile when omitted)
  //
  // Pool entries follow the upstream engine schema (issue #367) —
  // `access_token` for the secret, `auth_type` to distinguish OAuth
  // from API key, plus `id`/`priority`/`source` for rotation.
  getCredentialPool: (
    profile?: string,
  ): Promise<Record<string, Array<CredentialPoolEntry>>> =>
    ipcRenderer.invoke("get-credential-pool", profile),
  setCredentialPool: (
    provider: string,
    entries: Array<CredentialPoolEntry>,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-credential-pool", provider, entries, profile),
  // Add a manually-typed key as a properly-shaped pool entry. Returns
  // the updated entries list for the provider.
  addCredentialPoolEntry: (
    provider: string,
    apiKey: string,
    label: string,
    profile?: string,
  ): Promise<Array<CredentialPoolEntry>> =>
    ipcRenderer.invoke(
      "add-credential-pool-entry",
      provider,
      apiKey,
      label,
      profile,
    ),

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
    remoteUrl?: string | null;
    remoteSource?: "ssh" | null;
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

  claw3dStartAll: (
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("claw3d-start-all", profile),
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

  onUpdateError: (callback: (message: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      message: unknown,
    ): void => callback(String(message));
    ipcRenderer.on("update-error", handler);
    return () => ipcRenderer.removeListener("update-error", handler);
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

  // Kanban
  kanbanListBoards: (includeArchived?: boolean, profile?: string) =>
    ipcRenderer.invoke("kanban-list-boards", includeArchived, profile),
  kanbanCurrentBoard: (profile?: string) =>
    ipcRenderer.invoke("kanban-current-board", profile),
  kanbanSwitchBoard: (slug: string, profile?: string) =>
    ipcRenderer.invoke("kanban-switch-board", slug, profile),
  kanbanCreateBoard: (
    slug: string,
    name?: string,
    switchAfter?: boolean,
    profile?: string,
  ) =>
    ipcRenderer.invoke("kanban-create-board", slug, name, switchAfter, profile),
  kanbanRemoveBoard: (slug: string, hardDelete?: boolean, profile?: string) =>
    ipcRenderer.invoke("kanban-remove-board", slug, hardDelete, profile),
  kanbanListTasks: (filters?: {
    status?: string;
    assignee?: string;
    tenant?: string;
    includeArchived?: boolean;
    profile?: string;
  }) => ipcRenderer.invoke("kanban-list-tasks", filters),
  kanbanGetTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-get-task", taskId, profile),
  kanbanCreateTask: (
    input: {
      title: string;
      body?: string;
      assignee?: string;
      priority?: number;
      tenant?: string;
      workspace?: string;
      triage?: boolean;
      skills?: string[];
      maxRetries?: number;
    },
    profile?: string,
  ) => ipcRenderer.invoke("kanban-create-task", input, profile),
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("select-folder"),
  readDirectory: (
    dirPath: string,
  ): Promise<{ name: string; isDirectory: boolean }[] | null> =>
    ipcRenderer.invoke("read-directory", dirPath),
  readFile: (
    filePath: string,
    maxBytes?: number,
  ): Promise<{ content: string; truncated: boolean } | null> =>
    ipcRenderer.invoke("read-file", filePath, maxBytes),
  openFileInEditor: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke("open-file-in-editor", filePath),
  readImageFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("read-image-file", filePath),
  kanbanAssignTask: (
    taskId: string,
    assignee: string | null,
    profile?: string,
  ) => ipcRenderer.invoke("kanban-assign-task", taskId, assignee, profile),
  kanbanCompleteTask: (taskId: string, result?: string, profile?: string) =>
    ipcRenderer.invoke("kanban-complete-task", taskId, result, profile),
  kanbanBlockTask: (taskId: string, reason?: string, profile?: string) =>
    ipcRenderer.invoke("kanban-block-task", taskId, reason, profile),
  kanbanUnblockTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-unblock-task", taskId, profile),
  kanbanArchiveTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-archive-task", taskId, profile),
  kanbanSpecifyTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-specify-task", taskId, profile),
  kanbanReclaimTask: (taskId: string, reason?: string, profile?: string) =>
    ipcRenderer.invoke("kanban-reclaim-task", taskId, reason, profile),
  kanbanCommentTask: (taskId: string, body: string, profile?: string) =>
    ipcRenderer.invoke("kanban-comment-task", taskId, body, profile),
  kanbanDispatchOnce: (dryRun?: boolean, profile?: string) =>
    ipcRenderer.invoke("kanban-dispatch-once", dryRun, profile),
  kanbanListClaw3dHqTasks: () =>
    ipcRenderer.invoke("kanban-list-claw3d-hq-tasks"),

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

  // SPS Agent workspace
  spsUnfurl: (
    url: string,
  ): Promise<{
    url: string;
    title: string;
    desc: string;
    favicon?: string;
    image?: string;
  }> => ipcRenderer.invoke("sps-unfurl", url),
  spsAssistant: (
    prompt: string,
    ctx: { blocks: { type: string; text: string }[]; pageTitle: string },
    profile?: string,
  ): Promise<unknown> =>
    ipcRenderer.invoke("sps-assistant", prompt, ctx, profile),
  spsLoad: (profile?: string): Promise<unknown | null> =>
    ipcRenderer.invoke("sps-load", profile),
  spsSave: (ws: unknown, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-save", ws, profile),
  spsExportPage: (
    pageId: string,
    markdown: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-export-page", pageId, markdown, profile),
  spsExportRow: (
    dbFolder: string,
    rowId: string,
    markdown: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-export-row", dbFolder, rowId, markdown, profile),
  spsDeleteRow: (
    dbFolder: string,
    rowId: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-delete-row", dbFolder, rowId, profile),
  spsDeletePage: (pageId: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-delete-page", pageId, profile),
  spsDeleteDbFolder: (dbFolder: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-delete-db-folder", dbFolder, profile),
  spsVaultRead: (
    profile?: string,
  ): Promise<{ pages: Record<string, string>; manifest: string | null }> =>
    ipcRenderer.invoke("sps-vault-read", profile),
  spsVaultWriteManifest: (json: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-vault-write-manifest", json, profile),
  spsBackupWorkspace: (profile?: string): Promise<string | null> =>
    ipcRenderer.invoke("sps-backup-workspace", profile),
  spsWriteExcalidraw: (
    pageId: string,
    assetId: string,
    sceneJson: string,
    svg: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "sps-write-excalidraw",
      pageId,
      assetId,
      sceneJson,
      svg,
      profile,
    ),
  spsReadExcalidraw: (
    pageId: string,
    assetId: string,
    profile?: string,
  ): Promise<{ scene: string | null; svg: string | null }> =>
    ipcRenderer.invoke("sps-read-excalidraw", pageId, assetId, profile),
  spsIndexQuery: (
    query: {
      scope?: string;
      filters?: Array<{
        prop: string;
        op: "eq" | "neq" | "contains" | "exists";
        value?: unknown;
      }>;
      sort?: { prop: string; dir: "asc" | "desc" };
      limit?: number;
    },
    profile?: string,
  ): Promise<
    Array<{
      path: string;
      title: string;
      props: Record<string, unknown>;
      mtime: number;
    }>
  > => ipcRenderer.invoke("sps-index-query", query, profile),
  spsIndexSearch: (
    text: string,
    limit?: number,
    profile?: string,
  ): Promise<Array<{ path: string; title: string; snippet: string }>> =>
    ipcRenderer.invoke("sps-index-search", text, limit, profile),
  spsIndexBacklinks: (path: string, profile?: string): Promise<string[]> =>
    ipcRenderer.invoke("sps-index-backlinks", path, profile),
  spsIndexLinks: (
    profile?: string,
  ): Promise<Array<{ source: string; target: string }>> =>
    ipcRenderer.invoke("sps-index-links", profile),
  spsIndexStatus: (
    profile?: string,
  ): Promise<{
    root: string;
    notes: number;
    links: number;
    indexedAt: number | null;
  }> => ipcRenderer.invoke("sps-index-status", profile),
  spsIndexRebuild: (
    profile?: string,
  ): Promise<{
    root: string;
    notes: number;
    links: number;
    indexedAt: number | null;
  }> => ipcRenderer.invoke("sps-index-rebuild", profile),
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
