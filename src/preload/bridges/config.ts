import { ipcRenderer } from "electron";
import type { Attachment } from "../../shared/attachments";
import type { UsageAggregate, RunLedgerEntry } from "../../shared/usage";
import type { SearchSummary } from "../../shared/searchSummary";
import type { LoadedSkin } from "../../shared/skins";
import type { AppZoomSettings } from "../../shared/app-zoom";
import type { ConfigFixLogEntry } from "../api-types";
import type { ConfigHealthReport } from "../../shared/config-health";
import type { PublicConnectionConfig } from "../../shared/connection";
import type { CouncilConfig } from "../../shared/council";
import type { SpsAutomationPrefsPatch } from "../../shared/sps-automation";
import type { OwnerNotificationPrefsPatch } from "../../shared/owner-notifications";
import type { ConfigBridgeApi } from "./config.types";

export const configBridge = {
  // Configuration (profile-aware)
  getEnv: (profile?: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke("get-env", profile),

  getKeychainKeys: (profile?: string): Promise<string[]> =>
    ipcRenderer.invoke("get-keychain-keys", profile),

  setEnv: (key: string, value: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("set-env", key, value, profile),

  setProviderKey: (
    provider: string,
    key: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-provider-key", provider, key, profile),

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

  getConfigHealth: (profile?: string): Promise<ConfigHealthReport> =>
    ipcRenderer.invoke("get-config-health", profile),
  getOperatorReadiness: (profile?: string) =>
    ipcRenderer.invoke("get-operator-readiness", profile),
  getRoutinesStatus: (profile?: string) =>
    ipcRenderer.invoke("get-routines-status", profile),
  rerunConfigHealth: (profile?: string): Promise<ConfigHealthReport> =>
    ipcRenderer.invoke("rerun-config-health", profile),
  autofixConfigIssue: (
    code: string,
    profile?: string,
    context?: Record<string, string>,
  ): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke("autofix-config-issue", code, profile, context),
  getConfigFixLog: (maxEntries?: number): Promise<ConfigFixLogEntry[]> =>
    ipcRenderer.invoke("get-config-fix-log", maxEntries),

  getConfig: (key: string, profile?: string): Promise<string | null> =>
    ipcRenderer.invoke("get-config", key, profile),

  setConfig: (key: string, value: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("set-config", key, value, profile),

  getHermesHome: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("get-hermes-home", profile),

  getCouncilConfig: (profile?: string): Promise<CouncilConfig> =>
    ipcRenderer.invoke("get-council-config", profile),

  setCouncilConfig: (
    config: Partial<CouncilConfig>,
    profile?: string,
  ): Promise<CouncilConfig> =>
    ipcRenderer.invoke("set-council-config", config, profile),

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
  getConnectionConfig: (): Promise<PublicConnectionConfig> =>
    ipcRenderer.invoke("get-connection-config"),

  /** Usage / cost analytics for a profile (idea A2). */
  getUsageStats: (profile?: string): Promise<UsageAggregate> =>
    ipcRenderer.invoke("get-usage-stats", profile),

  /** Per-session run ledger (cost rollup joined to session titles). */
  getRunLedger: (profile?: string): Promise<RunLedgerEntry[]> =>
    ipcRenderer.invoke("get-run-ledger", profile),

  /** Summarize session-search results for a query, with citations (idea A5). */
  summarizeSearch: (query: string, profile?: string): Promise<SearchSummary> =>
    ipcRenderer.invoke("summarize-search", query, profile),

  /** Streaming variant of summarizeSearch: tokens arrive via onAskAnswerChunk
   *  (tagged with runId); the promise resolves with the full summary + sources. */
  summarizeSearchStream: (
    query: string,
    runId: string,
    profile?: string,
  ): Promise<SearchSummary> =>
    ipcRenderer.invoke("summarize-search-stream", query, runId, profile),

  /** Subscribe to streamed Ask-pane answer tokens. Returns an unsubscribe fn. */
  onAskAnswerChunk: (
    callback: (payload: { runId: string; text: string }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { runId: string; text: string },
    ): void => callback(payload);
    ipcRenderer.on("ask-answer-chunk", handler);
    return () => ipcRenderer.removeListener("ask-answer-chunk", handler);
  },

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

  /** Scoped auto-approve toggle (M2B) — desktop-enforced, per-profile policy. */
  getAutoApprove: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("get-auto-approve", profile),
  setAutoApprove: (enabled: boolean, profile?: string): Promise<void> =>
    ipcRenderer.invoke("set-auto-approve", enabled, profile),
  getSpsAutomationPrefs: (profile?: string) =>
    ipcRenderer.invoke("get-sps-automation-prefs", profile),
  setSpsAutomationPrefs: (patch: SpsAutomationPrefsPatch, profile?: string) =>
    ipcRenderer.invoke("set-sps-automation-prefs", patch, profile),
  getOwnerNotificationPrefs: (profile?: string) =>
    ipcRenderer.invoke("get-owner-notification-prefs", profile),
  setOwnerNotificationPrefs: (
    patch: OwnerNotificationPrefsPatch,
    profile?: string,
  ) => ipcRenderer.invoke("set-owner-notification-prefs", patch, profile),
  /** Completion-chime toggle (M2C). */
  getCompletionSound: (): Promise<boolean> =>
    ipcRenderer.invoke("get-completion-sound"),
  setCompletionSound: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("set-completion-sound", enabled),
  /** First-run onboarding "shown once" flag (stored in desktop.json). */
  getOnboardingCompleted: (): Promise<boolean> =>
    ipcRenderer.invoke("get-onboarding-completed"),
  setOnboardingCompleted: (completed: boolean): Promise<void> =>
    ipcRenderer.invoke("set-onboarding-completed", completed),
  /** App-level display zoom, stored in desktop.json and applied by Electron. */
  getAppZoomSettings: (): Promise<AppZoomSettings> =>
    ipcRenderer.invoke("get-app-zoom-settings"),
  setAppZoomFactor: (factor: number): Promise<AppZoomSettings> =>
    ipcRenderer.invoke("set-app-zoom-factor", factor),
  onAppZoomSettingsChanged: (
    callback: (settings: AppZoomSettings) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      settings: AppZoomSettings,
    ): void => callback(settings);
    ipcRenderer.on("app-zoom-settings-changed", handler);
    return () =>
      ipcRenderer.removeListener("app-zoom-settings-changed", handler);
  },

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
  ): Promise<{ response: string; sessionId?: string }> =>
    ipcRenderer.invoke(
      "send-message",
      message,
      profile,
      resumeSessionId,
      history,
      attachments,
      contextFolder,
      groundInWorkspace,
      clientRunId,
      modelOverride,
    ),

  adoptCouncilResponse: (
    messageId: number,
    sessionId: string,
    councilGroupId: string,
  ): Promise<void> =>
    ipcRenderer.invoke(
      "adopt-council-response",
      messageId,
      sessionId,
      councilGroupId,
    ),

  abortChat: (sessionIdOrRunId?: string): Promise<void> =>
    ipcRenderer.invoke("abort-chat", sessionIdOrRunId),

  getApiServerKeyStatus: (profile?: string): Promise<{ hasKey: boolean }> =>
    ipcRenderer.invoke("get-api-server-key-status", profile),

  generateApiServerKey: (profile?: string): Promise<{ key: string }> =>
    ipcRenderer.invoke("generate-api-server-key", profile),

  copyToClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke("copy-to-clipboard", text),
} satisfies ConfigBridgeApi;
