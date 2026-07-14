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
  DeviceCodeInfo,
  HermesAccount,
  HermesAccountUser,
} from "../shared/account";
import type { AgentSyncResult, AgentSyncStatus } from "../shared/agent-sync";
import type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
  RegistryDetail,
  ModelRegistry,
} from "../shared/registry";
import type {
  MessagingPlatformsResponse,
  MessagingPlatformTestResponse,
  MessagingPlatformUpdate,
} from "../shared/messaging-platforms";
import type { ChatToolEvent } from "../shared/chat-stream";
import type { GpuPreferenceMode, GpuStatus } from "../shared/gpu";

interface ElectronAPI {
  process: {
    platform: NodeJS.Platform;
    versions: {
      chrome: string;
      electron: string;
      node: string;
    };
  };
}

interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
  activeProfile?: string;
}

interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

interface ConfigHealthIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
  locations: string[];
  autoFixable: boolean;
  fixDescription?: string;
  fixLocation?: "providers" | "models" | ".env" | "config.yaml" | "setup";
  context?: Record<string, string>;
}

interface ConfigHealthReport {
  ranAt: number;
  profile: string;
  issues: ConfigHealthIssue[];
  summary: { errors: number; warnings: number; infos: number };
}

interface ConfigFixLogEntry {
  ts: number;
  issueCode: string;
  action: "migrate" | "autofix" | "manual-fix";
  from?: string;
  to?: string;
  profile?: string;
  valueMasked?: string;
  detail?: string;
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

/**
 * Shape of a credential-pool entry as the upstream engine expects
 * (issue #367). Old entries written by the renderer with just
 * `{key, label}` are still readable via the optional `key` field.
 * New entries written from the UI use the canonical shape.
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
  /** Legacy field for backward compat with old auth.json shapes. */
  key?: string;
}

interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  tenant: string | null;
  workspace_kind: string;
  workspace_path: string | null;
  created_by: string | null;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  skills: string[];
  max_retries: number | null;
}

interface KanbanBoard {
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  is_current: boolean;
  archived?: boolean;
  total: number;
  counts: Record<string, number>;
  db_path?: string;
}

interface KanbanComment {
  id: number;
  task_id: string;
  author: string | null;
  body: string;
  created_at: number;
}

interface KanbanEvent {
  id: number;
  task_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: number;
  run_id: number | null;
}

interface KanbanRun {
  id: number;
  task_id: string;
  profile: string | null;
  status: string | null;
  outcome: string | null;
  summary: string | null;
  error: string | null;
  started_at: number | null;
  ended_at: number | null;
  last_heartbeat_at: number | null;
}

interface KanbanTaskDetail {
  task: KanbanTask;
  comments: KanbanComment[];
  events: KanbanEvent[];
  parents: string[];
  children: string[];
  runs: KanbanRun[];
  latest_summary: string | null;
}

interface KanbanCreateTaskInput {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  tenant?: string;
  workspace?: string;
  triage?: boolean;
  skills?: string[];
  maxRetries?: number;
}

interface HermesAPI {
  // Installation
  checkInstall: () => Promise<InstallStatus>;
  verifyInstall: () => Promise<boolean>;
  startInstall: () => Promise<{ success: boolean; error?: string }>;
  inspectInstallTarget: () => Promise<{
    hermesHome: string;
    repoPath: string;
    state: "fresh" | "update" | "replace";
  }>;
  validateHermesHome: (dir: string) => Promise<boolean>;
  adoptHermesHome: (dir: string) => Promise<boolean>;
  quitApp: () => Promise<void>;
  getGpuStatus: () => Promise<GpuStatus>;
  reenableGpu: () => Promise<boolean>;
  setGpuPreference: (mode: GpuPreferenceMode) => Promise<boolean>;
  relaunchApp: () => Promise<void>;
  onInstallProgress: (
    callback: (progress: InstallProgress) => void,
  ) => () => void;

  // Hermes engine info
  getHermesVersion: () => Promise<string | null>;
  refreshHermesVersion: () => Promise<string | null>;
  runHermesDoctor: () => Promise<string>;
  runHermesUpdate: () => Promise<{ success: boolean; error?: string }>;

