import type { AppLocale } from "../shared/i18n/types";
import type { Attachment } from "../shared/attachments";
import type { UsageAggregate, RunLedgerEntry } from "../shared/usage";
import type { MemoryTimeline } from "../shared/memoryTimeline";
import type { MemoryInfo } from "../shared/memory";
import type { SearchSummary } from "../shared/searchSummary";
import type { LoadedSkin } from "../shared/skins";
import type {
  SearchOpts as ResearchSearchOpts,
  WorkSummary as ResearchWorkSummary,
  WorkDetail as ResearchWorkDetail,
} from "../shared/openalex/core";
import type { InstallStatus, InstallProgress } from "../shared/install";
import type {
  KanbanTask,
  KanbanBoard,
  KanbanTaskDetail,
  KanbanCreateTaskInput,
} from "../shared/kanban";
import type { ConfigHealthReport } from "../shared/config-health";
import type { EquityBasket, EquityAlert } from "../shared/equity";
import type { PublicConnectionConfig } from "../shared/connection";
import type { ChatReadiness } from "../shared/validation";
import type { SkillEntry } from "../shared/skills";
import type {
  ExternalSource,
  ExternalSourceConfig,
  ExternalIndexStatus,
  ExternalSearchHit,
  ExternalConversationMeta,
  ExternalMessage,
  ExternalScanProgress,
} from "../shared/external-context";
import type { ProfileInfo } from "../shared/profiles";
import type { CronJob } from "../shared/cronjobs";
import type { SessionSummary } from "../shared/sessions";
import type {
  ScheduledResearchItem,
  ScheduleInput,
} from "../shared/scheduledResearch";
import type { SrPendingUpdate, SrPatch } from "./bridges/sps";
import type { CredentialPoolEntry } from "../shared/credentials";

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

interface ObsidianFileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: ObsidianFileNode[];
}

interface ObsidianConfig {
  enabled: boolean;
  vaultPath: string;
  vaultName: string;
  vaultId: string;
  bridgeUrl: string;
  hasBridgeToken: boolean;
}

interface ObsidianConfigInput {
  vaultPath: string;
  vaultName?: string;
  vaultId?: string;
  bridgeUrl?: string;
  bridgeToken?: string;
}

