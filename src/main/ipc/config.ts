import { ipcMain, clipboard, shell } from "electron";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getCredentialPool,
  setCredentialPool,
  addCredentialPoolEntry,
  getConnectionConfig,
  getPublicConnectionConfig,
  resolveConnectionApiKeyUpdate,
  setConnectionConfig,
  getApiServerKey,
  getPlatformEnabled,
  setPlatformEnabled,
  getAutoApprove,
  setAutoApprove,
  getCompletionSound,
  setCompletionSound,
  readDesktopConfig,
  writeDesktopConfig,
  type SshConnectionConfig,
} from "../config";
import {
  isRemoteMode,
  isRemoteOnlyMode,
  isGatewayRunning,
  restartGateway,
  startGateway,
  stopGateway,
  testRemoteConnection,
  setSshRemoteApiKey,
  notifyProfileSwitched,
  respondRunApproval,
} from "../hermes";
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

function registerDualHandler<Args extends unknown[], RetLocal, RetSsh>(
  channel: string,
  localFn: (...args: Args) => Promise<RetLocal> | RetLocal,
  sshFn: (
    ssh: SshConnectionConfig,
    ...args: Args
  ) => Promise<RetSsh> | RetSsh,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      return sshFn(conn.ssh, ...(args as Args));
    }
    return localFn(...(args as Args));
  });
}

function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl) && !isAllowedObsidianExternalUrl(rawUrl)) {
    console.warn("[SECURITY] Blocked unsafe external URL");
    return;
  }

  shell.openExternal(rawUrl as string).catch((err) => {
    console.error("[SECURITY] Failed to open external URL:", err);
  });
}

