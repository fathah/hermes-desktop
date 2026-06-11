import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "../../components/ThemeProvider";
import { useFont } from "../../components/FontProvider";
import { THEMES, FONT_OPTIONS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import { APP_LOCALES, type AppLocale } from "../../../../shared/i18n";
import {
  Check,
  ChevronDown,
  Download,
  Upload,
  FileText,
  Send,
} from "lucide-react";
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
} from "../../utils/analytics";
import { ConfigHealth } from "./ConfigHealth";

const DISCORD_COMMUNITY_URL = "https://discord.gg/vMwcnNPHc";
type RemoteChatTransport = "auto" | "dashboard" | "legacy";
const CHAT_TRANSPORT_OPTIONS: RemoteChatTransport[] = [
  "auto",
  "dashboard",
  "legacy",
];
type TransportProbe = {
  detail: string;
  kind: "muted" | "ok" | "warn";
  label: string;
  loading: boolean;
};

const LANGUAGE_NATIVE_NAMES: Record<AppLocale, string> = {
  en: "English",
  es: "Español",
  he: "עברית",
  id: "Bahasa Indonesia",
  ja: "日本語",
  pl: "Polski",
  "pt-BR": "Português (BR)",
  "pt-PT": "Português (PT)",
  tr: "Türkçe",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文（台灣）",
};

// Build a mask string the same width as the stored API key so the
// "saved" state of the input looks like a key, not a constant blob.
// Length is exposed by the main process via PublicConnectionConfig.
// 0 falls back to 8 dots so the user gets a visible "set" indicator
// even if main didn't report a length yet. Capped to keep absurdly
// long keys from blowing up the field.
function makeApiKeyMask(length: number): string {
  const n = Math.min(Math.max(length, 8), 128);
  return "*".repeat(n);
}

type PublicConnectionSnapshot = {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  ssh?: {
    host: string;
    keyPath: string;
    localPort: number;
    port: number;
    remotePort: number;
    username: string;
  };
};

function versionCacheKey(
  conn: PublicConnectionSnapshot,
  profile?: string,
): string {
  const profileKey = profile || "default";
  if (conn.mode === "remote") {
    return `remote:${conn.remoteUrl.trim() || "unset"}:${profileKey}`;
  }
  if (conn.mode === "ssh") {
    const ssh = conn.ssh;
    return [
      "ssh",
      ssh?.username || "",
      ssh?.host || "",
      ssh?.port || "",
      ssh?.remotePort || "",
      ssh?.localPort || "",
      profileKey,
    ].join(":");
  }
  return `local:${profileKey}`;
}

function versionCacheStorageKey(cacheKey: string): string {
  return `hermes-version-cache:${cacheKey}`;
}

function getCachedVersion(cacheKey: string): string | null {
  try {
    return localStorage.getItem(versionCacheStorageKey(cacheKey));
  } catch {
    return null;
  }
}

function setCachedVersion(cacheKey: string, version: string): void {
  try {
    localStorage.setItem(versionCacheStorageKey(cacheKey), version);
  } catch {
    /* ignore */
  }
}

