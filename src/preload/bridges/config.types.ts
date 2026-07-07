import type * as Api from "../api-types";
import type { CouncilConfig } from "../../shared/council";

export interface ConfigBridgeApi {
  getEnv: (profile?: string) => Promise<Record<string, string>>;

  getKeychainKeys: (profile?: string) => Promise<string[]>;

  setEnv: (key: string, value: string, profile?: string) => Promise<boolean>;

  setProviderKey: (
    provider: string,
    key: string,
    profile?: string,
  ) => Promise<boolean>;

  validateChatReadiness: (profile?: string) => Promise<Api.ChatReadiness>;

  // Config-health audit (Diagnose section)

  getConfigHealth: (profile?: string) => Promise<Api.ConfigHealthReport>;

  getOperatorReadiness: (
    profile?: string,
  ) => Promise<Api.OperatorReadinessReport>;

  getRoutinesStatus: (profile?: string) => Promise<Api.RoutinesStatusReport>;

  rerunConfigHealth: (profile?: string) => Promise<Api.ConfigHealthReport>;

  autofixConfigIssue: (
    code: string,
    profile?: string,
    context?: Record<string, string>,
  ) => Promise<{ ok: boolean; message?: string }>;

  getConfigFixLog: (maxEntries?: number) => Promise<Api.ConfigFixLogEntry[]>;

  getConfig: (key: string, profile?: string) => Promise<string | null>;

  setConfig: (key: string, value: string, profile?: string) => Promise<boolean>;

  getHermesHome: (profile?: string) => Promise<string>;

  getCouncilConfig: (profile?: string) => Promise<CouncilConfig>;

  setCouncilConfig: (
    config: Partial<CouncilConfig>,
    profile?: string,
  ) => Promise<CouncilConfig>;

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

  getConnectionConfig: () => Promise<Api.PublicConnectionConfig>;

  getUsageStats: (profile?: string) => Promise<Api.UsageAggregate>;

  getRunLedger: (profile?: string) => Promise<Api.RunLedgerEntry[]>;

  summarizeSearch: (
    query: string,
    profile?: string,
  ) => Promise<Api.SearchSummary>;

  summarizeSearchStream: (
    query: string,
    runId: string,
    profile?: string,
  ) => Promise<Api.SearchSummary>;

  onAskAnswerChunk: (
    callback: (payload: { runId: string; text: string }) => void,
  ) => () => void;

  listSkins: (profile?: string) => Promise<Api.LoadedSkin[]>;

  respondApproval: (
    runId: string,
    choice: "once" | "session" | "always" | "deny",
    profile?: string,
  ) => Promise<{ ok: boolean; error?: string }>;

  getAutoApprove: (profile?: string) => Promise<boolean>;

  setAutoApprove: (enabled: boolean, profile?: string) => Promise<void>;

  getSpsAutomationPrefs: (profile?: string) => Promise<Api.SpsAutomationPrefs>;

  setSpsAutomationPrefs: (
    patch: Api.SpsAutomationPrefsPatch,
    profile?: string,
  ) => Promise<Api.SpsAutomationPrefs>;

  getOwnerNotificationPrefs: (
    profile?: string,
  ) => Promise<Api.OwnerNotificationPrefs>;

  setOwnerNotificationPrefs: (
    patch: Api.OwnerNotificationPrefsPatch,
    profile?: string,
  ) => Promise<Api.OwnerNotificationPrefs>;

  getCompletionSound: () => Promise<boolean>;

  setCompletionSound: (enabled: boolean) => Promise<void>;

  getOnboardingCompleted: () => Promise<boolean>;

  setOnboardingCompleted: (completed: boolean) => Promise<void>;

  getAppZoomSettings: () => Promise<Api.AppZoomSettings>;

  setAppZoomFactor: (factor: number) => Promise<Api.AppZoomSettings>;

  onAppZoomSettingsChanged: (
    callback: (settings: Api.AppZoomSettings) => void,
  ) => () => void;

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
    attachments?: Api.Attachment[],
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

  abortChat: (sessionIdOrRunId?: string) => Promise<void>;

  getApiServerKeyStatus: (profile?: string) => Promise<{ hasKey: boolean }>;

  generateApiServerKey: (profile?: string) => Promise<{ key: string }>;

  copyToClipboard: (text: string) => Promise<void>;
}
