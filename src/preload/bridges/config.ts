import { ipcRenderer } from "electron";
import type { Attachment } from "../../shared/attachments";
import type { UsageAggregate, RunLedgerEntry } from "../../shared/usage";
import type { SearchSummary } from "../../shared/searchSummary";
import type { LoadedSkin } from "../../shared/skins";

export const configBridge = {
  // Configuration (profile-aware)
  getEnv: (profile?: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke("get-env", profile),

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

  /** Per-session run ledger (cost rollup joined to session titles). */
  getRunLedger: (profile?: string): Promise<RunLedgerEntry[]> =>
    ipcRenderer.invoke("get-run-ledger", profile),

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

  /** Scoped auto-approve toggle (M2B) — desktop-enforced, per-profile policy. */
  getAutoApprove: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("get-auto-approve", profile),
  setAutoApprove: (enabled: boolean, profile?: string): Promise<void> =>
    ipcRenderer.invoke("set-auto-approve", enabled, profile),
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

  abortChat: (): Promise<void> => ipcRenderer.invoke("abort-chat"),

  getApiServerKeyStatus: (profile?: string): Promise<{ hasKey: boolean }> =>
    ipcRenderer.invoke("get-api-server-key-status", profile),

  generateApiServerKey: (profile?: string): Promise<{ key: string }> =>
    ipcRenderer.invoke("generate-api-server-key", profile),

  copyToClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke("copy-to-clipboard", text),
};