function getCachedOpenClaw(): { found: boolean; path: string | null } | null {
  try {
    const raw = localStorage.getItem("hermes-openclaw-cache");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Settings({ profile }: { profile?: string }): React.JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const [hermesHome, setHermesHome] = useState("");
  const { theme, setTheme, rounded, setRounded } = useTheme();
  const { font, setFont } = useFont();

  const [hermesVersion, setHermesVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [updateResultType, setUpdateResultType] = useState<
    "success" | "error" | null
  >(null);

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
  const [remoteChatTransport, setRemoteChatTransport] =
    useState<RemoteChatTransport>("auto");
  const [sshChatTransport, setSshChatTransport] =
    useState<RemoteChatTransport>("auto");
  const [connTesting, setConnTesting] = useState(false);
  const [connStatus, setConnStatus] = useState<string | null>(null);
  const connLoaded = useRef(false);
  const [apiServerKeyMissing, setApiServerKeyMissing] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [refreshingVault, setRefreshingVault] = useState(false);

  // SSH connection state
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshRemotePort, setSshRemotePort] = useState("");
  const [sshLocalPort, setSshLocalPort] = useState("");
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
  const loadConfigRequestRef = useRef(0);

  const loadConfig = useCallback(async (): Promise<void> => {
    const requestId = ++loadConfigRequestRef.current;
    setHermesHome("");
    setHermesVersion(null);

    // Load fast config first (cached in main process)
    const [aVersion, conn, keyStatus] = await Promise.all([
      window.hermesAPI.getAppVersion(),
      window.hermesAPI.getConnectionConfig(),
      window.hermesAPI.getApiServerKeyStatus(profile),
    ]);

    if (requestId !== loadConfigRequestRef.current) return;

    const cacheKey = versionCacheKey(conn, profile);
    setHermesVersion(getCachedVersion(cacheKey));
    setAppVersion(aVersion);
    setConnMode(conn.mode);
    setConnRemoteUrl(conn.remoteUrl);
    setConnHasApiKey(conn.hasApiKey);
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
    setApiServerKeyMissing(!keyStatus.hasKey);
    connLoaded.current = true;

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

  // 10s polling so vault rotations refresh the warning UI without requiring
  // navigation. Mirrors Gateway.tsx so both screens have the same cadence.
  useEffect(() => {
    const interval = setInterval(() => {
      void loadConfig();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadConfig]);

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

  async function refreshFromVault(): Promise<void> {
    setRefreshingVault(true);
    try {
      await window.hermesAPI.invalidateSecretsCache();
      await loadConfig();
    } catch {
      // fail silently — the 10s poll will catch up
    } finally {
      setRefreshingVault(false);
    }
  }

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

  return (
    <div className="settings-container">
      <h1 className="settings-header">{t("settings.title")}</h1>

      <ConfigHealth />

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.sections.hermesAgent")}
        </div>
        <div className="settings-hermes-info">
          <div className="settings-hermes-row">
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">
                {t("common.engine")}
              </span>
              {hermesVersion === null ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {parsedVersion
                    ? `v${parsedVersion.version}`
                    : t("settings.notDetected")}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">
                {t("common.released")}
              </span>
              {hermesVersion === null ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {parsedVersion?.date || "—"}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">
                {t("common.desktop")}
              </span>
              {!appVersion ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {t("settings.version", { version: appVersion })}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">Python</span>
              {hermesVersion === null ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {parsedVersion?.python || "—"}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">OpenAI SDK</span>
              {hermesVersion === null ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {parsedVersion?.sdk || "—"}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">{t("common.home")}</span>
              {!hermesHome ? (
                <span className="skeleton skeleton-md" />
              ) : (
                <span className="settings-hermes-value settings-hermes-path">
                  {hermesHome}
                </span>
              )}
            </div>
          </div>
          {parsedVersion?.updateInfo && (
            <div className="settings-hermes-update-badge">
              {parsedVersion.updateInfo}
            </div>
          )}
          <div className="settings-hermes-actions">
            {parsedVersion?.updateInfo ? (
              <button
                className="btn btn-primary "
                onClick={handleUpdateHermes}
                disabled={updating}
              >
                {updating ? t("settings.updating") : t("settings.updateEngine")}
              </button>
            ) : (
              <button className="btn btn-secondary" disabled>
                {t("settings.latestVersion")}
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleDoctor}
              disabled={doctorRunning}
            >
              {doctorRunning
                ? t("settings.runningDiagnosis")
                : t("settings.runDiagnosis")}
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                setDumpRunning(true);
                setDumpOutput(null);
                const output = await window.hermesAPI.runHermesDump();
                setDumpOutput(output);
                setDumpRunning(false);
              }}
              disabled={dumpRunning}
            >
              {dumpRunning ? t("settings.running") : t("settings.debugDump")}
            </button>
          </div>
          {updateResult && (
            <div
              className={`settings-hermes-result ${updateResultType || "error"}`}
            >
              {updateResult}
            </div>
          )}
          {doctorOutput && (
            <pre className="settings-hermes-doctor">{doctorOutput}</pre>
          )}
          {dumpOutput && (
            <pre className="settings-hermes-doctor">{dumpOutput}</pre>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.communityTitle")}
        </div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            {t("settings.communityHint")}
          </div>
          <div className="settings-hermes-actions">
            <button
              className="btn btn-secondary"
              onClick={() =>
                window.hermesAPI.openExternal(DISCORD_COMMUNITY_URL)
              }
              title={DISCORD_COMMUNITY_URL}
            >
              <Send size={14} style={{ marginRight: 6 }} />
              {t("settings.joinDiscord")}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.connectionSection")}
          {connStatus && (
            <span className="settings-saved" style={{ marginLeft: 8 }}>
              {connStatus}
            </span>
          )}
        </div>

        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.connectionMode")}
          </label>
          <div className="settings-theme-options">
            <button
              className={`settings-theme-option ${connMode === "local" ? "active" : ""}`}
              onClick={() => {
                setConnMode("local");
                if (connLoaded.current) handleSwitchToLocal();
              }}
            >
              {t("settings.modeLocal")}
            </button>
            <button
              className={`settings-theme-option ${connMode === "remote" ? "active" : ""}`}
              onClick={() => void handleSwitchToRemote()}
            >
              {t("settings.modeRemote")}
            </button>
            <button
              className={`settings-theme-option ${connMode === "ssh" ? "active" : ""}`}
              onClick={() => void handleSwitchToSsh()}
            >
              {t("settings.modeSsh")}
            </button>
          </div>
          <div className="settings-field-hint">
            {connMode === "local"
              ? t("settings.modeLocalHint")
              : connMode === "ssh"
                ? t("settings.modeSshHint")
                : t("settings.modeRemoteHint")}
          </div>
        </div>

        {!apiServerKeyMissing ? null : connMode === "local" ? (
          <div className="settings-api-key-banner">
            <div className="settings-api-key-banner-title">
              {t("settings.sessionDisabledTitle")}
            </div>
            <div className="settings-api-key-banner-desc">
              {t("settings.sessionDisabledDesc")}
            </div>
            <button
              className="btn btn-primary"
              disabled={generatingKey}
              onClick={async () => {
                setGeneratingKey(true);
                await window.hermesAPI.generateApiServerKey(profile);
                setApiServerKeyMissing(false);
                setGeneratingKey(false);
                setConnStatus(t("settings.apiGenerated"));
                setTimeout(() => setConnStatus(null), 4000);
              }}
            >
              {generatingKey
                ? t("settings.generating")
                : t("settings.generateKey")}
            </button>
            <button
              className="btn btn-secondary"
              disabled={refreshingVault}
              onClick={() => void refreshFromVault()}
            >
              {refreshingVault
                ? t("settings.refreshingFromVault")
                : t("settings.refreshFromVault")}
            </button>
          </div>
        ) : (
          <div className="settings-api-key-banner settings-api-key-banner--info">
            <div className="settings-api-key-banner-title">
              {t("settings.remoteEnvTitle")}
            </div>
            <div className="settings-api-key-banner-desc">
              {connMode === "ssh"
                ? t("settings.remoteEnvSshDesc")
                : t("settings.remoteEnvDesc")}
            </div>
          </div>
        )}

        {connMode === "remote" && (
          <>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.remoteUrl")}
              </label>
              <input
                className="input"
                type="url"
                value={connRemoteUrl}
                onChange={(e) => setConnRemoteUrl(e.target.value)}
                placeholder="http://192.168.1.100:8642"
                onBlur={handleSaveConnection}
              />
              <div className="settings-field-hint">
                {t("settings.remoteUrlHint")}
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.remoteApiKey")}
              </label>
              <input
                className="input"
                type="password"
                value={connApiKey}
                onChange={(e) => setConnApiKey(e.target.value)}
                onFocus={(e) => {
                  if (connApiKey === connApiKeyMask) {
                    e.currentTarget.select();
                  }
                }}
                placeholder={t("settings.remoteApiKey")}
                onBlur={handleSaveConnection}
              />
              <div className="settings-field-hint">
                {t("settings.remoteApiKeyHint")}
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-field-label">Chat transport</label>
              <div className="settings-theme-options">
                {CHAT_TRANSPORT_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`settings-theme-option ${
                      remoteChatTransport === option ? "active" : ""
                    }`}
                    onClick={() =>
                      void handleChatTransportChange("remote", option)
                    }
                  >
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
              <div className="settings-field-hint">
                Auto tries the Hermes dashboard WebSocket first, then falls back
                to the legacy remote API. Dashboard requires the remote Hermes
                dashboard URL and a valid dashboard session token.
              </div>
              {transportProbe && (
                <div
                  className={`settings-transport-status settings-transport-status--${transportProbe.kind}`}
                >
                  <span>{transportProbe.label}</span>
                  {transportProbe.loading && <span>Checking…</span>}
                  {transportProbe.detail && (
                    <code>{transportProbe.detail}</code>
                  )}
                </div>
              )}
            </div>
            <div className="settings-hermes-actions">
              <button
                className="btn btn-secondary"
                onClick={handleTestConnection}
                disabled={connTesting}
              >
                {connTesting
                  ? t("settings.testingConnection")
                  : t("settings.testConnection")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveConnection}
              >
                {t("settings.save")}
              </button>
            </div>
          </>
        )}

        {connMode === "ssh" && (
          <>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.sshHost")}
              </label>
              <input
                className="input"
                type="text"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder={t("settings.sshHostPlaceholder")}
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.sshPort")}
              </label>
              <input
                className="input"
                type="number"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
                placeholder="22"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.sshUsername")}
              </label>
              <input
                className="input"
                type="text"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder={t("settings.sshUsernamePlaceholder")}
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.sshKeyPath")}{" "}
                <span style={{ fontWeight: 400, opacity: 0.6 }}>
                  {t("settings.sshKeyPathOptional")}
                </span>
              </label>
              <input
                className="input"
                type="text"
                value={sshKeyPath}
                onChange={(e) => setSshKeyPath(e.target.value)}
                placeholder="~/.ssh/id_rsa"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.sshRemotePort")}{" "}
                <span style={{ fontWeight: 400, opacity: 0.6 }}>
                  {t("settings.sshRemotePortDefault")}
                </span>
              </label>
              <input
                className="input"
                type="number"
                value={sshRemotePort}
                onChange={(e) => setSshRemotePort(e.target.value)}
                placeholder="8642"
              />
              <div className="settings-field-hint">
                {t("settings.sshHint", {
                  cmd: `${sshUser || "user"}@${sshHost || "host"}`,
                })}
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-field-label">Chat transport</label>
              <div className="settings-theme-options">
                {CHAT_TRANSPORT_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`settings-theme-option ${
                      sshChatTransport === option ? "active" : ""
                    }`}
                    onClick={() =>
                      void handleChatTransportChange("ssh", option)
                    }
                  >
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
              <div className="settings-field-hint">
                Auto tries the Hermes dashboard WebSocket through the SSH tunnel
                first, then falls back to legacy SSH chat. Dashboard forces the
                upstream dashboard path; Legacy keeps the older SSH transport.
              </div>
              {transportProbe && (
                <div
                  className={`settings-transport-status settings-transport-status--${transportProbe.kind}`}
                >
                  <span>{transportProbe.label}</span>
                  {transportProbe.loading && <span>Checking…</span>}
                  {transportProbe.detail && (
                    <code>{transportProbe.detail}</code>
                  )}
                </div>
              )}
            </div>
            <div className="settings-hermes-actions">
              <button
                className="btn btn-secondary"
                onClick={handleTestConnection}
                disabled={connTesting}
              >
                {connTesting ? t("settings.testingSsh") : t("settings.testSsh")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveConnection}
              >
                {t("settings.save")}
              </button>
            </div>
          </>
        )}
      </div>

      {openclawFound && !migrationDismissed && (
        <div className="settings-migration-banner">
          <div className="settings-migration-header">
            <div>
              <div className="settings-migration-title">
                {t("settings.migrationDetected")}
              </div>
              <div
                className="settings-migration-desc"
                dangerouslySetInnerHTML={{
                  __html: t("settings.migrationDesc", {
                    path: openclawPath || "",
                  }),
                }}
              />
            </div>
            <button
              className="btn-ghost settings-migration-dismiss"
              onClick={handleDismissMigration}
              title={t("settings.migrationDismiss")}
            >
              &times;
            </button>
          </div>
          {migrationLog && (
            <pre className="settings-hermes-doctor" ref={migrationLogRef}>
              {migrationLog}
            </pre>
          )}
          {migrationResult && (
            <div
              className={`settings-hermes-result ${migrationResultType || "error"}`}
            >
              {migrationResult}
            </div>
          )}
          <div className="settings-migration-actions">
            <button
              className="btn btn-primary "
              onClick={handleMigrate}
              disabled={migrating}
            >
              {migrating
                ? t("settings.migrating")
                : t("settings.migrateToHermes")}
            </button>
            <button
              className="btn btn-secondary "
              onClick={handleDismissMigration}
            >
              {t("settings.skip")}
            </button>
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.sections.appearance")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.theme.label")}
          </label>
          <div className="settings-theme-grid">
            {THEMES.map((th) => {
              const active = theme === th.id;
              return (
                <button
                  key={th.id}
                  type="button"
                  className={`settings-theme-card ${active ? "active" : ""}`}
                  onClick={() => setTheme(th.id)}
                >
                  <div className="settings-theme-preview" data-theme={th.id}>
                    <div className="settings-theme-preview-sidebar" />
                    <div className="settings-theme-preview-main">
                      <div className="settings-theme-preview-bar accent" />
                      <div className="settings-theme-preview-bar text" />
                      <div className="settings-theme-preview-bar" />
                    </div>
                  </div>
                  <div className="settings-theme-card-row">
                    <span className="settings-theme-card-name">{th.name}</span>
                    {active && (
                      <span className="settings-theme-card-check">
                        <Check size={14} />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="settings-field-hint">
            {t("settings.appearanceHint")}
          </div>
        </div>
        <div className="settings-field">
          <div className="settings-theme-system">
            <div>
              <div className="settings-theme-system-label">
                {t("settings.roundedCorners.label")}
              </div>
              <div className="settings-theme-system-hint">
                {t("settings.roundedCorners.hint")}
              </div>
            </div>
            <label
              className="tools-toggle"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={rounded}
                onChange={() => setRounded(!rounded)}
              />
              <span className="tools-toggle-track" />
            </label>
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.font.label")}
          </label>
          <div className="settings-theme-options">
            {FONT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`settings-theme-option ${font === opt.value ? "active" : ""}`}
                style={{ fontFamily: opt.stack }}
                onClick={() => setFont(opt.value)}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
          <div className="settings-field-hint">{t("settings.font.hint")}</div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.language.label")}
          </label>
          <LanguageSelect locale={locale} onSelect={setLocale} />
          <div className="settings-field-hint">
            {t("settings.language.hint")}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.sections.privacy")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.analytics.label")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={analyticsEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setAnalyticsEnabled(enabled);
                  setAnalyticsConsent(enabled);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.analytics.hint")}
          </div>
          <ul
            className="settings-field-hint"
            style={{ paddingLeft: "1.25em", marginTop: 4 }}
          >
            <li>{t("settings.analytics.disclosure.uuid")}</li>
            <li>{t("settings.analytics.disclosure.platform")}</li>
            <li>{t("settings.analytics.disclosure.navigation")}</li>
            <li>{t("settings.analytics.disclosure.endpoint")}</li>
            <li>{t("settings.analytics.disclosure.notCollected")}</li>
          </ul>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.networkSection")}
          {networkSaved && (
            <span className="settings-saved" style={{ marginLeft: 8 }}>
              {t("settings.saved")}
            </span>
          )}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.forceIpv4")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={forceIpv4}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setForceIpv4(val);
                  await window.hermesAPI.setConfig(
                    "network.force_ipv4",
                    val ? "true" : "false",
                    profile,
                  );
                  setNetworkSaved(true);
                  setTimeout(() => setNetworkSaved(false), 2000);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.forceIpv4Hint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.httpProxy")}
          </label>
          <input
            className="input"
            type="text"
            value={httpProxy}
            onChange={(e) => {
              httpProxyRef.current = e.target.value;
              setHttpProxy(e.target.value);
            }}
            onBlur={() => {
              void saveHttpProxy();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveHttpProxy();
                e.currentTarget.blur();
              }
            }}
            placeholder={t("settings.proxyPlaceholder")}
          />
          <div className="settings-field-hint">
            {t("settings.httpProxyHint")}
          </div>
        </div>
      </div>

      {connMode === "remote" && (
        <div className="settings-section">
          <div className="settings-section-title">
            {t("settings.serverConfigTitle")}
          </div>
          <div
            className="settings-field-hint"
            dangerouslySetInnerHTML={{ __html: t("settings.serverConfigHint") }}
          />
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.dataSection")}
        </div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            {t("settings.dataHint")}
          </div>
          <div className="settings-hermes-actions">
            <button
              className="btn btn-secondary"
              onClick={handleBackup}
              disabled={backingUp}
            >
              <Download size={14} style={{ marginRight: 6 }} />
              {backingUp ? t("settings.backingUp") : t("settings.exportBackup")}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleImport}
              disabled={importing}
            >
              <Upload size={14} style={{ marginRight: 6 }} />
              {importing ? t("settings.importing") : t("settings.importBackup")}
            </button>
          </div>
          {backupResult && (
            <div
              className={`settings-hermes-result ${backupResult.includes("created") || backupResult.includes("success") ? "success" : "error"}`}
              style={{ marginTop: 8 }}
            >
              {backupResult}
            </div>
          )}
          {importResult && (
            <div
              className={`settings-hermes-result ${importResult.includes("complete") ? "success" : "error"}`}
              style={{ marginTop: 8 }}
            >
              {importResult}
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          <span
            style={{ cursor: "pointer" }}
            onClick={() => {
              const next = !logsExpanded;
              setLogsExpanded(next);
              if (next) loadLogs();
            }}
          >
            <FileText
              size={14}
              style={{ marginRight: 6, verticalAlign: "middle" }}
            />
            {t("settings.logsSection")} {logsExpanded ? "▾" : "▸"}
          </span>
        </div>
        {logsExpanded && (
          <div className="settings-field">
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {["gateway.log", "agent.log", "errors.log"].map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm ${logFile === f ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => {
                    setLogFile(f);
                    window.hermesAPI.readLogs(f, 300).then((r) => {
                      setLogContent(r.content);
                      setLogPath(r.path);
                    });
                  }}
                >
                  {f.replace(".log", "")}
                </button>
              ))}
              <button className="btn btn-sm btn-secondary" onClick={loadLogs}>
                {t("settings.refresh")}
              </button>
            </div>
            {logPath && (
              <div className="settings-field-hint" style={{ marginBottom: 4 }}>
                {logPath}
              </div>
            )}
            <pre
              className="settings-hermes-doctor"
              style={{
                maxHeight: 300,
                overflow: "auto",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {logContent || t("settings.emptyLog")}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function LanguageSelect({
  locale,
  onSelect,
}: {
  locale: AppLocale;
  onSelect: (l: AppLocale) => void;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  return (
    <div className="settings-language-select" ref={ref}>
      <button
        type="button"
        className="settings-language-trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{LANGUAGE_NATIVE_NAMES[locale]}</span>
        <ChevronDown size={14} />
      </button>
      {isOpen && (
        <div className="settings-language-dropdown" role="listbox">
          {APP_LOCALES.map((l) => {
            const active = l === locale;
            return (
              <button
                key={l}
                type="button"
                role="option"
                aria-selected={active}
                className={`settings-language-option ${active ? "active" : ""}`}
                onClick={() => {
                  onSelect(l);
                  setIsOpen(false);
                }}
              >
                <span>{LANGUAGE_NATIVE_NAMES[l]}</span>
                {active && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Settings;
