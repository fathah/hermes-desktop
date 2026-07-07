import { clipboard, shell } from "electron";
import { safeHandle } from "./safe-handle";
import { appendActionReceipt } from "../action-receipts";
import {
  readEnv,
  getKeychainKeys,
  setEnvValue,
  resolveProviderEnvKey,
  getConfigValue,
  setConfigValue,
  getCouncilConfig,
  setCouncilConfig,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getCredentialPool,
  setCredentialPool,
  addCredentialPoolEntry,
  getOAuthProviderStatus,
  removeOAuthProviderCredentials,
  getConnectionConfig,
  getPublicConnectionConfig,
  resolveConnectionApiKeyUpdate,
  setConnectionConfig,
  getApiServerKey,
  getPlatformEnabled,
  setPlatformEnabled,
  getAutoApprove,
  setAutoApprove,
  getSpsAutomationPrefs,
  setSpsAutomationPrefs,
  getOwnerNotificationPrefs,
  setOwnerNotificationPrefs,
  getCompletionSound,
  setCompletionSound,
  getOnboardingCompleted,
  setOnboardingCompleted,
  readDesktopConfig,
  writeDesktopConfig,
} from "../config";
import {
  isRemoteMode,
  isRemoteOnlyMode,
  isGatewayRunning,
  restartGateway,
  startGateway,
  startGatewayDetailed,
  stopGateway,
  testRemoteConnection,
  setSshRemoteApiKey,
  clearSshRemoteApiKey,
  notifyProfileSwitched,
  respondRunApproval,
} from "../hermes";
import {
  getConnectionGatewayHealthStatus,
  isConnectionGatewayRunning,
} from "../gateway-status";
import {
  startSshTunnel,
  stopSshTunnel,
  testSshConnection,
  isSshTunnelActive,
} from "../ssh-tunnel";
import {
  sshReadEnv,
  sshSetEnvValue,
  sshGetConfigValue,
  sshSetConfigValue,
  sshGetHermesHome,
  sshGetModelConfig,
  sshSetModelConfig,
  sshReadRemoteApiKey,
  sshGatewayStatus,
  sshStartGateway,
  sshStopGateway,
  sshListProfiles,
  sshCreateProfile,
  sshDeleteProfile,
  sshListModels,
  sshAddModel,
  sshRemoveModel,
  sshUpdateModel,
  sshGetPlatformEnabled,
  sshSetPlatformEnabled,
} from "../ssh-remote";
import { discoverProviderModels } from "../model-discovery";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
} from "../profiles";
import { listModels, addModel, removeModel, updateModel } from "../models";
import {
  runHermesAuthLogin,
  cancelHermesAuthLogin,
  accumulateOAuthPromptAction,
} from "../hermes-auth";
import { isAllowedExternalUrl } from "../security";
import { isAllowedObsidianExternalUrl } from "../obsidian";
import { refreshEngineCapabilities } from "../engine-capabilities";
import { formatLogError, log } from "../log";
import { registerDualHandler } from "./utility";
import {
  getSchedulerConfig,
  setSchedulerConfig,
  getSchedulerSkips,
  SchedulerConfig,
} from "../scheduler";
import {
  getSpendingCapConfig,
  setSpendingCapConfig,
  SpendingCapConfig,
} from "../spending-limits";
import { getWhatsAppCloudStatus } from "../whatsapp-cloud-status";
import {
  applyAppZoomToWebContents,
  getAppZoomSettings,
  setAppZoomFactor,
} from "../app-zoom";
import type { CouncilConfig } from "../../shared/council";
import type { SpsAutomationPrefsPatch } from "../../shared/sps-automation";
import type { OwnerNotificationPrefsPatch } from "../../shared/owner-notifications";