  // OpenClaw migration
  checkOpenClaw: () => Promise<{ found: boolean; path: string | null }>;
  runClawMigrate: () => Promise<{ success: boolean; error?: string }>;

  // OAuth provider sign-in
  oauthLogin: (
    provider: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  cancelOAuthLogin: () => Promise<boolean>;
  onOAuthLoginProgress: (callback: (chunk: string) => void) => () => void;

  // Hermes account sign-in (device authorization grant)
  accountLogin: (
    profile?: string,
  ) => Promise<{ success: boolean; user?: HermesAccountUser; error?: string }>;
  cancelAccountLogin: () => Promise<boolean>;
  onAccountLoginCode: (callback: (info: DeviceCodeInfo) => void) => () => void;
  onAccountLoginProgress: (callback: (chunk: string) => void) => () => void;
  getAccount: (profile?: string) => Promise<HermesAccount | null>;
  accountLogout: (profile?: string) => Promise<{ success: boolean }>;

  // Cloud agent sync (profiles ↔ signed-in Hermes One account)
  syncAgents: () => Promise<AgentSyncResult>;
  getAgentSyncStatus: () => Promise<AgentSyncStatus>;
  getLinkedAgentId: (profile: string) => Promise<string | null>;
  onAgentSyncUpdated: (
    callback: (result: AgentSyncResult) => void,
  ) => () => void;

  getLocale: () => Promise<AppLocale>;
  setLocale: (locale: AppLocale) => Promise<AppLocale>;

  // Configuration (profile-aware)
  getEnv: (profile?: string) => Promise<Record<string, string>>;
  setEnv: (key: string, value: string, profile?: string) => Promise<boolean>;
  validateChatReadiness: (profile?: string) => Promise<{
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
  }>;

  // Config-health audit (Diagnose section)
  getConfigHealth: (profile?: string) => Promise<ConfigHealthReport>;
  rerunConfigHealth: (profile?: string) => Promise<ConfigHealthReport>;
  autofixConfigIssue: (
    code: string,
    profile?: string,
    context?: Record<string, string>,
  ) => Promise<{ ok: boolean; message?: string }>;
  getConfigFixLog: (maxEntries?: number) => Promise<ConfigFixLogEntry[]>;
  getConfig: (key: string, profile?: string) => Promise<string | null>;
  setConfig: (key: string, value: string, profile?: string) => Promise<boolean>;
  getHermesHome: (profile?: string) => Promise<string>;
  getModelConfig: (
    profile?: string,
  ) => Promise<{ provider: string; model: string; baseUrl: string }>;
  getAuxiliaryConfig: (
    profile?: string,
  ) => Promise<
    { task: string; provider: string; model: string; baseUrl: string }[]
  >;
  setAuxiliaryTask: (
    task: string,
    cfg: { provider: string; model: string; baseUrl: string },
    profile?: string,
  ) => Promise<boolean>;
  resetAuxiliaryConfig: (profile?: string) => Promise<boolean>;
  setModelConfig: (
    provider: string,
    model: string,
    baseUrl: string,
    profile?: string,
  ) => Promise<boolean>;

  // Connection mode (local / remote / ssh)
  isRemoteMode: () => Promise<boolean>;
  isRemoteOnlyMode: () => Promise<boolean>;
  getConnectionConfig: () => Promise<{
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
  }>;
  setConnectionConfig: (
    mode: "local" | "remote" | "ssh",
    remoteUrl: string,
    apiKey?: string,
  ) => Promise<boolean>;
  setConnectionChatTransports: (
    remoteChatTransport: "auto" | "dashboard" | "legacy",
    sshChatTransport: "auto" | "dashboard" | "legacy",
  ) => Promise<boolean>;
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
  ) => () => void;
  setSshConfig: (
    host: string,
    port: number,
    username: string,
    keyPath: string,
    remotePort: number,
    localPort: number,
  ) => Promise<boolean>;
  testRemoteConnection: (url: string, apiKey?: string) => Promise<boolean>;
  testSshConnection: (
    host: string,
    port: number,
    username: string,
    keyPath: string,
    remotePort: number,
  ) => Promise<boolean>;
  isSshTunnelActive: () => Promise<boolean>;
  startSshTunnel: () => Promise<boolean>;
  stopSshTunnel: () => Promise<boolean>;

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
  ) => Promise<{ response: string; sessionId?: string }>;
  abortChat: (runId?: string) => Promise<void>;
  transcribeAudio: (
    audio: Uint8Array,
    mimeType: string,
    profile?: string,
  ) => Promise<string>;
  getApiServerKeyStatus: (
    profile?: string,
  ) => Promise<{ hasKey: boolean; providerId?: string; checkedAt?: number }>;
  invalidateSecretsCache: () => Promise<void>;
  generateApiServerKey: (profile?: string) => Promise<{ key: string }>;
  copyToClipboard: (text: string) => Promise<void>;
  onContextMenuCopyChat: (
    callback: (format: "text" | "markdown") => void,
  ) => () => void;
  onContextMenuSelectBubble: (
    callback: (point: { x: number; y: number }) => void,
  ) => () => void;
  readMediaFile: (filePath: string) => Promise<string | null>;
  saveMediaFile: (src: string, name: string) => Promise<boolean>;
  mediaFileExists: (filePath: string) => Promise<boolean>;
  showMediaMenu: (
    src: string,
    name: string,
    labels: { open: string; saveAs: string },
  ) => void;
  getPathForFile: (file: File) => string;
  stageAttachment: (
    sessionId: string,
    filename: string,
    base64Bytes: string,
  ) => Promise<string>;
  clearStagedAttachments: (sessionId: string) => Promise<void>;
  discoverProviderModels: (
    provider: string,
    baseUrl?: string,
    apiKey?: string,
    profile?: string,
  ) => Promise<{
    models: string[];
    status: "ok" | "no-key" | "error" | "unsupported" | "unknown-host";
    cached: boolean;
    /** Subset of `models` flagged as free (Nous Portal today). #367. */
    freeModels?: string[];
  }>;
  getModelContextWindow: (
    provider: string,
    model: string,
    baseUrl?: string,
    profile?: string,
  ) => Promise<number | null>;
  onChatChunk: (callback: (runId: string, chunk: string) => void) => () => void;
  onChatReasoningChunk: (
    callback: (runId: string, chunk: string) => void,
  ) => () => void;
  onChatDone: (
    callback: (runId: string, sessionId?: string) => void,
  ) => () => void;
  onChatSessionStarted: (
    callback: (runId: string, sessionId: string) => void,
  ) => () => void;
  onChatToolProgress: (
    callback: (runId: string, tool: string) => void,
  ) => () => void;
  onChatToolEvent: (
    callback: (runId: string, event: ChatToolEvent) => void,
  ) => () => void;
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
  ) => () => void;
  onChatError: (callback: (runId: string, error: string) => void) => () => void;
  onClarifyRequest: (
    callback: (
      runId: string,
      req: {
        requestId: string;
        question: string;
        choices: string[];
      },
    ) => void,
  ) => () => void;
  respondClarify: (requestId: string, answer: string) => Promise<boolean>;

  // Gateway
  startGateway: () => Promise<GatewayStartResult>;
  stopGateway: () => Promise<boolean>;
  restartGateway: (profile?: string) => Promise<boolean>;
  gatewayStatus: () => Promise<boolean>;
  dashboardStatus: (profile?: string) => Promise<DashboardStatus>;
  startDashboard: (profile?: string) => Promise<DashboardStatus>;
  stopDashboard: (profile?: string) => Promise<boolean>;

  // Platform toggles
  getPlatformEnabled: (profile?: string) => Promise<Record<string, boolean>>;
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;
  getMessagingPlatforms: (
    profile?: string,
  ) => Promise<MessagingPlatformsResponse>;
  updateMessagingPlatform: (
    platform: string,
    update: MessagingPlatformUpdate,
    profile?: string,
  ) => Promise<{ ok: boolean; platform: string }>;
  testMessagingPlatform: (
    platform: string,
    profile?: string,
  ) => Promise<MessagingPlatformTestResponse>;

  // Sessions
  listSessions: (
    limit?: number,
    offset?: number,
  ) => Promise<
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
  >;
  getSessionMessages: (sessionId: string) => Promise<
    Array<
      | {
          kind: "user";
          id: number;
          content: string;
          timestamp: number;
          attachments?: Attachment[];
        }
      | {
          kind: "assistant";
          id: number;
          content: string;
          timestamp: number;
          error?: string;
          attachments?: Attachment[];
        }
      | {
          kind: "reasoning";
          id: number;
          assistantId: number;
          text: string;
          timestamp: number;
        }
      | {
          kind: "tool_call";
          id: number;
          assistantId: number;
          callId: string;
          name: string;
          args: string;
          timestamp: number;
        }
      | {
          kind: "tool_result";
          id: number;
          callId: string;
          name: string;
          content: string;
          timestamp: number;
          attachments?: Attachment[];
        }
    >
  >;
  recordSessionContinuation: (
    sessionId: string,
    items: DesktopSessionContinuationItem[],
  ) => Promise<boolean>;
  recordSessionLocalError: (
    sessionId: string,
    error: DesktopSessionLocalError,
  ) => Promise<boolean>;
  getSessionContextFolder: (sessionId: string) => Promise<string | null>;
  setSessionContextFolder: (
    sessionId: string,
    folder: string | null,
  ) => Promise<boolean>;
  listRecentSessionContextFolders: (limit?: number) => Promise<string[]>;
  getSessionModelOverride: (
    sessionId: string,
  ) => Promise<SessionModelOverride | null>;
  setSessionModelOverride: (
    sessionId: string,
    override: SessionModelOverride | null,
  ) => Promise<boolean>;

  // Profiles
  listProfiles: () => Promise<
    Array<{
      /** Stable internal profile id used for CLI, paths, and routing. */
      id: string;
      /** User-facing agent/profile name. */
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
      /** Resolved accent colour; absent on SSH/remote profiles. */
      color?: string;
      /** Avatar data URL, or null/absent when none is set. */
      avatar?: string | null;
    }>
  >;
  createProfile: (
    name: string,
    cloneFrom: string | null,
  ) => Promise<{ success: boolean; error?: string; id?: string }>;
  deleteProfile: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setActiveProfile: (name: string) => Promise<boolean>;
  setProfileColor: (
    name: string,
    color: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setProfileName: (
    id: string,
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setProfileAvatar: (
    name: string,
    dataUrl: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeProfileAvatar: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  listWallets: (profile?: string) => Promise<ProfileWallet[]>;
  syncWallets: (profile?: string) => Promise<WalletSyncResult>;
  getWalletPortfolio: (
    profile: string | undefined,
    walletId: string,
  ) => Promise<WalletPortfolioResult>;
  provisionCloudWallet: (profile?: string) => Promise<ProvisionWalletResult>;
  createWallet: (
    profile?: string,
    name?: string,
  ) => Promise<WalletMutationResult>;
  importWallet: (input: ImportWalletInput) => Promise<WalletMutationResult>;
  renameWallet: (
    profile: string | undefined,
    id: string,
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  deleteWallet: (
    profile: string | undefined,
    id: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getTokenBalances: (address: string) => Promise<TokenBalancesResponse>;

  // Memory
  readMemory: (profile?: string) => Promise<{
    memory: { content: string; exists: boolean; lastModified: number | null };
    user: { content: string; exists: boolean; lastModified: number | null };
    stats: { totalSessions: number; totalMessages: number };
  }>;

  addMemoryEntry: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  updateMemoryEntry: (
    index: number,
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeMemoryEntry: (index: number, profile?: string) => Promise<boolean>;
  writeUserProfile: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Soul
  readSoul: (profile?: string) => Promise<string>;
  writeSoul: (content: string, profile?: string) => Promise<boolean>;
  resetSoul: (profile?: string) => Promise<string>;

  // Tools
  getToolsets: (
    profile?: string,
  ) => Promise<
    Array<{ key: string; label: string; description: string; enabled: boolean }>
  >;
  setToolsetEnabled: (
    key: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;

  // Skills
  listInstalledSkills: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; category: string; description: string; path: string }>
  >;
  listBundledSkills: () => Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      installed: boolean;
    }>
  >;
  getSkillContent: (skillPath: string) => Promise<string>;
  installSkill: (
    identifier: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  uninstallSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Session cache
  listCachedSessions: (
    limit?: number,
    offset?: number,
  ) => Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      contextFolder: string | null;
    }>
  >;
  syncSessionCache: () => Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      contextFolder: string | null;
    }>
  >;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteSessions: (
    sessionIds: string[],
  ) => Promise<{ requested: number; deleted: number }>;

  // Session search
  searchSessions: (
    query: string,
    limit?: number,
  ) => Promise<
    Array<{
      sessionId: string;
      title: string | null;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      snippet: string;
    }>
  >;

  // Credential Pool (profile-aware) — entries follow the upstream
  // engine schema (issue #367). See `CredentialPoolEntry` below.
  getCredentialPool: (
    profile?: string,
  ) => Promise<Record<string, Array<CredentialPoolEntry>>>;
  setCredentialPool: (
    provider: string,
    entries: Array<CredentialPoolEntry>,
    profile?: string,
  ) => Promise<boolean>;
  addCredentialPoolEntry: (
    provider: string,
    apiKey: string,
    label: string,
    profile?: string,
  ) => Promise<Array<CredentialPoolEntry>>;
  invalidateSecretsCache: () => Promise<void>;

  // Models
  listModels: () => Promise<
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
  >;
  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
    contextLength?: number,
    providerLabel?: string,
  ) => Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    contextLength?: number;
    providerLabel?: string;
    createdAt: number;
  }>;
  removeModel: (id: string) => Promise<boolean>;
  updateModel: (
    id: string,
    fields: Record<string, string>,
    contextLength?: number | null,
  ) => Promise<boolean>;
  listModelDefinitions: () => Promise<
    Array<{
      model: string;
      name?: string;
      contextLength?: number;
      capabilities?: string[];
      modalities?: { input?: string[]; output?: string[] };
      createdAt: number;
      updatedAt: number;
    }>
  >;
  getModelDefinition: (model: string) => Promise<{
    model: string;
    name?: string;
    contextLength?: number;
    capabilities?: string[];
    modalities?: { input?: string[]; output?: string[] };
    createdAt: number;
    updatedAt: number;
  } | null>;
  setModelDefinition: (
    model: string,
    patch: {
      name?: string;
      contextLength?: number | null;
      capabilities?: string[];
      modalities?: { input?: string[]; output?: string[] };
    },
  ) => Promise<{
    model: string;
    name?: string;
    contextLength?: number;
    capabilities?: string[];
    modalities?: { input?: string[]; output?: string[] };
    createdAt: number;
    updatedAt: number;
  } | null>;
  removeModelDefinition: (model: string) => Promise<boolean>;
  onModelLibraryChanged: (callback: () => void) => () => void;

  // Claw3D
  claw3dStatus: () => Promise<{
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
  }>;
  claw3dSetup: () => Promise<{ success: boolean; error?: string }>;
  onClaw3dSetupProgress: (
    callback: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
    }) => void,
  ) => () => void;
  claw3dGetPort: () => Promise<number>;
  claw3dSetPort: (port: number) => Promise<boolean>;
  claw3dGetWsUrl: () => Promise<string>;
  claw3dSetWsUrl: (url: string) => Promise<boolean>;
  claw3dStartAll: (
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  claw3dStopAll: () => Promise<boolean>;
  claw3dGetLogs: () => Promise<string>;
  claw3dStartDev: () => Promise<boolean>;
  claw3dStopDev: () => Promise<boolean>;
  claw3dStartAdapter: () => Promise<boolean>;
  claw3dStopAdapter: () => Promise<boolean>;

  // Updates
  checkForUpdates: () => Promise<string | null>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  getAutoUpgradeEnabled: () => Promise<boolean>;
  setAutoUpgradeEnabled: (enabled: boolean) => Promise<boolean>;
  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes: string }) => void,
  ) => () => void;
  onUpdateDownloadProgress: (
    callback: (info: { percent: number }) => void,
  ) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  onUpdateError: (callback: (message: string) => void) => () => void;

  // Menu events
  onMenuNewChat: (callback: () => void) => () => void;
  onMenuSearchSessions: (callback: () => void) => () => void;

  // Cron Jobs
  listCronJobs: (
    includeDisabled?: boolean,
    profile?: string,
  ) => Promise<
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
  >;
  createCronJob: (
    schedule: string,
    prompt?: string,
    name?: string,
    deliver?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  pauseCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  resumeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  triggerCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Kanban
  kanbanListBoards: (
    includeArchived?: boolean,
    profile?: string,
  ) => Promise<{
    success: boolean;
    data?: KanbanBoard[];
    error?: string;
    unsupportedMode?: boolean;
  }>;
  kanbanCurrentBoard: (
    profile?: string,
  ) => Promise<{ success: boolean; data?: string; error?: string }>;
  kanbanSwitchBoard: (
    slug: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanCreateBoard: (
    slug: string,
    name?: string,
    switchAfter?: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanRemoveBoard: (
    slug: string,
    hardDelete?: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanListTasks: (filters?: {
    status?: string;
    assignee?: string;
    tenant?: string;
    includeArchived?: boolean;
    profile?: string;
  }) => Promise<{ success: boolean; data?: KanbanTask[]; error?: string }>;
  kanbanGetTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{ success: boolean; data?: KanbanTaskDetail; error?: string }>;
  kanbanCreateTask: (
    input: KanbanCreateTaskInput,
    profile?: string,
  ) => Promise<{ success: boolean; data?: { id: string }; error?: string }>;
  selectFolder: () => Promise<string | null>;
  readDirectory: (
    dirPath: string,
  ) => Promise<{ name: string; isDirectory: boolean }[] | null>;
  readFile: (
    filePath: string,
    maxBytes?: number,
  ) => Promise<{ content: string; truncated: boolean } | null>;
  openFileInEditor: (filePath: string) => Promise<boolean>;
  openTerminal: (dirPath: string) => Promise<boolean>;
  readImageFile: (filePath: string) => Promise<string | null>;
  kanbanAssignTask: (
    taskId: string,
    assignee: string | null,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanCompleteTask: (
    taskId: string,
    result?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanBlockTask: (
    taskId: string,
    reason?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanUnblockTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanArchiveTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanPromoteTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanScheduleTask: (
    taskId: string,
    reason?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanSpecifyTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanReclaimTask: (
    taskId: string,
    reason?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanCommentTask: (
    taskId: string,
    body: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  kanbanDispatchOnce: (
    dryRun?: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  kanbanListClaw3dHqTasks: () => Promise<{
    success: boolean;
    data?: KanbanTask[];
    error?: string;
  }>;

  // Shell
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
  listMcpServers: (profile?: string) => Promise<
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
  >;
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
  ) => Promise<{ success: boolean; error?: string }>;
  removeMcpServer: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setMcpServerEnabled: (
    name: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  testMcpServer: (
    name: string,
    profile?: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    tools?: Array<{ name: string; description: string }>;
  }>;
  listMcpCatalog: (profile?: string) => Promise<{
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
  }>;
  installMcpCatalogEntry: (
    name: string,
    env?: Record<string, string>,
    profile?: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    background?: boolean;
    action?: string;
  }>;

  // Discover marketplace (community registry)
  fetchRegistry: (
    force?: boolean,
  ) => Promise<RegistryCatalog & { error?: string }>;
  fetchModelRegistry: (force?: boolean) => Promise<ModelRegistry>;
  listInstalledRegistry: (
    profile?: string,
  ) => Promise<{ skills: string[]; mcps: string[]; workflows: string[] }>;
  fetchRegistryDetail: (
    kind: RegistryKind,
    item: RegistryItem,
  ) => Promise<RegistryDetail>;
  installRegistryItem: (
    kind: RegistryKind,
    item: RegistryItem,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Log viewer
  readLogs: (
    logFile?: string,
    lines?: number,
  ) => Promise<{ content: string; path: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    hermesAPI: HermesAPI;
  }
}
