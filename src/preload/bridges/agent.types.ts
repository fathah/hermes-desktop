import type * as Api from "../api-types";

export interface AgentBridgeApi {
  startGateway: () => Promise<boolean>;

  stopGateway: () => Promise<boolean>;

  gatewayStatus: () => Promise<boolean>;

  gatewayHealthStatus: () => Promise<
    import("../../shared/gateway").GatewayHealthStatus
  >;

  onGatewayHealthChanged: (
    callback: (
      change: import("../../shared/gateway").GatewayHealthChange,
    ) => void,
  ) => () => void;

  // Platform toggles

  getPlatformEnabled: (profile?: string) => Promise<Record<string, boolean>>;

  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;

  getWhatsAppCloudStatus: (
    profile?: string,
  ) => Promise<Api.WhatsAppCloudStatus>;

  // Sessions

  listSessions: (
    limit?: number,
    offset?: number,
  ) => Promise<Api.SessionSummary[]>;

  getSessionMessages: (sessionId: string) => Promise<
    Array<
      | {
          kind: "user";
          id: number;
          content: string;
          timestamp: number;
          attachments?: Api.Attachment[];
        }
      | {
          kind: "assistant";
          id: number;
          content: string;
          timestamp: number;
          attachments?: Api.Attachment[];
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
          attachments?: Api.Attachment[];
        }
    >
  >;

  // Profiles

  listProfiles: () => Promise<Api.ProfileInfo[]>;

  createProfile: (
    name: string,
    clone: boolean,
  ) => Promise<{ success: boolean; error?: string }>;

  deleteProfile: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;

  setActiveProfile: (name: string) => Promise<boolean>;

  // Memory

  readMemory: (profile?: string) => Promise<Api.MemoryInfo>;

  getMemoryTimeline: (profile?: string) => Promise<Api.MemoryTimeline>;

  listLearningProposals: (profile?: string) => Promise<Api.LearningProposal[]>;

  createLearningProposal: (
    input: Api.CreateLearningProposalInput,
    profile?: string,
  ) => Promise<Api.LearningProposalResult>;

  acceptLearningProposal: (
    id: string,
    profile?: string,
  ) => Promise<Api.LearningProposalResult>;

  dismissLearningProposal: (
    id: string,
    profile?: string,
  ) => Promise<Api.LearningProposalResult>;

  rollbackLearningProposal: (
    id: string,
    profile?: string,
  ) => Promise<Api.LearningProposalResult>;

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

  listSkillUsage: (
    profile?: string,
  ) => Promise<Record<string, Api.SkillUsageEntry>>;

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

  getObsidianConfig: (profile?: string) => Promise<Api.ObsidianConfig>;

  setObsidianConfig: (
    input: Api.ObsidianConfigInput,
    profile?: string,
  ) => Promise<Api.ObsidianConfig>;

  getObsidianTree: (profile?: string) => Promise<Api.ObsidianFileNode[]>;

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
    name: Api.ObsidianFunctionName,
    payload?: Record<string, unknown>,
    profile?: string,
  ) => Promise<unknown>;

  onObsidianFileChanged: (
    callback: (event: { path: string; content: string }) => void,
  ) => () => void;

  // Credential Pool (profile-aware) — entries follow the upstream
  // engine schema (issue #367). See `Api.CredentialPoolEntry` below.
}