function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl) && !isAllowedObsidianExternalUrl(rawUrl)) {
    log.warn("security", {
      msg: "blocked unsafe external URL",
      url: typeof rawUrl === "string" ? rawUrl : undefined,
    });
    return;
  }

  shell.openExternal(rawUrl as string).catch((err) => {
    log.error("security", {
      msg: "failed to open external URL",
      url: rawUrl as string,
      error: formatLogError(err),
    });
  });
}

function refreshEngineCapabilitiesForActiveProfile(): void {
  void refreshEngineCapabilities().catch((err) => {
    log.warn("engine-capabilities", {
      msg: "connection-change refresh failed",
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export function registerConfigIpc(): void {
  // Env
  registerDualHandler("get-env", readEnv, sshReadEnv);
  registerDualHandler(
    "get-keychain-keys",
    (profile?: string) => getKeychainKeys(profile),
    async (_ssh, _profile?: string) => [],
  );

  registerDualHandler(
    "set-env",
    async (key: string, value: string, profile?: string) => {
      setEnvValue(key, value, profile);
      const looksLikeCredential =
        key.endsWith("_API_KEY") ||
        key.endsWith("_TOKEN") ||
        key === "HF_TOKEN";
      if (looksLikeCredential) {
        appendActionReceipt(
          {
            source: "provider",
            action: "credential",
            outcome: "saved",
            summary: key,
          },
          profile,
        );
      }
      if (isGatewayRunning(profile) && looksLikeCredential) {
        void restartGateway(profile);
      }
      return true;
    },
    async (ssh, key: string, value: string, profile?: string) => {
      await sshSetEnvValue(ssh, key, value, profile);
      return true;
    },
  );

  // MED-2: a narrow, allowlisted choke point for the AI co-author's "config"
  // action. The assistant path used the generic set-env (any env var); this
  // maps a known provider to its credential var server-side via
  // resolveProviderEnvKey and REFUSES anything else, so a model-proposed action
  // can never set arbitrary env.
  registerDualHandler(
    "set-provider-key",
    async (provider: string, key: string, profile?: string) => {
      const envKey = resolveProviderEnvKey(provider);
      if (!envKey) return false;
      setEnvValue(envKey, key, profile);
      appendActionReceipt(
        {
          source: "provider",
          action: "credential",
          outcome: "saved",
          summary: provider,
        },
        profile,
      );
      if (isGatewayRunning(profile)) void restartGateway(profile);
      return true;
    },
    async (ssh, provider: string, key: string, profile?: string) => {
      const envKey = resolveProviderEnvKey(provider);
      if (!envKey) return false;
      await sshSetEnvValue(ssh, envKey, key, profile);
      appendActionReceipt(
        {
          source: "provider",
          action: "credential",
          outcome: "saved",
          summary: provider,
        },
        profile,
      );
      return true;
    },
  );

  // General Config
  registerDualHandler("get-config", getConfigValue, sshGetConfigValue);

  registerDualHandler(
    "set-config",
    async (key: string, value: string, profile?: string) => {
      setConfigValue(key, value, profile);
      return true;
    },
    async (ssh, key: string, value: string, profile?: string) => {
      await sshSetConfigValue(ssh, key, value, profile);
      return true;
    },
  );

  registerDualHandler("get-hermes-home", getHermesHome, sshGetHermesHome);

  safeHandle("get-council-config", (_event, profile?: string) =>
    getCouncilConfig(profile),
  );

  safeHandle(
    "set-council-config",
    (_event, config: Partial<CouncilConfig>, profile?: string) =>
      setCouncilConfig(config, profile),
  );

  // Model Config
  registerDualHandler("get-model-config", getModelConfig, sshGetModelConfig);

  registerDualHandler(
    "set-model-config",
    async (
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const prev = getModelConfig(profile);
      setModelConfig(provider, model, baseUrl, profile);

      if (
        isGatewayRunning(profile) &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        void restartGateway(profile);
      }

      return true;
    },
    async (
      ssh,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const prev = await sshGetModelConfig(ssh, profile);
      await sshSetModelConfig(ssh, provider, model, baseUrl, profile);
      if (
        (await sshGatewayStatus(ssh)) &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        await sshStopGateway(ssh);
        await sshStartGateway(ssh);
      }
      return true;
    },
  );

  // API Server Key Status
  safeHandle("get-api-server-key-status", (_event, profile?: string) => {
    const key = getApiServerKey(profile);
    return { hasKey: key.length > 0 };
  });

  safeHandle("generate-api-server-key", async (_event, profile?: string) => {
    const { randomUUID } = await import("crypto");
    const key = `desk-${randomUUID()}`;

    const data = readDesktopConfig();
    data.apiServerKey = key;
    writeDesktopConfig(data);

    setEnvValue("API_SERVER_KEY", "", profile);
    if (profile && profile !== "default") {
      setEnvValue("API_SERVER_KEY", "");
    }

    if (isGatewayRunning(profile)) {
      stopGateway(profile, true);
      await new Promise<void>((r) => setTimeout(r, 800));
      startGateway(profile);
    }
    return { key };
  });

  // Connection modes
  safeHandle("is-remote-mode", () => isRemoteMode());
  safeHandle("is-remote-only-mode", () => isRemoteOnlyMode());
  safeHandle("get-connection-config", () => getPublicConnectionConfig());

  safeHandle(
    "set-connection-config",
    (
      _event,
      mode: "local" | "remote" | "ssh",
      remoteUrl: string,
      apiKey?: string,
    ) => {
      const existing = getConnectionConfig();
      // Phase 1.4 — a mode change invalidates the cached SSH-remote key so it is
      // never reused against a different connection.
      if (existing.mode !== mode) {
        clearSshRemoteApiKey();
      }
      setConnectionConfig({
        ...existing,
        mode,
        remoteUrl,
        apiKey: resolveConnectionApiKeyUpdate(
          existing,
          mode,
          remoteUrl,
          apiKey,
        ),
      });
      refreshEngineCapabilitiesForActiveProfile();
      return true;
    },
  );

  safeHandle(
    "set-ssh-config",
    (
      _event,
      host: string,
      port: number,
      username: string,
      keyPath: string,
      remotePort: number,
      localPort: number,
    ) => {
      const current = getConnectionConfig();
      // Phase 1.4 — a new SSH target makes any cached key (fetched for the old
      // host) invalid; drop it so it is never sent to the new host.
      clearSshRemoteApiKey();
      setConnectionConfig({
        ...current,
        mode: "ssh",
        ssh: { host, port, username, keyPath, remotePort, localPort },
      });
      refreshEngineCapabilitiesForActiveProfile();
      return true;
    },
  );

  safeHandle("test-remote-connection", (_event, url: string, apiKey?: string) =>
    testRemoteConnection(url, apiKey),
  );

  safeHandle(
    "test-ssh-connection",
    (
      _event,
      host: string,
      port: number,
      username: string,
      keyPath: string,
      remotePort: number,
    ) =>
      testSshConnection({
        host,
        port,
        username,
        keyPath,
        remotePort,
        localPort: 19642,
      }),
  );

  safeHandle("start-ssh-tunnel", async () => {
    const conn = getConnectionConfig();
    if (conn.mode !== "ssh") return false;
    if (conn.ssh && !(await sshGatewayStatus(conn.ssh))) {
      await sshStartGateway(conn.ssh);
    }
    await startSshTunnel(conn.ssh);
    if (conn.ssh) {
      const key = await sshReadRemoteApiKey(conn.ssh);
      setSshRemoteApiKey(key);
    }
    return true;
  });

  safeHandle("stop-ssh-tunnel", () => {
    stopSshTunnel();
    // Phase 1.4 — tearing down the tunnel invalidates the cached remote key.
    clearSshRemoteApiKey();
    return true;
  });

  safeHandle("is-ssh-tunnel-active", () => isSshTunnelActive());

  // Profiles
  registerDualHandler("list-profiles", listProfiles, sshListProfiles);
  registerDualHandler("create-profile", createProfile, sshCreateProfile);
  registerDualHandler("delete-profile", deleteProfile, sshDeleteProfile);
  safeHandle("set-active-profile", (_event, name: string) => {
    if (getConnectionConfig().mode !== "ssh") {
      setActiveProfile(name);
      notifyProfileSwitched();
      if (!isRemoteMode() && !isGatewayRunning(name)) {
        startGateway(name);
      }
    }
    return true;
  });

  // Credential Pool
  safeHandle("get-credential-pool", (_event, profile?: string) =>
    getCredentialPool(profile),
  );
  safeHandle(
    "set-credential-pool",
    (
      _event,
      provider: string,
      entries: Array<Record<string, unknown>>,
      profile?: string,
    ) => {
      setCredentialPool(provider, entries, profile);
      appendActionReceipt(
        {
          source: "provider",
          action: "credential-pool",
          outcome: "saved",
          summary: provider,
          counts: { entries: entries.length },
        },
        profile,
      );
      return true;
    },
  );
  safeHandle(
    "add-credential-pool-entry",
    (
      _event,
      provider: string,
      apiKey: string,
      label: string,
      profile?: string,
    ) => {
      const result = addCredentialPoolEntry(provider, apiKey, label, profile);
      appendActionReceipt(
        {
          source: "provider",
          action: "credential-pool-entry",
          outcome: "saved",
          summary: provider,
        },
        profile,
      );
      return result;
    },
  );
  safeHandle(
    "get-oauth-provider-status",
    (_event, provider: string, profile?: string) =>
      getOAuthProviderStatus(provider, profile),
  );
  safeHandle(
    "remove-oauth-provider-credentials",
    (_event, provider: string, profile?: string) =>
      removeOAuthProviderCredentials(provider, profile),
  );

  // Models
  registerDualHandler("list-models", listModels, sshListModels);
  registerDualHandler(
    "add-model",
    addModel,
    (ssh, name: string, provider: string, model: string, baseUrl: string) =>
      sshAddModel(ssh, name, provider, model, baseUrl),
  );
  registerDualHandler("remove-model", removeModel, sshRemoveModel);
  registerDualHandler(
    "update-model",
    updateModel,
    (ssh, id: string, fields: Record<string, string>) =>
      sshUpdateModel(ssh, id, fields),
  );

  // OAuth Sign-In
  safeHandle("oauth-login", (event, provider: string, profile?: string) => {
    const promptState = { buffer: "", handled: false };
    return runHermesAuthLogin(
      provider,
      (chunk) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send("oauth-login-progress", chunk);
        const action = accumulateOAuthPromptAction(promptState, chunk);
        if (action?.kind === "device-code") {
          openExternalUrl(action.url);
          clipboard.writeText(action.code);
          event.sender.send(
            "oauth-login-progress",
            `\n→ Code ${action.code} copied to clipboard — opening browser...\n`,
          );
        } else if (action?.kind === "auth-url") {
          openExternalUrl(action.url);
          event.sender.send(
            "oauth-login-progress",
            "\n→ Opening browser for sign-in...\n",
          );
        }
      },
      profile,
    );
  });
  safeHandle("oauth-login-cancel", () => cancelHermesAuthLogin());

  // Gateway
  registerDualHandler(
    "start-gateway",
    async () => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return {
          success: false,
          running: false,
          error:
            "Remote mode points at an existing Hermes gateway. Start or restart the gateway on the remote host.",
        };
      }
      return startGatewayDetailed();
    },
    async (ssh) => {
      await sshStartGateway(ssh);
      return { success: true, running: true };
    },
  );
  registerDualHandler(
    "stop-gateway",
    async () => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return true;
      }
      stopGateway(undefined, true);
      return true;
    },
    async (ssh) => {
      await sshStopGateway(ssh);
      return true;
    },
  );
  safeHandle("gateway-status", () => isConnectionGatewayRunning());
  safeHandle("gateway-health-status", () => getConnectionGatewayHealthStatus());

  // Platform toggles
  registerDualHandler(
    "get-platform-enabled",
    getPlatformEnabled,
    sshGetPlatformEnabled,
  );
  registerDualHandler(
    "set-platform-enabled",
    async (platform: string, enabled: boolean, profile?: string) => {
      setPlatformEnabled(platform, enabled, profile);
      if (isGatewayRunning(profile)) {
        void restartGateway(profile);
      }
      return true;
    },
    async (ssh, platform: string, enabled: boolean, profile?: string) => {
      await sshSetPlatformEnabled(ssh, platform, enabled, profile);
      return true;
    },
  );
  safeHandle("get-whatsapp-cloud-status", (_event, profile?: string) =>
    getWhatsAppCloudStatus(profile),
  );

  // Model discovery
  safeHandle(
    "discover-provider-models",
    (
      _event,
      provider: string,
      baseUrl: string | undefined,
      apiKey: string | undefined,
      profile?: string,
    ) => {
      return discoverProviderModels(provider, baseUrl, apiKey, profile);
    },
  );

  // Command-approval reply
  safeHandle(
    "respond-approval",
    (
      _event,
      runId: string,
      choice: "once" | "session" | "always" | "deny",
      profile?: string,
    ) => respondRunApproval(runId, choice, profile),
  );

  // Desktop automation prefs
  safeHandle("get-auto-approve", (_event, profile?: string) =>
    getAutoApprove(profile),
  );
  safeHandle("set-auto-approve", (_event, enabled: boolean, profile?: string) =>
    setAutoApprove(enabled, profile),
  );
  safeHandle("get-sps-automation-prefs", (_event, profile?: string) =>
    getSpsAutomationPrefs(profile),
  );
  safeHandle(
    "set-sps-automation-prefs",
    (_event, patch: SpsAutomationPrefsPatch, profile?: string) =>
      setSpsAutomationPrefs(patch, profile),
  );
  safeHandle("get-owner-notification-prefs", (_event, profile?: string) =>
    getOwnerNotificationPrefs(profile),
  );
  safeHandle(
    "set-owner-notification-prefs",
    (_event, patch: OwnerNotificationPrefsPatch, profile?: string) =>
      setOwnerNotificationPrefs(patch, profile),
  );
  safeHandle("get-completion-sound", () => getCompletionSound());
  safeHandle("set-completion-sound", (_event, enabled: boolean) =>
    setCompletionSound(enabled),
  );
  safeHandle("get-onboarding-completed", () => getOnboardingCompleted());
  safeHandle("set-onboarding-completed", (_event, completed: boolean) =>
    setOnboardingCompleted(completed),
  );
  safeHandle("get-app-zoom-settings", () => getAppZoomSettings());
  safeHandle("set-app-zoom-factor", (event, factor: number) => {
    const settings = setAppZoomFactor(factor);
    applyAppZoomToWebContents(event.sender, settings);
    event.sender.send("app-zoom-settings-changed", settings);
    return settings;
  });

  // Scheduler Config
  safeHandle("get-scheduler-config", () => getSchedulerConfig());
  safeHandle(
    "set-scheduler-config",
    (_event, settings: Partial<SchedulerConfig>) => {
      setSchedulerConfig(settings);
      return true;
    },
  );
  // Phase 1.2 — per-job skip telemetry (locked/timeout-reaped). Surfaced in the
  // Scheduled modal in Phase 2.2 so a job the scheduler keeps skipping is visible.
  safeHandle("get-scheduler-skips", () => getSchedulerSkips());

  // Spending Cap Config
  safeHandle("get-spending-cap-config", () => getSpendingCapConfig());
  safeHandle(
    "set-spending-cap-config",
    (_event, settings: Partial<SpendingCapConfig>) => {
      setSpendingCapConfig(settings);
      return true;
    },
  );
}