type ObsidianFunctionName =
  | "status"
  | "active-note"
  | "open-note"
  | "insert-at-cursor"
  | "replace-selection"
  | "run-command"
  | "write-note";

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
  onInstallProgress: (
    callback: (progress: InstallProgress) => void,
  ) => () => void;

  // Hermes engine info
  getHermesVersion: () => Promise<string | null>;
  refreshHermesVersion: () => Promise<string | null>;
  runHermesDoctor: () => Promise<string>;
  runHermesUpdate: () => Promise<{ success: boolean; error?: string }>;
  checkHermesUpdate: () => Promise<{
    available: boolean;
    behindBy?: number;
    localHead?: string;
    upstreamHead?: string;
    reason?: string;
  }>;
  getVoiceStatus: (profile?: string) => Promise<{ hasKey: boolean }>;
  transcribeAudio: (
    audio: ArrayBuffer,
    mime: string,
    profile?: string,
  ) => Promise<{ text?: string; error?: string }>;
  speakText: (
    text: string,
    voice?: string,
    profile?: string,
  ) => Promise<{ audioUrl?: string; error?: string }>;
  onGlobalVoiceTrigger: (callback: () => void) => () => void;

  // OAuth provider sign-in
  oauthLogin: (
    provider: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  cancelOAuthLogin: () => Promise<boolean>;
  onOAuthLoginProgress: (callback: (chunk: string) => void) => () => void;

  getLocale: () => Promise<AppLocale>;
  setLocale: (locale: AppLocale) => Promise<AppLocale>;

  // Configuration (profile-aware)
  getEnv: (profile?: string) => Promise<Record<string, string>>;
  setEnv: (key: string, value: string, profile?: string) => Promise<boolean>;
  setProviderKey: (
    provider: string,
    key: string,
    profile?: string,
  ) => Promise<boolean>;
  validateChatReadiness: (profile?: string) => Promise<ChatReadiness>;

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
  setModelConfig: (
    provider: string,
    model: string,
    baseUrl: string,
    profile?: string,
  ) => Promise<boolean>;

  // Connection mode (local / remote / ssh)
  isRemoteMode: () => Promise<boolean>;
  isRemoteOnlyMode: () => Promise<boolean>;
  getUsageStats: (profile?: string) => Promise<UsageAggregate>;
  getRunLedger: (profile?: string) => Promise<RunLedgerEntry[]>;
  summarizeSearch: (query: string, profile?: string) => Promise<SearchSummary>;
  listSkins: (profile?: string) => Promise<LoadedSkin[]>;
  getAutoApprove: (profile?: string) => Promise<boolean>;
  setAutoApprove: (enabled: boolean, profile?: string) => Promise<void>;
  getCompletionSound: () => Promise<boolean>;
  setCompletionSound: (enabled: boolean) => Promise<void>;
  getOnboardingCompleted: () => Promise<boolean>;
  setOnboardingCompleted: (completed: boolean) => Promise<void>;
  respondApproval: (
    runId: string,
    choice: "once" | "session" | "always" | "deny",
    profile?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  getConnectionConfig: () => Promise<PublicConnectionConfig>;
  setConnectionConfig: (
    mode: "local" | "remote" | "ssh",
    remoteUrl: string,
    apiKey?: string,
  ) => Promise<boolean>;
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
    groundInWorkspace?: boolean,
    clientRunId?: string,
    modelOverride?: { model?: string; provider?: string; baseUrl?: string },
  ) => Promise<{ response: string; sessionId?: string }>;
  adoptCouncilResponse: (
    messageId: number,
    sessionId: string,
    councilGroupId: string,
  ) => Promise<void>;
  abortChat: () => Promise<void>;
  getApiServerKeyStatus: (profile?: string) => Promise<{ hasKey: boolean }>;
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
    status: "ok" | "no-key" | "unsupported" | "unknown-host";
    cached: boolean;
    /** Subset of `models` flagged as free (Nous Portal today). #367. */
    freeModels?: string[];
  }>;
  onChatChunk: (
    callback: (chunk: string, runId?: string) => void,
  ) => () => void;
  onChatReasoningChunk: (
    callback: (chunk: string, runId?: string) => void,
  ) => () => void;
  onChatDone: (
    callback: (sessionId?: string, runId?: string) => void,
  ) => () => void;
  onChatToolProgress: (
    callback: (tool: string, runId?: string) => void,
  ) => () => void;
  onChatUsage: (
    callback: (
      usage: {
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
      },
      runId?: string,
    ) => void,
  ) => () => void;
  onChatError: (
    callback: (error: string, runId?: string) => void,
  ) => () => void;
  onChatApprovalRequest: (
    callback: (req: {
      id: string;
      command?: string;
      toolName?: string;
      patternKey?: string;
      description?: string;
      sessionKey?: string;
    }) => void,
  ) => () => void;
  onChatApprovalAuto: (
    callback: (
      req: {
        id: string;
        command?: string;
        toolName?: string;
        patternKey?: string;
        description?: string;
        sessionKey?: string;
      },
      runId?: string,
    ) => void,
  ) => () => void;
  onChatCheckpoint: (
    callback: (cp: {
      id: string;
      label?: string;
      turn?: number;
      createdAt?: string;
      sessionKey?: string;
    }) => void,
  ) => () => void;
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
  ) => () => void;

  // Gateway
  startGateway: () => Promise<boolean>;
  stopGateway: () => Promise<boolean>;
  gatewayStatus: () => Promise<boolean>;
  gatewayHealthStatus: () => Promise<
    import("../shared/gateway").GatewayHealthStatus
  >;
  onGatewayHealthChanged: (
    callback: (change: import("../shared/gateway").GatewayHealthChange) => void,
  ) => () => void;

  // Platform toggles
  getPlatformEnabled: (profile?: string) => Promise<Record<string, boolean>>;
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;
  telegramGetScope: (
    profile?: string,
  ) => Promise<"read-info" | "broad" | "custom">;
  telegramSetReadInfoScope: (profile?: string) => Promise<boolean>;

  // Sessions
  listSessions: (limit?: number, offset?: number) => Promise<SessionSummary[]>;
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
          attachments?: Attachment[];
          model?: string;
          provider?: string;
          councilGroupId?: string;
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

  // Profiles
  listProfiles: () => Promise<ProfileInfo[]>;
  createProfile: (
    name: string,
    clone: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  deleteProfile: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setActiveProfile: (name: string) => Promise<boolean>;

  // Memory
  readMemory: (profile?: string) => Promise<MemoryInfo>;
  getMemoryTimeline: (profile?: string) => Promise<MemoryTimeline>;

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
  writeMemory: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Personalization (focus.md + daily-context hook)
  readFocus: () => Promise<string>;
  writeFocus: (
    content: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getDailyContextHookStatus: (profile?: string) => Promise<{
    configured: boolean;
    allowlisted: boolean;
    scriptExists: boolean;
    enabled: boolean;
  }>;
  setDailyContextHookEnabled: (
    enabled: boolean,
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
  loadSkillToChat: (
    name: string,
    profile?: string,
  ) => Promise<{
    ok: boolean;
    name?: string;
    path?: string;
    alreadyLoaded?: boolean;
    error?: string;
  }>;
  unloadSkillFromChat: (
    name?: string,
    profile?: string,
  ) => Promise<{ ok: boolean; removed: string[] }>;
  listActiveSkills: (
    profile?: string,
  ) => Promise<Array<{ name: string; path: string }>>;
  installSkill: (
    identifier: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  uninstallSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  searchSkills: (query: string) => Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      installed: boolean;
    }>
  >;
  createSkill: (input: {
    name: string;
    description?: string;
    category?: string;
    body?: string;
    profile?: string;
  }) => Promise<{ success: boolean; error?: string; path?: string }>;
  writeSkillContent: (
    skillPath: string,
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  listDisabledSkills: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; category: string; description: string; path: string }>
  >;
  setSkillEnabled: (
    skillPath: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  discoverLocalSkills: (profile?: string) => Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      sourcePath: string;
    }>
  >;
  importLocalSkill: (
    sourcePath: string,
    category?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  generateSkillFromRepo: (
    repoPath: string,
    profile?: string,
  ) => Promise<{
    success: boolean;
    draft?: { name: string; description: string; body: string };
    error?: string;
  }>;

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
    }>
  >;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;

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
  getObsidianConfig: (profile?: string) => Promise<ObsidianConfig>;
  setObsidianConfig: (
    input: ObsidianConfigInput,
    profile?: string,
  ) => Promise<ObsidianConfig>;
  getObsidianTree: (profile?: string) => Promise<ObsidianFileNode[]>;
  readObsidianFile: (path: string, profile?: string) => Promise<string>;
  writeObsidianFile: (
    path: string,
    content: string,
    profile?: string,
  ) => Promise<boolean>;
  appendObsidianFile: (
    path: string,
    content: string,
    profile?: string,
  ) => Promise<boolean>;
  searchObsidian: (
    query: string,
    limit?: number,
    profile?: string,
  ) => Promise<
    Array<{ kind: "obsidian"; path: string; title: string; snippet: string }>
  >;
  openObsidianNote: (path: string, profile?: string) => Promise<boolean>;
  callObsidianFunction: (
    name: ObsidianFunctionName,
    payload?: Record<string, unknown>,
    profile?: string,
  ) => Promise<unknown>;
  onObsidianFileChanged: (
    callback: (event: { path: string; content: string }) => void,
  ) => () => void;

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

  // Models
  listModels: () => Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      createdAt: number;
    }>
  >;
  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
  ) => Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    createdAt: number;
  }>;
  removeModel: (id: string) => Promise<boolean>;
  updateModel: (id: string, fields: Record<string, string>) => Promise<boolean>;

  // Updates
  checkForUpdates: () => Promise<string | null>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
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
  ) => Promise<CronJob[]>;
  createCronJob: (
    schedule: string,
    prompt?: string,
    name?: string,
    deliver?: string,
    profile?: string,
    opts?: {
      freshnessWindowMinutes?: number;
      failureBehavior?: "retry" | "notify" | "ignore";
      firstRunManual?: boolean;
    },
  ) => Promise<{ success: boolean; error?: string; paused?: boolean }>;
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

  // Curator
  getCuratorStatus: (profile?: string) => Promise<string>;
  runCuratorNow: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;
  pauseCurator: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;
  resumeCurator: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;
  listArchivedSkills: (profile?: string) => Promise<string>;
  restoreArchivedSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;
  pinSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;
  unpinSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  // Checkpoints
  getCheckpointsStatus: (profile?: string) => Promise<string>;
  pruneCheckpoints: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;
  clearCheckpoints: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  // Pairing
  listPairings: (profile?: string) => Promise<string>;
  approvePairing: (
    code: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;
  revokePairing: (
    userId: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;
  clearPendingPairings: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  // Security & Prompt Size
  runSecurityAudit: (profile?: string) => Promise<string>;
  getPromptSizeBreakdown: (profile?: string) => Promise<string>;

  // Computer Use
  getComputerUseStatus: (
    profile?: string,
  ) => Promise<{ installed: boolean; output: string }>;
  installComputerUseDriver: (
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Git Changelog
  getGitChangelog: () => Promise<string>;

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
  listMcpServers: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; type: string; enabled: boolean; detail: string }>
  >;

  // Log viewer
  readLogs: (
    logFile?: string,
    lines?: number,
  ) => Promise<{ content: string; path: string }>;

  // SPS Agent workspace
  spsUnfurl: (url: string) => Promise<{
    url: string;
    title: string;
    desc: string;
    favicon?: string;
    image?: string;
  }>;
  spsAssistant: (
    prompt: string,
    ctx: {
      blocks: { type: string; text: string }[];
      pageTitle: string;
      notes?: string[];
    },
    profile?: string,
    groundInWorkspace?: boolean,
  ) => Promise<unknown>;
  spsIngestInbox: (profile?: string) => Promise<{
    ok: boolean;
    captureCount: number;
    error?: string;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
  }>;
  spsFileAnswer: (
    question: string,
    answer: string,
    profile?: string,
  ) => Promise<{
    ok: boolean;
    captureCount: number;
    error?: string;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
  }>;
  spsFileResearch: (
    topic: string,
    researchedMarkdown: string,
    profile?: string,
  ) => Promise<{
    ok: boolean;
    captureCount: number;
    error?: string;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
  }>;
  spsAppendWikiLog: (
    op: "ingest" | "file-answer" | "lint" | "research" | "digest",
    summary: string,
    profile?: string,
  ) => Promise<void>;
  spsLintWiki: (
    staleDays?: number,
    profile?: string,
  ) => Promise<{
    ok: boolean;
    error?: string;
    findings: Array<{ kind: string; page: string; note: string }>;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
    mechanical: {
      orphans: string[];
      brokenLinks: Array<{ source: string; target: string }>;
      stale: string[];
    };
    pagesScanned: number;
    pagesDropped: number;
  }>;
  spsLoad: (profile?: string) => Promise<unknown | null>;
  spsSave: (ws: unknown, profile?: string) => Promise<boolean>;
  spsGetWorkSession: (
    pageId: string,
    profile?: string,
  ) => Promise<string | null>;
  spsSetWorkSession: (
    pageId: string,
    sessionId: string,
    profile?: string,
  ) => Promise<boolean>;
  equityListBaskets: (profile?: string) => Promise<EquityBasket[]>;
  equitySaveBasket: (
    basket: Partial<EquityBasket>,
    profile?: string,
  ) => Promise<EquityBasket>;
  equityDeleteBasket: (basketId: string, profile?: string) => Promise<boolean>;
  equityListAlerts: (
    limit?: number,
    profile?: string,
  ) => Promise<EquityAlert[]>;
  equityMarkAlertRead: (alertId: string, profile?: string) => Promise<boolean>;
  onEquityAlert: (callback: (alert: EquityAlert) => void) => () => void;
  spsResearchSearchWorks: (
    q: string,
    opts?: ResearchSearchOpts,
    profile?: string,
  ) => Promise<ResearchWorkSummary[]>;
  spsResearchGetWork: (
    id: string,
    profile?: string,
  ) => Promise<ResearchWorkDetail>;
  spsResearchGetConfig: () => Promise<{ mailto: string; hasApiKey: boolean }>;
  spsResearchSetConfig: (
    mailto: string,
    apiKey?: string,
  ) => Promise<{ mailto: string; hasApiKey: boolean }>;
  spsResearchEnsureAgentTool: (
    profile?: string,
  ) => Promise<{ registered: boolean; alreadyPresent: boolean }>;
  externalContextGetConfig: () => Promise<ExternalSourceConfig>;
  externalContextSetSource: (
    source: ExternalSource,
    enabled: boolean,
  ) => Promise<ExternalSourceConfig>;
  externalContextStatus: () => Promise<ExternalIndexStatus>;
  externalContextScan: () => Promise<ExternalIndexStatus>;
  externalContextRebuild: () => Promise<ExternalIndexStatus>;
  externalContextSetMaxAge: (
    days: number | null,
  ) => Promise<ExternalIndexStatus>;
  externalContextSearch: (
    query: string,
    opts?: { source?: ExternalSource; project?: string; limit?: number },
  ) => Promise<ExternalSearchHit[]>;
  externalContextGetConversation: (
    convId: string,
    opts?: { aroundSeq?: number; limit?: number },
  ) => Promise<{
    meta: ExternalConversationMeta | null;
    messages: ExternalMessage[];
  }>;
  externalContextListProjects: (
    source?: ExternalSource,
  ) => Promise<Array<{ projectPath: string; count: number }>>;
  externalContextSaveToKb: (
    convId: string,
    profile?: string,
  ) => Promise<{
    ok: boolean;
    captureCount: number;
    error?: string;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
  }>;
  externalContextEnsureMcp: (
    profile?: string,
  ) => Promise<{ registered: boolean; alreadyPresent: boolean }>;
  onExternalContextProgress: (
    callback: (progress: ExternalScanProgress) => void,
  ) => () => void;
  spsExportPage: (
    pageId: string,
    markdown: string,
    profile?: string,
  ) => Promise<boolean>;
  spsExportRow: (
    dbFolder: string,
    rowId: string,
    markdown: string,
    profile?: string,
  ) => Promise<boolean>;
  spsReadRow: (
    dbFolder: string,
    rowId: string,
    profile?: string,
  ) => Promise<string | null>;
  spsDeleteRow: (
    dbFolder: string,
    rowId: string,
    profile?: string,
  ) => Promise<boolean>;
  spsDeletePage: (pageId: string, profile?: string) => Promise<boolean>;
  spsDeleteDbFolder: (dbFolder: string, profile?: string) => Promise<boolean>;
  spsVaultRead: (
    profile?: string,
  ) => Promise<{ pages: Record<string, string>; manifest: string | null }>;
  spsVaultWriteManifest: (json: string, profile?: string) => Promise<boolean>;
  spsBackupWorkspace: (profile?: string) => Promise<string | null>;
  spsWriteExcalidraw: (
    pageId: string,
    assetId: string,
    sceneJson: string,
    svg: string,
    profile?: string,
  ) => Promise<boolean>;
  spsReadExcalidraw: (
    pageId: string,
    assetId: string,
    profile?: string,
  ) => Promise<{ scene: string | null; svg: string | null }>;
  spsAssetWrite: (
    bytes: Uint8Array,
    ext: string,
    profile?: string,
  ) => Promise<string>;
  spsAssetExists: (name: string, profile?: string) => Promise<boolean>;
  spsAssetGc: (referenced: string[], profile?: string) => Promise<number>;
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
  ) => Promise<
    Array<{
      path: string;
      title: string;
      props: Record<string, unknown>;
      mtime: number;
    }>
  >;
  spsIndexSearch: (
    text: string,
    limit?: number,
    profile?: string,
  ) => Promise<Array<{ path: string; title: string; snippet: string }>>;
  spsIndexBacklinks: (path: string, profile?: string) => Promise<string[]>;
  spsIndexLinks: (
    profile?: string,
  ) => Promise<Array<{ source: string; target: string; type: string }>>;
  spsIndexTags: (
    profile?: string,
  ) => Promise<Array<{ tag: string; count: number }>>;
  spsIndexByTag: (tag: string, profile?: string) => Promise<string[]>;
  spsLintVault: (
    staleDays?: number,
    profile?: string,
  ) => Promise<{
    orphans: string[];
    brokenLinks: Array<{ source: string; target: string; type: string }>;
    stale: string[];
  }>;
  spsIndexStatus: (profile?: string) => Promise<{
    root: string;
    notes: number;
    links: number;
    indexedAt: number | null;
  }>;
  spsIndexRebuild: (profile?: string) => Promise<{
    root: string;
    notes: number;
    links: number;
    indexedAt: number | null;
  }>;
  spsSemanticIndex: (profile?: string) => Promise<unknown>;
  spsSemanticSearch: (query: string, limit?: number) => Promise<unknown>;
  spsSemanticGraph: () => Promise<unknown>;
  spsSemanticRag: (query: string, limit?: number) => Promise<unknown>;
  spsGetVaultLocation: (
    profile?: string,
  ) => Promise<{ dir: string; isDefault: boolean; default: string }>;
  spsSetVaultLocation: (
    dir: string,
    profile?: string,
  ) => Promise<{
    ok: boolean;
    error?: string;
    location?: { dir: string; isDefault: boolean; default: string };
    nonEmpty?: boolean;
  }>;
  spsResetVaultLocation: (
    profile?: string,
  ) => Promise<{ dir: string; isDefault: boolean; default: string }>;
  spsPickVaultDir: () => Promise<string | null>;
  spsPickPdf: () => Promise<string | null>;
  spsExtractPdf: (filePath: string) => Promise<{
    title: string;
    markdown: string;
    pageCount: number;
    hasTextLayer: boolean;
    reason?: "missing" | "unreadable";
  }>;
  spsReadFileBytes: (filePath: string) => Promise<Uint8Array>;
  runTelosAudit: (profile?: string) => Promise<{
    success: boolean;
    title?: string;
    markdown?: string;
    error?: string;
  }>;
  runPipingPattern: (
    text: string,
    pattern: string,
    profile?: string,
  ) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;

  // Python Core Bridge Integration
  pythonCompress: (text: string, tool?: string) => Promise<string>;
  pythonIsPathAllowed: (
    targetPath: string,
    actionDir: string,
  ) => Promise<boolean>;
  pythonEvaluateExecution: (
    cmdArgs: string[],
    tier: "readonly" | "supervised" | "full",
    paths: string[],
    actionDir: string,
  ) => Promise<{ decision: "ALLOW" | "PROMPT" | "BLOCK"; reason: string }>;
  pythonMemorySave: (
    vaultDir: string,
    pageId: string,
    metadata: Record<string, unknown>,
    body: string,
  ) => Promise<void>;
  pythonMemorySearch: (
    vaultDir: string,
    query: string,
  ) => Promise<Array<{ id: string; score: number }>>;
  pythonMemoryGraph: (vaultDir: string) => Promise<{
    outgoing: Record<string, string[]>;
    backlinks: Record<string, string[]>;
  }>;

  // Autopoietic Skills Registry & Generator
  syncSkillsRegistry: (
    profile?: string,
  ) => Promise<{ success: boolean; count: number; error?: string }>;
  lookupSkillRegistry: (
    query: string,
    profile?: string,
  ) => Promise<SkillEntry[]>;
  registerSkillRegistry: (
    skill: Omit<SkillEntry, "id" | "created_at">,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  scaffoldSkill: (
    name: string,
    description: string,
    code: string,
    deps: string[],
    profile?: string,
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
  testSkill: (
    name: string,
    args?: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  onSystemStabilized: (
    callback: (info: {
      jobId: string;
      jobName: string;
      explanation: string;
      filePatched: string;
      diff: string;
    }) => void,
  ) => () => void;

  getSchedulerConfig: () => Promise<{
    enabled: boolean;
    tickIntervalMs: number;
  }>;
  setSchedulerConfig: (settings: {
    enabled?: boolean;
    tickIntervalMs?: number;
  }) => Promise<boolean>;

  getSpendingCapConfig: () => Promise<{
    maxSpendingLimit: number;
    spendingCapAction: string;
  }>;
  setSpendingCapConfig: (settings: {
    maxSpendingLimit?: number;
    spendingCapAction?: string;
  }) => Promise<boolean>;

  // ── Scheduled Research ──
  srList: (profile?: string) => Promise<ScheduledResearchItem[]>;
  srCreate: (
    input: ScheduleInput,
    profile?: string,
  ) => Promise<{ ok: boolean; item?: ScheduledResearchItem; error?: string }>;
  srUpdate: (
    id: string,
    patch: SrPatch,
    profile?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  srDelete: (id: string, profile?: string) => Promise<{ ok: boolean }>;
  srRunNow: (
    id: string,
    profile?: string,
  ) => Promise<{ outcome: string; summary?: string; error?: string }>;
  srListPending: (profile?: string) => Promise<SrPendingUpdate[]>;
  srRemovePending: (id: string, profile?: string) => Promise<{ ok: boolean }>;
  srTelegramAvailability: (profile?: string) => Promise<{
    available: boolean;
    targets: Array<{ id: string; name: string }>;
  }>;
  onScheduledResearchUpdate: (
    callback: (p: {
      scheduleId: string;
      topic: string;
      summary: string;
    }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    hermesAPI: HermesAPI;
  }
}
