import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppLocale } from "../shared/i18n/types";
import type { Attachment } from "../shared/attachments";
import type { SessionModelOverride } from "../shared/model-override";
import type { DesktopSessionContinuationItem } from "../shared/session-continuation";
import type { DesktopSessionLocalError } from "../shared/session-continuation";
import type {
  ImportWalletInput,
  ProfileWallet,
  ProvisionWalletResult,
  WalletMutationResult,
  WalletPortfolioResult,
  WalletSyncResult,
} from "../shared/wallets";
import type { TokenBalancesResponse } from "../shared/tokens";
import type {
  MessagingPlatformsResponse,
  MessagingPlatformTestResponse,
  MessagingPlatformUpdate,
} from "../shared/messaging-platforms";
import type { ChatToolEvent } from "../shared/chat-stream";
import type {
  DeviceCodeInfo,
  HermesAccount,
  HermesAccountUser,
} from "../shared/account";
import type { AgentSyncResult, AgentSyncStatus } from "../shared/agent-sync";
import type { GpuPreferenceMode, GpuStatus } from "../shared/gpu";

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

interface GatewayStartResult {
  success: boolean;
  running: boolean;
  alreadyRunning?: boolean;
  error?: string;
  logPath?: string;
}

interface DashboardConnection {
  baseUrl: string;
  wsUrl: string;
  token: string;
  mode: "local" | "remote" | "ssh";
  profile?: string;
  pid?: number;
  port?: number;
  logPath?: string;
  alreadyRunning?: boolean;
}

interface DashboardStatus {
  supported: boolean;
  running: boolean;
  connection?: DashboardConnection;
  error?: string;
  logPath?: string;
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

  getGpuStatus: (): Promise<GpuStatus> => ipcRenderer.invoke("get-gpu-status"),

  reenableGpu: (): Promise<boolean> => ipcRenderer.invoke("reenable-gpu"),

  setGpuPreference: (mode: GpuPreferenceMode): Promise<boolean> =>
    ipcRenderer.invoke("set-gpu-preference", mode),

  relaunchApp: (): Promise<void> => ipcRenderer.invoke("relaunch-app"),

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