export function registerConfigIpc(): void {
  // Env
  ipcMain.handle("get-env", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshReadEnv(conn.ssh, profile);
    return readEnv(profile);
  });

  ipcMain.handle(
    "set-env",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetEnvValue(conn.ssh, key, value, profile);
        return true;
      }
      setEnvValue(key, value, profile);
      const looksLikeCredential =
        key.endsWith("_API_KEY") ||
        key.endsWith("_TOKEN") ||
        key === "HF_TOKEN";
      if (isGatewayRunning(profile) && looksLikeCredential) {
        restartGateway(profile);
      }
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

  // Model Config
  registerDualHandler("get-model-config", getModelConfig, sshGetModelConfig);

  ipcMain.handle(
    "set-model-config",
    async (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        const prev = await sshGetModelConfig(conn.ssh, profile);
        await sshSetModelConfig(conn.ssh, provider, model, baseUrl, profile);
        if (
          (await sshGatewayStatus(conn.ssh)) &&
          (prev.provider !== provider ||
            prev.model !== model ||
            prev.baseUrl !== baseUrl)
        ) {
          await sshStopGateway(conn.ssh);
          await sshStartGateway(conn.ssh);
        }
        return true;
      }
      const prev = getModelConfig(profile);
      setModelConfig(provider, model, baseUrl, profile);

      if (
        isGatewayRunning(profile) &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        restartGateway(profile);
      }

      return true;
    },
  );

  // API Server Key Status
  ipcMain.handle("get-api-server-key-status", (_event, profile?: string) => {
    const key = getApiServerKey(profile);
    return { hasKey: key.length > 0 };
  });

  ipcMain.handle(
    "generate-api-server-key",
    async (_event, profile?: string) => {
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
    },
  );

  // Connection modes
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("is-remote-only-mode", () => isRemoteOnlyMode());
  ipcMain.handle("get-connection-config", () => getPublicConnectionConfig());

  ipcMain.handle(
    "set-connection-config",
    (
      _event,
      mode: "local" | "remote" | "ssh",
      remoteUrl: string,
      apiKey?: string,
    ) => {
      const existing = getConnectionConfig();
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
      return true;
    },
  );

  ipcMain.handle(
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
      setConnectionConfig({
        ...current,
        mode: "ssh",
        ssh: { host, port, username, keyPath, remotePort, localPort },
      });
      return true;
    },
  );

  ipcMain.handle(
    "test-remote-connection",
    (_event, url: string, apiKey?: string) => testRemoteConnection(url, apiKey),
  );

  ipcMain.handle(
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

  ipcMain.handle("start-ssh-tunnel", async () => {
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

  ipcMain.handle("stop-ssh-tunnel", () => {
    stopSshTunnel();
    return true;
  });

  ipcMain.handle("is-ssh-tunnel-active", () => isSshTunnelActive());

  // Profiles
  registerDualHandler("list-profiles", listProfiles, sshListProfiles);
  registerDualHandler("create-profile", createProfile, sshCreateProfile);
  registerDualHandler("delete-profile", deleteProfile, sshDeleteProfile);
  ipcMain.handle("set-active-profile", (_event, name: string) => {
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
  ipcMain.handle("get-credential-pool", (_event, profile?: string) =>
    getCredentialPool(profile),
  );
  ipcMain.handle(
    "set-credential-pool",
    (
      _event,
      provider: string,
      entries: Array<Record<string, unknown>>,
      profile?: string,
    ) => {
      setCredentialPool(provider, entries, profile);
      return true;
    },
  );
  ipcMain.handle(
    "add-credential-pool-entry",
    (
      _event,
      provider: string,
      apiKey: string,
      label: string,
      profile?: string,
    ) => {
      return addCredentialPoolEntry(provider, apiKey, label, profile);
    },
  );

  // Models
  ipcMain.handle("list-models", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListModels(conn.ssh);
    return listModels();
  });
  ipcMain.handle(
    "add-model",
    (
      _event,
      name: string,
      provider: string,
      model: string,
      baseUrl: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        return sshAddModel(conn.ssh, name, provider, model, baseUrl);
      }
      return addModel(name, provider, model, baseUrl);
    },
  );
  ipcMain.handle("remove-model", (_event, id: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRemoveModel(conn.ssh, id);
    return removeModel(id);
  });
  ipcMain.handle(
    "update-model",
    (_event, id: string, fields: Record<string, string>) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUpdateModel(conn.ssh, id, fields);
      return updateModel(id, fields);
    },
  );

  // OAuth Sign-In
  ipcMain.handle("oauth-login", (event, provider: string, profile?: string) => {
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
  ipcMain.handle("oauth-login-cancel", () => cancelHermesAuthLogin());

  // Gateway
  ipcMain.handle("start-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStartGateway(conn.ssh);
      return true;
    }
    if (conn.mode === "remote") {
      return false;
    }
    return startGateway();
  });
  ipcMain.handle("stop-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStopGateway(conn.ssh);
      return true;
    }
    if (conn.mode === "remote") {
      return true;
    }
    stopGateway(undefined, true);
    return true;
  });
  ipcMain.handle("gateway-status", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGatewayStatus(conn.ssh);
    return isGatewayRunning();
  });

  // Platform toggles
  ipcMain.handle("get-platform-enabled", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetPlatformEnabled(conn.ssh, profile);
    return getPlatformEnabled(profile);
  });
  ipcMain.handle(
    "set-platform-enabled",
    async (_event, platform: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetPlatformEnabled(conn.ssh, platform, enabled, profile);
        return true;
      }
      setPlatformEnabled(platform, enabled, profile);
      if (isGatewayRunning(profile)) {
        restartGateway(profile);
      }
      return true;
    },
  );

  // Model discovery
  ipcMain.handle(
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
  ipcMain.handle(
    "respond-approval",
    (
      _event,
      runId: string,
      choice: "once" | "session" | "always" | "deny",
      profile?: string,
    ) => respondRunApproval(runId, choice, profile),
  );

  // Desktop automation prefs
  ipcMain.handle("get-auto-approve", (_event, profile?: string) =>
    getAutoApprove(profile),
  );
  ipcMain.handle(
    "set-auto-approve",
    (_event, enabled: boolean, profile?: string) =>
      setAutoApprove(enabled, profile),
  );
  ipcMain.handle("get-completion-sound", () => getCompletionSound());
  ipcMain.handle("set-completion-sound", (_event, enabled: boolean) =>
    setCompletionSound(enabled),
  );
}
