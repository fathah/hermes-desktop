import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../useI18n";
import { getAnalyticsConsent } from "../../utils/analytics";
import {
  CHAT_TRANSPORT_OPTIONS,
  getCachedOpenClaw,
  getCachedVersion,
  makeApiKeyMask,
  setCachedVersion,
  versionCacheKey,
  type RemoteChatTransport,
  type TransportProbe,
} from "./settingsHelpers";

export { CHAT_TRANSPORT_OPTIONS };
export type { RemoteChatTransport, TransportProbe };

/**
 * Owns every piece of Settings state, the config-load effect, and all the
 * mutation handlers that used to live inside the monolithic `Settings`
 * screen. The settings modal calls this once and shares the result with each
 * pane through `SettingsDataContext`, so the panes stay purely presentational.
 *
 * The return type is intentionally inferred (and re-exported as `SettingsData`
 * via `ReturnType`) — annotating it explicitly would just duplicate ~60 field
 * types and drift out of sync.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSettingsData(profile?: string) {
  const { t } = useI18n();
  const [hermesHome, setHermesHome] = useState("");

  const [hermesVersion, setHermesVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [updateResultType, setUpdateResultType] = useState<
    "success" | "error" | null
  >(null);
  const [autoUpgradeEnabled, setAutoUpgradeEnabled] = useState(true);
  const [autoUpgradeSaved, setAutoUpgradeSaved] = useState(false);

  // OpenClaw migration — initialize from localStorage cache
  const cachedClaw = getCachedOpenClaw();
  const [openclawFound, setOpenclawFound] = useState(
    cachedClaw?.found ?? false,
  );
  const [openclawPath, setOpenclawPath] = useState<string | null>(
    cachedClaw?.path ?? null,
  );
  const [migrationDismissed, setMigrationDismissed] = useState(
    () => localStorage.getItem("hermes-openclaw-dismissed") === "true",
  );
  const [migrating, setMigrating] = useState(false);
  const [migrationLog, setMigrationLog] = useState("");
  const [migrationResult, setMigrationResult] = useState<string | null>(null);
  const [migrationResultType, setMigrationResultType] = useState<
    "success" | "error" | null
  >(null);
  const migrationLogRef = useRef<HTMLPreElement>(null);

  // Connection mode
  const [connMode, setConnMode] = useState<"local" | "remote" | "ssh">("local");
  const [connRemoteUrl, setConnRemoteUrl] = useState("");
  const [connApiKey, setConnApiKey] = useState("");
  const [connApiKeyMask, setConnApiKeyMask] = useState("");
  const [connHasApiKey, setConnHasApiKey] = useState(false);
  const [remoteAuthMode, setRemoteAuthMode] = useState<
    "auto" | "token" | "oauth"
  >("auto");
  const [remoteOAuthSignedIn, setRemoteOAuthSignedIn] = useState(false);
  const [remoteOAuthBusy, setRemoteOAuthBusy] = useState(false);
  const [remoteChatTransport, setRemoteChatTransport] =
    useState<RemoteChatTransport>("auto");
  const [sshChatTransport, setSshChatTransport] =
    useState<RemoteChatTransport>("auto");
  const [connTesting, setConnTesting] = useState(false);
  const [connStatus, setConnStatus] = useState<string | null>(null);
  const connLoaded = useRef(false);
  const [apiServerKeyMissing, setApiServerKeyMissing] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  // SSH connection state
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshRemotePort, setSshRemotePort] = useState("");
  const [sshLocalPort, setSshLocalPort] = useState("");
  const [sshDockerContainer, setSshDockerContainer] = useState("");
  const [transportProbe, setTransportProbe] = useState<TransportProbe | null>(
    null,
  );

  // Backup / Import state
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // Log viewer state
  const [logContent, setLogContent] = useState("");
  const [logFile, setLogFile] = useState("gateway.log");
  const [logPath, setLogPath] = useState("");
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Network settings
  const [forceIpv4, setForceIpv4] = useState(false);
  const [httpProxy, setHttpProxy] = useState("");
  const httpProxyRef = useRef("");
  const savedHttpProxyRef = useRef("");
  const [networkSaved, setNetworkSaved] = useState(false);

  // Debug dump
  const [dumpOutput, setDumpOutput] = useState<string | null>(null);
  const [dumpRunning, setDumpRunning] = useState(false);

  // Analytics consent
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() =>
    getAnalyticsConsent(),
  );

  // Desktop app (Electron) auto-update — a *separate* update channel from the
  // Hermes Agent engine update above: this ships the desktop shell itself via
  // electron-updater / GitHub releases. Mirrors the sidebar-footer updater so
  // the About pane can check/download/restart on its own.
  const [desktopUpdateState, setDesktopUpdateState] = useState<
    | "available"
    | "downloading"
    | "ready"
    | "error"
    | "checking"
    | "uptodate"
    | null
  >(null);
  const [desktopUpdateVersion, setDesktopUpdateVersion] = useState<
    string | null
  >(null);
  const [desktopUpdatePercent, setDesktopUpdatePercent] = useState<
    number | null
  >(null);
  const [desktopUpdateError, setDesktopUpdateError] = useState<string | null>(
    null,
  );

  const loadConfigRequestRef = useRef(0);

  const loadConfig = useCallback(async (): Promise<void> => {
    const requestId = ++loadConfigRequestRef.current;
    setHermesHome("");
    setHermesVersion(null);

    // Load fast config first (cached in main process)
    const [aVersion, conn, keyStatus, autoUpgrade] = await Promise.all([
      window.hermesAPI.getAppVersion(),
      window.hermesAPI.getConnectionConfig(),
      window.hermesAPI.getApiServerKeyStatus(profile),
      window.hermesAPI.getAutoUpgradeEnabled(),
    ]);

    if (requestId !== loadConfigRequestRef.current) return;

    const cacheKey = versionCacheKey(conn, profile);
    setHermesVersion(getCachedVersion(cacheKey));
    setAppVersion(aVersion);
    setConnMode(conn.mode);
    setConnRemoteUrl(conn.remoteUrl);
    setConnHasApiKey(conn.hasApiKey);
    setRemoteAuthMode(conn.remoteAuthMode ?? "auto");
    setRemoteChatTransport(conn.remoteChatTransport ?? "auto");
    setSshChatTransport(conn.sshChatTransport ?? "auto");
    const mask = conn.hasApiKey ? makeApiKeyMask(conn.apiKeyLength) : "";
    setConnApiKeyMask(mask);
    setConnApiKey(mask);
    setSshHost(conn.ssh?.host || "");
    setSshPort(conn.ssh?.port ? String(conn.ssh.port) : "");
    setSshUser(conn.ssh?.username || "");
    setSshKeyPath(conn.ssh?.keyPath || "");
    setSshRemotePort(conn.ssh?.remotePort ? String(conn.ssh.remotePort) : "");
    setSshLocalPort(conn.ssh?.localPort ? String(conn.ssh.localPort) : "");
    setSshDockerContainer(conn.ssh?.dockerContainerName || "");
    setApiServerKeyMissing(!keyStatus.hasKey);
    setAutoUpgradeEnabled(autoUpgrade);
    connLoaded.current = true;

    if (conn.mode === "remote" && conn.remoteUrl.trim()) {
      try {
        const detected = await window.hermesAPI.probeRemoteAuthMode(
          conn.remoteUrl,
        );
        if (requestId !== loadConfigRequestRef.current) return;
        setRemoteAuthMode(detected.authMode);
        if (detected.authMode === "oauth") {
          const state = await window.hermesAPI.remoteOAuthSessionState();
          if (requestId !== loadConfigRequestRef.current) return;
          setRemoteOAuthSignedIn(state.signedIn);
        } else {
          setRemoteOAuthSignedIn(false);
        }
      } catch {
        if (requestId !== loadConfigRequestRef.current) return;
        setRemoteOAuthSignedIn(false);
      }
    } else {
      setRemoteOAuthSignedIn(false);
    }

    const homeResult = await Promise.resolve()
      .then(() => window.hermesAPI.getHermesHome(profile))
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
    const versionResult = await Promise.resolve()
      .then(() => window.hermesAPI.getHermesVersion())
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );

    if (requestId !== loadConfigRequestRef.current) return;

    setHermesHome(homeResult.status === "fulfilled" ? homeResult.value : "");
    const version =
      versionResult.status === "fulfilled" ? versionResult.value : null;
    setHermesVersion(version);
    if (version) setCachedVersion(cacheKey, version);

    // Load network settings from config.yaml
    window.hermesAPI.getConfig("network.force_ipv4", profile).then((v) => {
      setForceIpv4(v === "true" || v === "True");
    });
    window.hermesAPI.getConfig("network.proxy", profile).then((v) => {
      const loadedProxy = v || "";
      setHttpProxy(loadedProxy);
      httpProxyRef.current = loadedProxy;
      savedHttpProxyRef.current = loadedProxy.trim();
    });

    if (localStorage.getItem("hermes-openclaw-dismissed") !== "true") {
      window.hermesAPI.checkOpenClaw().then((claw) => {
        setOpenclawFound(claw.found);
        setOpenclawPath(claw.path);
        try {
          localStorage.setItem("hermes-openclaw-cache", JSON.stringify(claw));
        } catch {
          /* ignore */
        }
      });
    }
  }, [profile]);

  useEffect(() => {
    void Promise.resolve().then(loadConfig);
  }, [loadConfig]);

  useEffect(() => {
    const unsubscribe = window.hermesAPI.onConnectionConfigChanged(() => {
      void loadConfig();
    });
    return unsubscribe;
  }, [loadConfig]);

  // Track desktop-app update lifecycle events (the same ones the sidebar-footer
  // upgrade button listens to) so the About pane reflects live progress.
  useEffect(() => {
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setDesktopUpdateState("available");
      setDesktopUpdateVersion(info.version);
      setDesktopUpdateError(null);
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => {
        setDesktopUpdateState("downloading");
        setDesktopUpdatePercent(info.percent);
        setDesktopUpdateError(null);
      },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setDesktopUpdateState("ready");
      setDesktopUpdatePercent(null);
      setDesktopUpdateError(null);
    });
    const cleanupError = window.hermesAPI.onUpdateError((message) => {
      setDesktopUpdateState("error");
      setDesktopUpdateError(message);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function checkDesktopUpdate(): Promise<void> {
    setDesktopUpdateState("checking");
    setDesktopUpdateError(null);
    try {
      const version = await window.hermesAPI.checkForUpdates();
      if (version) {
        setDesktopUpdateState("available");
        setDesktopUpdateVersion(version);
      } else {
        setDesktopUpdateState("uptodate");
      }
    } catch (err) {
      setDesktopUpdateState("error");
      setDesktopUpdateError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDesktopUpdate(): Promise<void> {
    if (desktopUpdateState === "ready") {
      await window.hermesAPI.installUpdate();
      return;
    }
    // "available" or "error" → (re)start the download. Set downloading state
    // immediately to block re-entrancy; `onUpdateDownloaded` flips to "ready".
    setDesktopUpdateState("downloading");
    setDesktopUpdatePercent(null);
    setDesktopUpdateError(null);
    try {
      const ok = await window.hermesAPI.downloadUpdate();
      if (!ok) setDesktopUpdateState("error");
    } catch (err) {
      setDesktopUpdateError(err instanceof Error ? err.message : String(err));
      setDesktopUpdateState("error");
    }
  }

  const saveHttpProxy = useCallback(async (): Promise<void> => {
    const trimmed = httpProxyRef.current.trim();
    if (trimmed === savedHttpProxyRef.current) return;
    await window.hermesAPI.setConfig("network.proxy", trimmed, profile);
    savedHttpProxyRef.current = trimmed;
    setNetworkSaved(true);
    setTimeout(() => setNetworkSaved(false), 2000);
  }, [profile]);

  useEffect(() => {
    httpProxyRef.current = httpProxy;
  }, [httpProxy]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void saveHttpProxy();
    }, 500);
    return () => clearTimeout(timer);
  }, [httpProxy, saveHttpProxy]);

  useEffect(() => {
    return () => {
      void saveHttpProxy();
    };
  }, [saveHttpProxy]);

  async function handleMigrate(): Promise<void> {
    setMigrating(true);
    setMigrationLog("");
    setMigrationResult(null);

    const cleanup = window.hermesAPI.onInstallProgress((p) => {
      setMigrationLog(p.log);
    });

    try {
      const result = await window.hermesAPI.runClawMigrate();
      cleanup();
      if (result.success) {
        setMigrationResult(t("settings.migrationComplete"));
        setMigrationResultType("success");
        setOpenclawFound(false);
      } else {
        setMigrationResult(result.error || t("settings.migrationFailed"));
        setMigrationResultType("error");
      }
    } catch (err) {
      cleanup();
      setMigrationResult(
        (err as Error).message || t("settings.migrationFailed"),
      );
      setMigrationResultType("error");
    }
    setMigrating(false);
  }

  function handleDismissMigration(): void {
    localStorage.setItem("hermes-openclaw-dismissed", "true");
    setMigrationDismissed(true);
  }

  function getConnectionApiKeyForSave(): string | undefined {
    // Mask sentinel in the field means "the secret is still server-side
    // and the user hasn't touched it" — always preserve the stored key.
    // The old code wiped the key whenever the URL changed, so a one-
    // character URL edit (fix typo, add /v1) silently dropped the saved
    // credential. To clear the key, the user must explicitly erase the
    // field.
    if (connHasApiKey && connApiKey === connApiKeyMask) {
      return undefined;
    }
    return connApiKey.trim();
  }

  async function saveSshConnectionMode(): Promise<void> {
    await window.hermesAPI.setSshConfig(
      sshHost.trim(),
      parseInt(sshPort, 10) || 22,
      sshUser.trim(),
      sshKeyPath.trim(),
      parseInt(sshRemotePort, 10) || 8642,
      parseInt(sshLocalPort, 10) || 18642,
      sshDockerContainer.trim(),
    );
  }

  const refreshTransportProbe = useCallback(async (): Promise<void> => {
    if (connMode === "local") {
      setTransportProbe(null);
      return;
    }
    const preference =
      connMode === "ssh" ? sshChatTransport : remoteChatTransport;
    if (preference === "legacy") {
      setTransportProbe({
        label: "Active: Legacy",
        detail:
          connMode === "ssh"
            ? "Dashboard over SSH is disabled."
            : "Dashboard WebSocket is disabled.",
        kind: "muted",
        loading: false,
      });
      return;
    }

    setTransportProbe((prev) => ({
      label: prev?.label || "Checking transport…",
      detail: prev?.detail || "",
      kind: prev?.kind || "muted",
      loading: true,
    }));

    try {
      const status = await window.hermesAPI.dashboardStatus(profile);
      if (status.running && status.connection?.baseUrl) {
        setTransportProbe({
          label:
            preference === "dashboard"
              ? "Active: Dashboard"
              : "Auto active: Dashboard",
          detail: status.connection.baseUrl,
          kind: "ok",
          loading: false,
        });
        return;
      }
      if (status.needsOAuthLogin) {
        setTransportProbe({
          label: "Sign in required",
          detail: status.error || "Browser authentication is required.",
          kind: "warn",
          loading: false,
        });
        return;
      }
      setTransportProbe({
        label:
          preference === "dashboard"
            ? "Dashboard unavailable"
            : "Auto active: Legacy fallback",
        detail: status.error || "Dashboard transport is not available.",
        kind: "warn",
        loading: false,
      });
    } catch (err) {
      setTransportProbe({
        label:
          preference === "dashboard"
            ? "Dashboard unavailable"
            : "Auto active: Legacy fallback",
        detail: err instanceof Error ? err.message : String(err),
        kind: "warn",
        loading: false,
      });
    }
  }, [connMode, profile, remoteChatTransport, sshChatTransport]);

  useEffect(() => {
    void refreshTransportProbe();
  }, [refreshTransportProbe]);

  async function handleSaveConnection(): Promise<void> {
    if (connMode === "ssh") {
      await saveSshConnectionMode();
    } else {
      const apiKey = getConnectionApiKeyForSave();
      await window.hermesAPI.setConnectionConfig(
        connMode,
        connRemoteUrl,
        apiKey,
      );
      if (apiKey !== undefined) {
        const hasApiKey = apiKey.length > 0;
        setConnHasApiKey(hasApiKey);
        if (hasApiKey) {
          const mask = makeApiKeyMask(apiKey.length);
          setConnApiKeyMask(mask);
          setConnApiKey(mask);
        } else {
          setConnApiKeyMask("");
        }
      }
    }
    await window.hermesAPI.setConnectionChatTransports(
      remoteChatTransport,
      sshChatTransport,
    );
    await loadConfig();
    setConnStatus("Saved");
    setTimeout(() => setConnStatus(null), 2000);
    void refreshTransportProbe();
  }

  async function handleChatTransportChange(
    mode: "remote" | "ssh",
    transport: RemoteChatTransport,
  ): Promise<void> {
    const nextRemote = mode === "remote" ? transport : remoteChatTransport;
    const nextSsh = mode === "ssh" ? transport : sshChatTransport;
    if (mode === "remote") {
      setRemoteChatTransport(transport);
    } else {
      setSshChatTransport(transport);
    }
    await window.hermesAPI.setConnectionChatTransports(nextRemote, nextSsh);
    setConnStatus("Saved");
    setTimeout(() => setConnStatus(null), 2000);
    void refreshTransportProbe();
  }

  async function handleTestConnection(): Promise<void> {
    if (connMode === "ssh") {
      if (!sshHost.trim() || !sshUser.trim()) {
        setConnStatus(t("settings.sshErrorRequiredSimple"));
        return;
      }
      setConnTesting(true);
      setConnStatus(null);
      const ok = await window.hermesAPI.testSshConnection(
        sshHost.trim(),
        parseInt(sshPort, 10) || 22,
        sshUser.trim(),
        sshKeyPath.trim(),
        parseInt(sshRemotePort, 10) || 8642,
      );
      setConnTesting(false);
      setConnStatus(
        ok ? t("settings.sshSuccess") : t("settings.sshErrorFailedSimple"),
      );
    } else {
      const url = connRemoteUrl.trim();
      if (!url) {
        setConnStatus(t("settings.remoteErrorRequiredSimple"));
        return;
      }
      setConnTesting(true);
      setConnStatus(null);
      if (remoteAuthMode === "oauth") {
        await window.hermesAPI.setConnectionConfig(
          "remote",
          url,
          getConnectionApiKeyForSave(),
        );
        const status = await window.hermesAPI.dashboardStatus(profile);
        setConnTesting(false);
        if (status.running) setRemoteOAuthSignedIn(true);
        if (status.needsOAuthLogin) setRemoteOAuthSignedIn(false);
        setConnStatus(
          status.running
            ? t("settings.remoteSuccess")
            : status.error || t("settings.remoteErrorFailedSimple"),
        );
        return;
      }
      const ok = await window.hermesAPI.testRemoteConnection(
        url,
        getConnectionApiKeyForSave(),
      );
      setConnTesting(false);
      setConnStatus(
        ok
          ? t("settings.remoteSuccess")
          : t("settings.remoteErrorFailedSimple"),
      );
    }
  }

  async function handleRemoteOAuthLogin(): Promise<void> {
    const url = connRemoteUrl.trim();
    if (!url) {
      setConnStatus(t("settings.remoteErrorRequiredSimple"));
      return;
    }
    setRemoteOAuthBusy(true);
    setConnStatus(null);
    try {
      await window.hermesAPI.setConnectionConfig(
        "remote",
        url,
        getConnectionApiKeyForSave(),
      );
      await window.hermesAPI.remoteOAuthLogin();
      setRemoteAuthMode("oauth");
      setRemoteOAuthSignedIn(true);
      setConnStatus(t("settings.remoteOAuthLoginSuccess"));
      void refreshTransportProbe();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnStatus(
        /cancel/i.test(message)
          ? t("settings.remoteOAuthCancelled")
          : message || t("settings.remoteOAuthLoginFailed"),
      );
    } finally {
      setRemoteOAuthBusy(false);
    }
  }

  async function handleRemoteOAuthLogout(): Promise<void> {
    setRemoteOAuthBusy(true);
    setConnStatus(null);
    try {
      await window.hermesAPI.remoteOAuthLogout();
      setRemoteOAuthSignedIn(false);
      setConnStatus(t("settings.remoteOAuthLogoutSuccess"));
      void refreshTransportProbe();
    } catch (err) {
      setConnStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoteOAuthBusy(false);
    }
  }

  async function handleSwitchToLocal(): Promise<void> {
    setConnMode("local");
    await window.hermesAPI.setConnectionConfig(
      "local",
      connRemoteUrl.trim(),
      undefined,
    );
    await loadConfig();
    setConnStatus(t("settings.switchedToLocal"));
    setTimeout(() => setConnStatus(null), 2000);
  }

  async function handleSwitchToRemote(): Promise<void> {
    setConnMode("remote");
    if (!connLoaded.current) return;

    const apiKey = getConnectionApiKeyForSave();
    await window.hermesAPI.setConnectionConfig(
      "remote",
      connRemoteUrl.trim(),
      apiKey,
    );
    await window.hermesAPI.setConnectionChatTransports(
      remoteChatTransport,
      sshChatTransport,
    );
    if (apiKey !== undefined) {
      const hasApiKey = apiKey.length > 0;
      setConnHasApiKey(hasApiKey);
      if (hasApiKey) {
        const mask = makeApiKeyMask(apiKey.length);
        setConnApiKeyMask(mask);
        setConnApiKey(mask);
      } else {
        setConnApiKeyMask("");
      }
    }
    await loadConfig();
    setConnStatus("Saved");
    setTimeout(() => setConnStatus(null), 2000);
    void refreshTransportProbe();
  }

  async function handleSwitchToSsh(): Promise<void> {
    setConnMode("ssh");
    if (!connLoaded.current) return;
    await saveSshConnectionMode();
    await window.hermesAPI.setConnectionChatTransports(
      remoteChatTransport,
      sshChatTransport,
    );
    await loadConfig();
    setConnStatus("Saved");
    setTimeout(() => setConnStatus(null), 2000);
    void refreshTransportProbe();
  }

  async function handleBackup(): Promise<void> {
    setBackingUp(true);
    setBackupResult(null);
    const result = await window.hermesAPI.runHermesBackup(profile);
    setBackingUp(false);
    if (result.success) {
      setBackupResult(`Backup created: ${result.path || "success"}`);
    } else {
      setBackupResult(result.error || "Backup failed.");
    }
  }

  async function handleImport(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tar.gz,.tgz,.zip";
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setImportResult(null);
      const filePath = window.hermesAPI.getPathForFile(file);
      const result = await window.hermesAPI.runHermesImport(filePath, profile);
      setImporting(false);
      if (result.success) {
        setImportResult(t("settings.migrationComplete"));
      } else {
        setImportResult(result.error || t("settings.migrationFailed"));
      }
    };
    input.click();
  }

  async function loadLogs(): Promise<void> {
    const result = await window.hermesAPI.readLogs(logFile, 300);
    setLogContent(result.content);
    setLogPath(result.path);
  }

  async function handleDoctor(): Promise<void> {
    setDoctorRunning(true);
    setDoctorOutput(null);
    const output = await window.hermesAPI.runHermesDoctor();
    setDoctorOutput(output);
    setDoctorRunning(false);
  }

  // Helper to fetch fresh version, clear backend cache, and update localStorage
  function refreshVersion(): void {
    const requestId = ++loadConfigRequestRef.current;
    setHermesVersion(null);
    window.hermesAPI
      .getConnectionConfig()
      .then((conn) => {
        const cacheKey = versionCacheKey(conn, profile);
        return window.hermesAPI.refreshHermesVersion().then((version) => ({
          cacheKey,
          version,
        }));
      })
      .then(({ cacheKey, version }) => {
        if (requestId !== loadConfigRequestRef.current) return;
        setHermesVersion(version);
        if (version) setCachedVersion(cacheKey, version);
      });
  }

  async function handleUpdateHermes(): Promise<void> {
    setUpdating(true);
    setUpdateResult(null);
    const result = await window.hermesAPI.runHermesUpdate();
    setUpdating(false);
    if (result.success) {
      setUpdateResult(t("settings.updateSuccess"));
      setUpdateResultType("success");
      refreshVersion();
    } else {
      setUpdateResult(result.error || t("settings.updateFailed"));
      setUpdateResultType("error");
    }
  }

  async function handleAutoUpgradeChange(enabled: boolean): Promise<void> {
    setAutoUpgradeEnabled(enabled);
    await window.hermesAPI.setAutoUpgradeEnabled(enabled);
    setAutoUpgradeSaved(true);
    setTimeout(() => setAutoUpgradeSaved(false), 2000);
  }

  // Parse "Hermes Agent v0.7.0 (2026.4.3) Project: ... Python: 3.11.15 OpenAI SDK: 2.30.0 Update available: ..."
  const parsedVersion = (() => {
    if (!hermesVersion) return null;
    const v = hermesVersion;
    const version = v.match(/v([\d.]+)/)?.[1] || "";
    const date = v.match(/\(([\d.]+)\)/)?.[1] || "";
    const python = v.match(/Python:\s*([\d.]+)/)?.[1] || "";
    const sdk = v.match(/OpenAI SDK:\s*([\d.]+)/)?.[1] || "";
    const updateMatch = v.match(/Update available:\s*(.+?)(?:\s*—|$)/);
    const updateInfo = updateMatch?.[1]?.trim() || null;
    return { version, date, python, sdk, updateInfo };
  })();

  return {
    profile,
    // version / agent
    hermesHome,
    hermesVersion,
    appVersion,
    parsedVersion,
    doctorOutput,
    doctorRunning,
    updating,
    updateResult,
    updateResultType,
    autoUpgradeEnabled,
    autoUpgradeSaved,
    dumpOutput,
    dumpRunning,
    setDumpOutput,
    setDumpRunning,
    handleUpdateHermes,
    handleDoctor,
    handleAutoUpgradeChange,
    // desktop app (Electron) update — separate channel from the engine update
    desktopUpdateState,
    desktopUpdateVersion,
    desktopUpdatePercent,
    desktopUpdateError,
    checkDesktopUpdate,
    handleDesktopUpdate,
    // migration / community
    openclawFound,
    openclawPath,
    migrationDismissed,
    migrating,
    migrationLog,
    migrationResult,
    migrationResultType,
    migrationLogRef,
    handleMigrate,
    handleDismissMigration,
    // connection
    connMode,
    setConnMode,
    connRemoteUrl,
    setConnRemoteUrl,
    connApiKey,
    setConnApiKey,
    connApiKeyMask,
    remoteAuthMode,
    setRemoteAuthMode,
    remoteOAuthSignedIn,
    remoteOAuthBusy,
    connTesting,
    connStatus,
    connLoaded,
    apiServerKeyMissing,
    setApiServerKeyMissing,
    generatingKey,
    setGeneratingKey,
    setConnStatus,
    remoteChatTransport,
    sshChatTransport,
    transportProbe,
    handleSaveConnection,
    handleChatTransportChange,
    handleTestConnection,
    handleRemoteOAuthLogin,
    handleRemoteOAuthLogout,
    handleSwitchToLocal,
    handleSwitchToRemote,
    handleSwitchToSsh,
    // ssh
    sshHost,
    setSshHost,
    sshPort,
    setSshPort,
    sshUser,
    setSshUser,
    sshKeyPath,
    setSshKeyPath,
    sshRemotePort,
    setSshRemotePort,
    sshDockerContainer,
    setSshDockerContainer,
    // backup / data
    backingUp,
    backupResult,
    importing,
    importResult,
    handleBackup,
    handleImport,
    // logs
    logContent,
    logFile,
    setLogFile,
    logPath,
    setLogContent,
    setLogPath,
    logsExpanded,
    setLogsExpanded,
    loadLogs,
    // network
    forceIpv4,
    setForceIpv4,
    httpProxy,
    setHttpProxy,
    httpProxyRef,
    saveHttpProxy,
    networkSaved,
    setNetworkSaved,
    // analytics
    analyticsEnabled,
    setAnalyticsEnabled,
  };
}

export type SettingsData = ReturnType<typeof useSettingsData>;