  // Hermes account sign-in (device authorization grant)
  accountLogin: (
    profile?: string,
  ): Promise<{ success: boolean; user?: HermesAccountUser; error?: string }> =>
    ipcRenderer.invoke("hermes-account-login", profile),
  cancelAccountLogin: (): Promise<boolean> =>
    ipcRenderer.invoke("hermes-account-login-cancel"),
  onAccountLoginCode: (
    callback: (info: DeviceCodeInfo) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown): void =>
      callback(info as DeviceCodeInfo);
    ipcRenderer.on("hermes-account-login-code", handler);
    return () =>
      ipcRenderer.removeListener("hermes-account-login-code", handler);
  },
  onAccountLoginProgress: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: unknown): void =>
      callback(String(chunk));
    ipcRenderer.on("hermes-account-login-progress", handler);
    return () =>
      ipcRenderer.removeListener("hermes-account-login-progress", handler);
  },
  getAccount: (profile?: string): Promise<HermesAccount | null> =>
    ipcRenderer.invoke("hermes-account-get", profile),
  accountLogout: (profile?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("hermes-account-logout", profile),

  // Cloud agent sync (profiles ↔ signed-in Hermes One account)
  syncAgents: (): Promise<AgentSyncResult> =>
    ipcRenderer.invoke("agent-sync-run"),
  getAgentSyncStatus: (): Promise<AgentSyncStatus> =>
    ipcRenderer.invoke("agent-sync-status"),
  getLinkedAgentId: (profile: string): Promise<string | null> =>
    ipcRenderer.invoke("agent-sync-linked-id", profile),
  onAgentSyncUpdated: (
    callback: (result: AgentSyncResult) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: unknown,
    ): void => callback(result as AgentSyncResult);
    ipcRenderer.on("agent-sync-updated", handler);
    return () => ipcRenderer.removeListener("agent-sync-updated", handler);
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

  // Auxiliary (side-task) model routing
  getAuxiliaryConfig: (
    profile?: string,
  ): Promise<
    { task: string; provider: string; model: string; baseUrl: string }[]
  > => ipcRenderer.invoke("get-auxiliary-config", profile),

  setAuxiliaryTask: (
    task: string,
    cfg: { provider: string; model: string; baseUrl: string },
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-auxiliary-task", task, cfg, profile),

  resetAuxiliaryConfig: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("reset-auxiliary-config", profile),

  // Connection mode (local / remote / ssh)
  isRemoteMode: (): Promise<boolean> => ipcRenderer.invoke("is-remote-mode"),
  isRemoteOnlyMode: (): Promise<boolean> =>
    ipcRenderer.invoke("is-remote-only-mode"),
  getConnectionConfig: (): Promise<{
    mode: "local" | "remote" | "ssh";
    remoteUrl: string;
    remoteChatTransport: "auto" | "dashboard" | "legacy";
    sshChatTransport: "auto" | "dashboard" | "legacy";
    hasApiKey: boolean;
    apiKeyLength: number;
    ssh: {
      host: string;
      port: number;
      username: string;
      keyPath: string;
      remotePort: number;
      localPort: number;
    };
  }> => ipcRenderer.invoke("get-connection-config"),

  setConnectionConfig: (
    mode: "local" | "remote" | "ssh",
    remoteUrl: string,
    apiKey?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-connection-config", mode, remoteUrl, apiKey),

  setConnectionChatTransports: (
    remoteChatTransport: "auto" | "dashboard" | "legacy",
    sshChatTransport: "auto" | "dashboard" | "legacy",
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "set-connection-chat-transports",
      remoteChatTransport,
      sshChatTransport,
    ),

  onConnectionConfigChanged: (
    callback: (config: {
      mode: "local" | "remote" | "ssh";
      remoteUrl: string;
      remoteChatTransport: "auto" | "dashboard" | "legacy";
      sshChatTransport: "auto" | "dashboard" | "legacy";
      hasApiKey: boolean;
      apiKeyLength: number;
      ssh: {
        host: string;
        port: number;
        username: string;
        keyPath: string;
        remotePort: number;
        localPort: number;
      };
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      config: unknown,
    ): void =>
      callback(
        config as {
          mode: "local" | "remote" | "ssh";
          remoteUrl: string;
          remoteChatTransport: "auto" | "dashboard" | "legacy";
          sshChatTransport: "auto" | "dashboard" | "legacy";
          hasApiKey: boolean;
          apiKeyLength: number;
          ssh: {
            host: string;
            port: number;
            username: string;
            keyPath: string;
            remotePort: number;
            localPort: number;
          };
        },
      );
    ipcRenderer.on("connection-config-changed", handler);
    return () =>
      ipcRenderer.removeListener("connection-config-changed", handler);
  },

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
    runId?: string,
    modelOverride?: SessionModelOverride,
  ): Promise<{ response: string; sessionId?: string }> =>
    ipcRenderer.invoke(
      "send-message",
      message,
      profile,
      resumeSessionId,
      history,
      attachments,
      contextFolder,
      runId,
      modelOverride,
    ),

  abortChat: (runId?: string): Promise<void> =>
    ipcRenderer.invoke("abort-chat", runId),

  transcribeAudio: (
    audio: Uint8Array,
    mimeType: string,
    profile?: string,
  ): Promise<string> =>
    ipcRenderer.invoke("transcribe-audio", audio, mimeType, profile),

  getApiServerKeyStatus: (
    profile?: string,
  ): Promise<{ hasKey: boolean; providerId?: string; checkedAt?: number }> =>
    ipcRenderer.invoke("get-api-server-key-status", profile),

  invalidateSecretsCache: (): Promise<void> =>
    ipcRenderer.invoke("invalidate-secrets-cache"),

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
    status: "ok" | "no-key" | "error" | "unsupported" | "unknown-host";
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

  getModelContextWindow: (
    provider: string,
    model: string,
    baseUrl?: string,
    profile?: string,
  ): Promise<number | null> =>
    ipcRenderer.invoke(
      "get-model-context-window",
      provider,
      model,
      baseUrl,
      profile,
    ),

  onChatChunk: (
    callback: (runId: string, chunk: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      chunk: string,
    ): void => callback(runId, chunk);
    ipcRenderer.on("chat-chunk", handler);
    return () => ipcRenderer.removeListener("chat-chunk", handler);
  },

  /** Streaming reasoning / thinking tokens — separate from `onChatChunk`
   *  so the renderer can render a "thinking" bubble that grows
   *  independently of the assistant's content (#352). */
  onChatReasoningChunk: (
    callback: (runId: string, chunk: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      chunk: string,
    ): void => callback(runId, chunk);
    ipcRenderer.on("chat-reasoning-chunk", handler);
    return () => ipcRenderer.removeListener("chat-reasoning-chunk", handler);
  },

  onChatDone: (
    callback: (runId: string, sessionId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      sessionId?: string,
    ): void => callback(runId, sessionId);
    ipcRenderer.on("chat-done", handler);
    return () => ipcRenderer.removeListener("chat-done", handler);
  },

  onChatSessionStarted: (
    callback: (runId: string, sessionId: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      sessionId: string,
    ): void => callback(runId, sessionId);
    ipcRenderer.on("chat-session-started", handler);
    return () => ipcRenderer.removeListener("chat-session-started", handler);
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

  onChatToolProgress: (
    callback: (runId: string, tool: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      tool: string,
    ): void => callback(runId, tool);
    ipcRenderer.on("chat-tool-progress", handler);
    return () => ipcRenderer.removeListener("chat-tool-progress", handler);
  },

  onChatToolEvent: (
    callback: (runId: string, event: ChatToolEvent) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      toolEvent: ChatToolEvent,
    ): void => callback(runId, toolEvent);
    ipcRenderer.on("chat-tool-event", handler);
    return () => ipcRenderer.removeListener("chat-tool-event", handler);
  },

  onChatUsage: (
    callback: (
      runId: string,
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost?: number;
        rateLimitRemaining?: number;
        rateLimitReset?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      },
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      usage: unknown,
    ): void => callback(runId, usage as Parameters<typeof callback>[1]);
    ipcRenderer.on("chat-usage", handler);
    return () => ipcRenderer.removeListener("chat-usage", handler);
  },

  onChatError: (
    callback: (runId: string, error: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      error: string,
    ): void => callback(runId, error);
    ipcRenderer.on("chat-error", handler);
    return () => ipcRenderer.removeListener("chat-error", handler);
  },

  /** The agent asked a clarifying question mid-turn. The renderer shows an
   *  inline card and answers via `respondClarify`. */
  onClarifyRequest: (
    callback: (
      runId: string,
      req: {
        requestId: string;
        question: string;
        choices: string[];
      },
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      runId: string,
      req: { requestId: string; question: string; choices: string[] },
    ): void => callback(runId, req);
    ipcRenderer.on("chat-clarify-request", handler);
    return () => ipcRenderer.removeListener("chat-clarify-request", handler);
  },

  /** Answer an inline clarify card. An empty/skip answer lets the agent proceed
   *  autonomously (the gateway treats it as "you decide"). */
  respondClarify: (requestId: string, answer: string): Promise<boolean> =>
    ipcRenderer.invoke("clarify-respond", { requestId, answer }),

  // Gateway
  startGateway: (): Promise<GatewayStartResult> =>
    ipcRenderer.invoke("start-gateway"),
  stopGateway: (): Promise<boolean> => ipcRenderer.invoke("stop-gateway"),
  restartGateway: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("restart-gateway", profile),
  gatewayStatus: (): Promise<boolean> => ipcRenderer.invoke("gateway-status"),
  dashboardStatus: (profile?: string): Promise<DashboardStatus> =>
    ipcRenderer.invoke("dashboard-status", profile),
  startDashboard: (profile?: string): Promise<DashboardStatus> =>
    ipcRenderer.invoke("start-dashboard", profile),
  stopDashboard: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("stop-dashboard", profile),

  // Platform toggles
  getPlatformEnabled: (profile?: string): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke("get-platform-enabled", profile),
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-platform-enabled", platform, enabled, profile),
  getMessagingPlatforms: (
    profile?: string,
  ): Promise<MessagingPlatformsResponse> =>
    ipcRenderer.invoke("get-messaging-platforms", profile),
  updateMessagingPlatform: (
    platform: string,
    update: MessagingPlatformUpdate,
    profile?: string,
  ): Promise<{ ok: boolean; platform: string }> =>
    ipcRenderer.invoke("update-messaging-platform", platform, update, profile),
  testMessagingPlatform: (
    platform: string,
    profile?: string,
  ): Promise<MessagingPlatformTestResponse> =>
    ipcRenderer.invoke("test-messaging-platform", platform, profile),

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

  recordSessionContinuation: (
    sessionId: string,
    items: DesktopSessionContinuationItem[],
  ): Promise<boolean> =>
    ipcRenderer.invoke("record-session-continuation", sessionId, items),

  recordSessionLocalError: (
    sessionId: string,
    error: DesktopSessionLocalError,
  ): Promise<boolean> =>
    ipcRenderer.invoke("record-session-local-error", sessionId, error),

  getSessionContextFolder: (sessionId: string): Promise<string | null> =>
    ipcRenderer.invoke("get-session-context-folder", sessionId),

  setSessionContextFolder: (
    sessionId: string,
    folder: string | null,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-session-context-folder", sessionId, folder),

  listRecentSessionContextFolders: (limit?: number): Promise<string[]> =>
    ipcRenderer.invoke("list-recent-session-context-folders", limit),

  getSessionModelOverride: (
    sessionId: string,
  ): Promise<SessionModelOverride | null> =>
    ipcRenderer.invoke("get-session-model-override", sessionId),

  setSessionModelOverride: (
    sessionId: string,
    override: SessionModelOverride | null,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-session-model-override", sessionId, override),

  // Profiles
  listProfiles: (): Promise<
    Array<{
      id: string;
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
      color?: string;
      avatar?: string | null;
    }>
  > => ipcRenderer.invoke("list-profiles"),

  createProfile: (
    name: string,
    cloneFrom: string | null,
  ): Promise<{ success: boolean; error?: string; id?: string }> =>
    ipcRenderer.invoke("create-profile", name, cloneFrom),

  deleteProfile: (
    name: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("delete-profile", name),

  setActiveProfile: (name: string): Promise<boolean> =>
    ipcRenderer.invoke("set-active-profile", name),

  setProfileColor: (
    name: string,
    color: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-profile-color", name, color),

  setProfileName: (
    id: string,
    name: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-profile-name", id, name),

  setProfileAvatar: (
    name: string,
    dataUrl: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-profile-avatar", name, dataUrl),

  removeProfileAvatar: (
    name: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("remove-profile-avatar", name),

  listWallets: (profile?: string): Promise<ProfileWallet[]> =>
    ipcRenderer.invoke("list-wallets", profile),

  // Cloud wallets from the backend for the profile's linked agent.
  syncWallets: (profile?: string): Promise<WalletSyncResult> =>
    ipcRenderer.invoke("wallet-sync", profile),

  // Backend-driven wallet ops (Office space representatives): token balances
  // for a cloud wallet, and provisioning a cloud wallet for the linked agent.
  getWalletPortfolio: (
    profile: string | undefined,
    walletId: string,
  ): Promise<WalletPortfolioResult> =>
    ipcRenderer.invoke("wallet-portfolio", profile, walletId),

  provisionCloudWallet: (profile?: string): Promise<ProvisionWalletResult> =>
    ipcRenderer.invoke("wallet-provision", profile),

  createWallet: (
    profile?: string,
    name?: string,
  ): Promise<WalletMutationResult> =>
    ipcRenderer.invoke("create-wallet", profile, name),

  importWallet: (input: ImportWalletInput): Promise<WalletMutationResult> =>
    ipcRenderer.invoke("import-wallet", input),

  renameWallet: (
    profile: string | undefined,
    id: string,
    name: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("rename-wallet", profile, id, name),

  deleteWallet: (
    profile: string | undefined,
    id: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("delete-wallet", profile, id),

  getTokenBalances: (address: string): Promise<TokenBalancesResponse> =>
    ipcRenderer.invoke("get-token-balances", address),

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
      contextFolder: string | null;
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
      contextFolder: string | null;
    }>
  > => ipcRenderer.invoke("sync-session-cache"),

  updateSessionTitle: (sessionId: string, title: string): Promise<void> =>
    ipcRenderer.invoke("update-session-title", sessionId, title),
  deleteSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("delete-session", sessionId),
  deleteSessions: (
    sessionIds: string[],
  ): Promise<{ requested: number; deleted: number }> =>
    ipcRenderer.invoke("delete-sessions", sessionIds),

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
      providerLabel?: string;
      contextLength?: number;
      capabilities?: string[];
      modalities?: { input?: string[]; output?: string[] };
      createdAt: number;
    }>
  > => ipcRenderer.invoke("list-models"),

  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
    contextLength?: number,
    providerLabel?: string,
  ): Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    contextLength?: number;
    providerLabel?: string;
    createdAt: number;
  }> =>
    ipcRenderer.invoke(
      "add-model",
      name,
      provider,
      model,
      baseUrl,
      contextLength,
      providerLabel,
    ),

  removeModel: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("remove-model", id),

  updateModel: (
    id: string,
    fields: Record<string, string>,
    contextLength?: number | null,
  ): Promise<boolean> =>
    ipcRenderer.invoke("update-model", id, fields, contextLength),

  // Shared model definitions (per-model-id metadata, local-only).
  listModelDefinitions: (): Promise<
    Array<{
      model: string;
      name?: string;
      contextLength?: number;
      capabilities?: string[];
      modalities?: { input?: string[]; output?: string[] };
      createdAt: number;
      updatedAt: number;
    }>
  > => ipcRenderer.invoke("list-model-definitions"),

  getModelDefinition: (
    model: string,
  ): Promise<{
    model: string;
    name?: string;
    contextLength?: number;
    capabilities?: string[];
    modalities?: { input?: string[]; output?: string[] };
    createdAt: number;
    updatedAt: number;
  } | null> => ipcRenderer.invoke("get-model-definition", model),

  setModelDefinition: (
    model: string,
    patch: {
      name?: string;
      contextLength?: number | null;
      capabilities?: string[];
      modalities?: { input?: string[]; output?: string[] };
    },
  ): Promise<{
    model: string;
    name?: string;
    contextLength?: number;
    capabilities?: string[];
    modalities?: { input?: string[]; output?: string[] };
    createdAt: number;
    updatedAt: number;
  } | null> => ipcRenderer.invoke("set-model-definition", model, patch),

  removeModelDefinition: (model: string): Promise<boolean> =>
    ipcRenderer.invoke("remove-model-definition", model),

  onModelLibraryChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("model-library-changed", handler);
    return () => ipcRenderer.removeListener("model-library-changed", handler);
  },

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
  getAutoUpgradeEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke("get-auto-upgrade-enabled"),
  setAutoUpgradeEnabled: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("set-auto-upgrade-enabled", enabled),

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
  openTerminal: (dirPath: string): Promise<boolean> =>
    ipcRenderer.invoke("open-terminal", dirPath),
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
  kanbanPromoteTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-promote-task", taskId, profile),
  kanbanScheduleTask: (taskId: string, reason?: string, profile?: string) =>
    ipcRenderer.invoke("kanban-schedule-task", taskId, reason, profile),
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
    Array<{
      name: string;
      type: "http" | "stdio" | "unknown";
      transport: "http" | "stdio" | "unknown";
      enabled: boolean;
      detail: string;
      url?: string;
      command?: string;
      args: string[];
      env: Record<string, string>;
      auth?: string;
      tools?: unknown;
    }>
  > => ipcRenderer.invoke("list-mcp-servers", profile),
  addMcpServer: (
    input: {
      name: string;
      type: "http" | "stdio";
      url?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      auth?: string;
    },
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("add-mcp-server", input, profile),
  removeMcpServer: (
    name: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("remove-mcp-server", name, profile),
  setMcpServerEnabled: (
    name: string,
    enabled: boolean,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-mcp-server-enabled", name, enabled, profile),
  testMcpServer: (
    name: string,
    profile?: string,
  ): Promise<{
    success: boolean;
    error?: string;
    tools?: Array<{ name: string; description: string }>;
  }> => ipcRenderer.invoke("test-mcp-server", name, profile),
  listMcpCatalog: (
    profile?: string,
  ): Promise<{
    entries: Array<{
      name: string;
      description: string;
      source: string;
      transport: "http" | "stdio" | "unknown";
      authType: string;
      requiredEnv: Array<{ name: string; prompt: string; required: boolean }>;
      needsInstall: boolean;
      installed: boolean;
      enabled: boolean;
    }>;
    diagnostics: unknown[];
    error?: string;
  }> => ipcRenderer.invoke("list-mcp-catalog", profile),
  installMcpCatalogEntry: (
    name: string,
    env?: Record<string, string>,
    profile?: string,
  ): Promise<{
    success: boolean;
    error?: string;
    background?: boolean;
    action?: string;
  }> => ipcRenderer.invoke("install-mcp-catalog-entry", name, env, profile),

  // Discover marketplace (community registry)
  fetchRegistry: (force?: boolean) =>
    ipcRenderer.invoke("registry-fetch", force),
  fetchModelRegistry: (force?: boolean) =>
    ipcRenderer.invoke("registry-fetch-models", force),
  listInstalledRegistry: (profile?: string) =>
    ipcRenderer.invoke("registry-list-installed", profile),
  fetchRegistryDetail: (kind: string, item: unknown) =>
    ipcRenderer.invoke("registry-detail", kind, item),
  installRegistryItem: (
    kind: string,
    item: unknown,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("registry-install", kind, item, profile),

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
