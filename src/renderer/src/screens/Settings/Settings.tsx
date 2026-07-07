import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "../../components/ThemeProvider";
import { THEME_OPTIONS } from "../../constants";
import { useStore as useSpsStore } from "../SpsAgent/store";
import { useI18n } from "../../components/useI18n";
import {
  APP_ZOOM_DEFAULT,
  appZoomSettingsFor,
  type AppZoomSettings,
} from "../../../../shared/app-zoom";
import {
  DEFAULT_OWNER_NOTIFICATION_PREFS,
  OWNER_NOTIFICATION_EVENTS,
  type OwnerNotificationPrefs,
  type OwnerNotificationPrefsPatch,
} from "../../../../shared/owner-notifications";
import {
  Check,
  Download,
  Upload,
  FileText,
  RefreshCw,
  Send,
} from "lucide-react";
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
} from "../../utils/analytics";
import { ConfigHealth } from "./ConfigHealth";
import CapabilitySummary from "./CapabilitySummary";
import McpServersManager from "./McpServersManager";
import ResearchReachSummary from "./ResearchReachSummary";
import WorkspaceBackups from "./WorkspaceBackups";
import Diagnostics from "./Diagnostics";
import { HealthSurface } from "../SpsAgent/health/HealthSurface";
import { getDevMode, setDevMode } from "../../lib/devMode";
import type { SettingsSection } from "./settingsSections";
import { SETTINGS_SECTION_COPY } from "./settingsSections";

const TELEGRAM_COMMUNITY_URL = "https://t.me/hermes_agent_desktop";

type DesktopUpdateRoutineState = Awaited<
  ReturnType<Window["hermesAPI"]["getDesktopUpdateRoutine"]>
>;
type DesktopUpdateRoutineResult = NonNullable<
  DesktopUpdateRoutineState["lastResult"]
>;

const OWNER_EVENT_LABELS: Record<
  (typeof OWNER_NOTIFICATION_EVENTS)[number],
  string
> = {
  brief: "Briefs",
  nag: "Nags",
  alert: "Alerts",
  update: "Updates",
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

// Read cached values from localStorage for instant display
function getCachedVersion(): string | null {
  try {
    return localStorage.getItem("hermes-version-cache");
  } catch {
    return null;
  }
}

function formatRoutineDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function Settings({
  profile,
  section,
}: {
  profile?: string;
  section: SettingsSection;
}): React.JSX.Element {
  const { t } = useI18n();
  const sectionCopy = SETTINGS_SECTION_COPY[section];
  const [devModeOn, setDevModeOn] = useState(getDevMode());
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [section]);
  const [hermesHome, setHermesHome] = useState("");
  const { theme, setTheme } = useTheme();
  const [healthExpanded, setHealthExpanded] = useState(false);

  // Hermes engine info — initialize from localStorage cache for instant display
  const [hermesVersion, setHermesVersion] = useState<string | null>(
    getCachedVersion,
  );
  const [appVersion, setAppVersion] = useState("");
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [updateResultType, setUpdateResultType] = useState<
    "success" | "error" | null
  >(null);
  const [desktopUpdateRoutine, setDesktopUpdateRoutineState] =
    useState<DesktopUpdateRoutineState | null>(null);
  const [desktopUpdateRunning, setDesktopUpdateRunning] = useState(false);
  const [desktopUpdateError, setDesktopUpdateError] = useState<string | null>(
    null,
  );

  // Connection mode
  const [connMode, setConnMode] = useState<"local" | "remote" | "ssh">("local");
  const [connRemoteUrl, setConnRemoteUrl] = useState("");
  const [connApiKey, setConnApiKey] = useState("");
  const [connApiKeyMask, setConnApiKeyMask] = useState("");
  const [connHasApiKey, setConnHasApiKey] = useState(false);
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
  const [networkSaved, setNetworkSaved] = useState(false);

  // Debug dump
  const [dumpOutput, setDumpOutput] = useState<string | null>(null);
  const [dumpRunning, setDumpRunning] = useState(false);

  // Analytics consent
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() =>
    getAnalyticsConsent(),
  );

  // Automation prefs (M2): scoped auto-approve + completion chime
  const [autoApprove, setAutoApproveState] = useState(false);
  const [completionSound, setCompletionSoundState] = useState(false);
  const [ownerNotifications, setOwnerNotifications] =
    useState<OwnerNotificationPrefs>(DEFAULT_OWNER_NOTIFICATION_PREFS);
  const [appZoom, setAppZoom] = useState<AppZoomSettings>(() =>
    appZoomSettingsFor(APP_ZOOM_DEFAULT),
  );
  const [appZoomSaving, setAppZoomSaving] = useState(false);
  // Approval auto-deny timeout (seconds; 0 = off). Opt-in operator safety.
  const [approvalTimeout, setApprovalTimeout] = useState("0");

  // Prompt budget & Security states
  interface PromptSizeBreakdown {
    total?: number;
    limit?: number;
    breakdown?: Record<string, number>;
    [key: string]: number | Record<string, number> | undefined;
  }
  const [promptSize, setPromptSize] = useState<PromptSizeBreakdown | null>(
    null,
  );
  const [promptSizeLoading, setPromptSizeLoading] = useState(false);
  const [securityRunning, setSecurityRunning] = useState(false);
  const [securityOutput, setSecurityOutput] = useState<string | null>(null);

  const loadPromptSize = useCallback(async (): Promise<void> => {
    setPromptSizeLoading(true);
    try {
      const breakdownStr =
        await window.hermesAPI.getPromptSizeBreakdown(profile);
      const data = JSON.parse(breakdownStr) as PromptSizeBreakdown;
      setPromptSize(data);
    } catch (err) {
      console.error("Failed to parse prompt budget size breakdown:", err);
    } finally {
      setPromptSizeLoading(false);
    }
  }, [profile]);

  const loadConfig = useCallback(async (): Promise<void> => {
    // Load fast config first (cached in main process)
    const [
      home,
      aVersion,
      conn,
      keyStatus,
      zoomSettings,
      desktopRoutine,
      ownerNotificationPrefs,
    ] = await Promise.all([
      window.hermesAPI.getHermesHome(profile),
      window.hermesAPI.getAppVersion(),
      window.hermesAPI.getConnectionConfig(),
      window.hermesAPI.getApiServerKeyStatus(profile),
      window.hermesAPI.getAppZoomSettings(),
      window.hermesAPI.getDesktopUpdateRoutine(),
      window.hermesAPI.getOwnerNotificationPrefs(profile),
    ]);
    setHermesHome(home);
    setAppVersion(aVersion);
    setDesktopUpdateRoutineState(desktopRoutine);
    setAppZoom(zoomSettings);
    setOwnerNotifications(ownerNotificationPrefs);
    setConnMode(conn.mode);
    setConnRemoteUrl(conn.remoteUrl);
    setConnHasApiKey(conn.hasApiKey);
    const mask = conn.hasApiKey ? makeApiKeyMask(conn.apiKeyLength) : "";
    setConnApiKeyMask(mask);
    setConnApiKey(mask);
    setSshHost(conn.ssh?.host || "");
    setSshPort(conn.ssh?.port ? String(conn.ssh.port) : "");
    setSshUser(conn.ssh?.username || "");
    setSshKeyPath(conn.ssh?.keyPath || "");
    setSshRemotePort(conn.ssh?.remotePort ? String(conn.ssh.remotePort) : "");
    setApiServerKeyMissing(!keyStatus.hasKey);
    connLoaded.current = true;

    // Automation prefs (auto-approve is per-profile; chime is app-level)
    window.hermesAPI.getAutoApprove(profile).then(setAutoApproveState);
    window.hermesAPI.getCompletionSound().then(setCompletionSoundState);
    window.hermesAPI
      .getConfig("approval.timeout_seconds", profile)
      .then((v) => setApprovalTimeout(String(parseInt(v || "0", 10) || 0)));

    // Load network settings from config.yaml
    window.hermesAPI.getConfig("network.force_ipv4", profile).then((v) => {
      setForceIpv4(v === "true" || v === "True");
    });
    window.hermesAPI.getConfig("network.proxy", profile).then((v) => {
      setHttpProxy(v || "");
    });

    // Defer slow calls — background refresh, cached values show instantly
    window.hermesAPI.getHermesVersion().then((v) => {
      setHermesVersion(v);
      if (v) {
        try {
          localStorage.setItem("hermes-version-cache", v);
        } catch {
          /* ignore */
        }
      }
    });

    loadPromptSize();
  }, [profile, loadPromptSize]);

  useEffect(() => {
    void Promise.resolve().then(loadConfig);
  }, [loadConfig]);

  useEffect(() => {
    return window.hermesAPI.onAppZoomSettingsChanged(setAppZoom);
  }, []);

  const updateAppZoom = useCallback(async (factor: number): Promise<void> => {
    const optimistic = appZoomSettingsFor(factor);
    setAppZoom(optimistic);
    setAppZoomSaving(true);
    try {
      const settings = await window.hermesAPI.setAppZoomFactor(
        optimistic.factor,
      );
      setAppZoom(settings);
    } catch (err) {
      console.error("Failed to update app zoom:", err);
      setAppZoom(await window.hermesAPI.getAppZoomSettings());
    } finally {
      setAppZoomSaving(false);
    }
  }, []);

  const updateOwnerNotifications = useCallback(
    async (patch: OwnerNotificationPrefsPatch): Promise<void> => {
      setOwnerNotifications((current) => ({
        ...current,
        channels: { ...current.channels, ...patch.channels },
        events: { ...current.events, ...patch.events },
        targets: { ...current.targets, ...patch.targets },
        quietHours: { ...current.quietHours, ...patch.quietHours },
        rateLimitMinutes:
          patch.rateLimitMinutes !== undefined
            ? patch.rateLimitMinutes
            : current.rateLimitMinutes,
      }));
      try {
        setOwnerNotifications(
          await window.hermesAPI.setOwnerNotificationPrefs(patch, profile),
        );
      } catch (err) {
        console.error("Failed to update owner notification prefs:", err);
        setOwnerNotifications(
          await window.hermesAPI.getOwnerNotificationPrefs(profile),
        );
      }
    },
    [profile],
  );

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

  async function handleSaveConnection(): Promise<void> {
    if (connMode === "ssh") {
      await window.hermesAPI.setSshConfig(
        sshHost.trim(),
        parseInt(sshPort, 10) || 22,
        sshUser.trim(),
        sshKeyPath.trim(),
        parseInt(sshRemotePort, 10) || 8642,
        18642,
      );
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
    setConnStatus("Saved");
    setTimeout(() => setConnStatus(null), 2000);
  }

  async function handleTestConnection(): Promise<void> {
    if (connMode === "ssh") {
      if (!sshHost.trim() || !sshUser.trim()) {
        setConnStatus("Host and username are required");
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
      setConnStatus(ok ? "SSH tunnel connected!" : "Could not connect via SSH");
    } else {
      const url = connRemoteUrl.trim();
      if (!url) {
        setConnStatus("Please enter a URL");
        return;
      }
      setConnTesting(true);
      setConnStatus(null);
      const ok = await window.hermesAPI.testRemoteConnection(
        url,
        getConnectionApiKeyForSave(),
      );
      setConnTesting(false);
      setConnStatus(ok ? "Connected successfully!" : "Could not reach server");
    }
  }

  async function handleSwitchToLocal(): Promise<void> {
    setConnMode("local");
    setConnRemoteUrl("");
    setConnApiKey("");
    setConnApiKeyMask("");
    setConnHasApiKey(false);
    await window.hermesAPI.setConnectionConfig("local", "", "");
    setConnStatus(t("settings.switchedToLocal"));
    setTimeout(() => setConnStatus(null), 2000);
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
      const filePath = (file as File & { path: string }).path;
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
    window.hermesAPI.refreshHermesVersion().then((v) => {
      setHermesVersion(v);
      if (v) {
        try {
          localStorage.setItem("hermes-version-cache", v);
        } catch {
          /* ignore */
        }
      }
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

  async function handleDesktopUpdateSetting(
    settings: Partial<{ enabled: boolean; autoDownload: boolean }>,
  ): Promise<void> {
    setDesktopUpdateError(null);
    try {
      const updated = await window.hermesAPI.setDesktopUpdateRoutine(settings);
      setDesktopUpdateRoutineState(updated);
    } catch (err) {
      setDesktopUpdateError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRunDesktopUpdateCheck(): Promise<void> {
    setDesktopUpdateRunning(true);
    setDesktopUpdateError(null);
    try {
      const result = await window.hermesAPI.runDesktopUpdateCheck();
      setDesktopUpdateRoutineState(
        await window.hermesAPI.getDesktopUpdateRoutine(),
      );
      if (result.status === "error") {
        setDesktopUpdateError(result.message);
      }
    } catch (err) {
      setDesktopUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setDesktopUpdateRunning(false);
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
  const desktopLastResult: DesktopUpdateRoutineResult | null =
    desktopUpdateRoutine?.lastResult ?? null;

  return (
    <div
      className="settings-container"
      data-section={section}
      ref={containerRef}
    >
      <h1 className="settings-header">{sectionCopy.title}</h1>
      <p className="models-subtitle settings-section-subtitle">
        {sectionCopy.subtitle}
      </p>

      <div data-section-tab="troubleshooting">
        <ConfigHealth />
      </div>

      <div className="settings-section" data-section-tab="troubleshooting">
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

      <div className="settings-section" data-section-tab="troubleshooting">
        <div className="settings-section-title">
          {t("settings.desktopUpdates.title")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.desktopUpdates.nightlyCheck")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={desktopUpdateRoutine?.enabled ?? true}
                onChange={(e) =>
                  void handleDesktopUpdateSetting({
                    enabled: e.target.checked,
                  })
                }
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.desktopUpdates.nightlyCheckHint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.desktopUpdates.autoDownload")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={desktopUpdateRoutine?.autoDownload ?? false}
                onChange={(e) =>
                  void handleDesktopUpdateSetting({
                    autoDownload: e.target.checked,
                  })
                }
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.desktopUpdates.autoDownloadHint")}
          </div>
        </div>
        <div className="settings-hermes-row">
          <div className="settings-hermes-detail">
            <span className="settings-hermes-label">
              {t("settings.desktopUpdates.schedule")}
            </span>
            <span className="settings-hermes-value">
              {desktopUpdateRoutine?.schedule || "0 4 * * *"}
            </span>
          </div>
          <div className="settings-hermes-detail">
            <span className="settings-hermes-label">
              {t("settings.desktopUpdates.lastChecked")}
            </span>
            <span className="settings-hermes-value">
              {formatRoutineDate(desktopUpdateRoutine?.lastCheckedAt)}
            </span>
          </div>
          <div className="settings-hermes-detail">
            <span className="settings-hermes-label">
              {t("settings.desktopUpdates.nextCheck")}
            </span>
            <span className="settings-hermes-value">
              {formatRoutineDate(desktopUpdateRoutine?.nextCheckAt)}
            </span>
          </div>
          <div className="settings-hermes-detail">
            <span className="settings-hermes-label">
              {t("settings.desktopUpdates.lastStatus")}
            </span>
            <span className="settings-hermes-value">
              {desktopLastResult
                ? `${desktopLastResult.status}${
                    desktopLastResult.version
                      ? ` · v${desktopLastResult.version}`
                      : ""
                  }`
                : t("settings.desktopUpdates.unavailable")}
            </span>
          </div>
        </div>
        {desktopLastResult?.message && (
          <div className="settings-field-hint" style={{ marginTop: 10 }}>
            {desktopLastResult.message}
          </div>
        )}
        <div className="settings-hermes-actions" style={{ marginTop: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={() => void handleRunDesktopUpdateCheck()}
            disabled={desktopUpdateRunning}
          >
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            {desktopUpdateRunning
              ? t("settings.desktopUpdates.running")
              : t("settings.desktopUpdates.runNow")}
          </button>
        </div>
        {desktopUpdateError && (
          <div className="settings-hermes-result error">
            {desktopUpdateError}
          </div>
        )}
      </div>

      {/* Prompt Budget Visualizer Section */}
      <div className="settings-section" data-section-tab="troubleshooting">
        <div className="settings-section-title">Context Window</div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 12 }}>
            This visualizer shows the token usage budget for My Assistant&apos;s
            profile context window. If the prompt exceeds the model&apos;s
            budget, some memory or history may be truncated.
          </div>
          {promptSizeLoading ? (
            <div className="settings-loading prompt-budget-loading">
              <div className="loading-spinner prompt-budget-spinner" />
              <span className="settings-field-hint">
                Loading prompt size breakdown...
              </span>
            </div>
          ) : promptSize ? (
            (() => {
              const total = promptSize.total || 0;
              const limit = promptSize.limit || 8192;
              const percent = Math.min(Math.round((total / limit) * 100), 100);

              // Build breakdown items
              const breakdown: Record<string, number> = {};
              const src = promptSize.breakdown || promptSize;
              for (const [key, val] of Object.entries(src)) {
                if (
                  key !== "total" &&
                  key !== "limit" &&
                  key !== "breakdown" &&
                  typeof val === "number"
                ) {
                  breakdown[key] = val;
                }
              }

              return (
                <div>
                  <div className="prompt-budget-header">
                    <span>
                      Usage: {total.toLocaleString()} / {limit.toLocaleString()}{" "}
                      tokens
                    </span>
                    <span>{percent}%</span>
                  </div>
                  {/* Progress bar */}
                  <div className="prompt-budget-progress-track">
                    <div
                      className={`prompt-budget-progress-bar ${
                        percent > 90
                          ? "bar-danger"
                          : percent > 75
                            ? "bar-warning"
                            : "bar-success"
                      }`}
                      style={{
                        width: `${percent}%`,
                      }}
                    />
                  </div>
                  {/* Breakdown list */}
                  {Object.keys(breakdown).length > 0 ? (
                    <div className="prompt-budget-grid">
                      {Object.entries(breakdown).map(([key, val]) => {
                        const itemPercent =
                          limit > 0 ? Math.round((val / limit) * 100) : 0;
                        return (
                          <div key={key} className="prompt-budget-card">
                            <div className="prompt-budget-card-title">
                              {key.replace(/_/g, " ")}
                            </div>
                            <div className="prompt-budget-card-value">
                              {val.toLocaleString()}{" "}
                              <span className="prompt-budget-card-percent">
                                ({itemPercent}%)
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="settings-field-hint">
                      No breakdown available.
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="settings-field-hint">
                No prompt budget data loaded.
              </span>
              <button className="btn btn-secondary" onClick={loadPromptSize}>
                Reload
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Vault Health Section */}
      <div className="settings-section" data-section-tab="dataPrivacy">
        <div className="settings-section-title">
          <span
            style={{
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
            onClick={() => setHealthExpanded(!healthExpanded)}
          >
            <Check size={14} style={{ marginRight: 6 }} />
            Vault Health {healthExpanded ? "▾" : "▸"}
          </span>
        </div>
        {healthExpanded && (
          <div
            className="settings-field"
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 16,
              marginTop: 12,
            }}
          >
            <HealthSurface profile={profile} embedded={true} />
          </div>
        )}
      </div>

      {/* Workspace Backups Section (MED-11) */}
      <WorkspaceBackups profile={profile} />

      {/* Diagnostics Section (MED-10) */}
      <Diagnostics />

      {/* Security Audit Section */}
      <div className="settings-section" data-section-tab="troubleshooting">
        <div className="settings-section-title">Dependency Security Scan</div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 12 }}>
            Scan local package locks and skill dependencies against the OSV.dev
            database to identify known vulnerabilities.
          </div>
          <div
            className="settings-hermes-actions"
            style={{ marginBottom: securityOutput ? 12 : 0 }}
          >
            <button
              className="btn btn-secondary"
              onClick={async () => {
                setSecurityRunning(true);
                setSecurityOutput(null);
                try {
                  const output =
                    await window.hermesAPI.runSecurityAudit(profile);
                  setSecurityOutput(output);
                } catch (err) {
                  setSecurityOutput(
                    "Error running security audit: " + (err as Error).message,
                  );
                } finally {
                  setSecurityRunning(false);
                }
              }}
              disabled={securityRunning}
            >
              {securityRunning
                ? "Scanning Dependencies..."
                : "Run Security Scan"}
            </button>
          </div>
          {securityOutput && (
            <pre
              className="settings-hermes-doctor"
              style={{ maxHeight: 300, overflowY: "auto", fontSize: 12 }}
            >
              {securityOutput}
            </pre>
          )}
        </div>
      </div>

      <CapabilitySummary
        profile={profile}
        active={section === "troubleshooting"}
        sectionTab="troubleshooting"
      />
      <McpServersManager
        profile={profile}
        active={section === "troubleshooting"}
        sectionTab="troubleshooting"
      />
      <ResearchReachSummary
        profile={profile}
        active={section === "troubleshooting"}
        sectionTab="troubleshooting"
      />

      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">Community</div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            Join our Telegram group to ask questions, report issues, and chat
            with other Hermes users.
          </div>
          <div className="settings-hermes-actions">
            <button
              className="btn btn-secondary"
              onClick={() =>
                window.hermesAPI.openExternal(TELEGRAM_COMMUNITY_URL)
              }
              title={TELEGRAM_COMMUNITY_URL}
            >
              <Send size={14} style={{ marginRight: 6 }} />
              Join Telegram Community
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section" data-section-tab="advanced">
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
              onClick={() => setConnMode("remote")}
            >
              {t("settings.modeRemote")}
            </button>
            <button
              className={`settings-theme-option ${connMode === "ssh" ? "active" : ""}`}
              onClick={() => setConnMode("ssh")}
            >
              SSH Tunnel
            </button>
          </div>
          <div className="settings-field-hint">
            {connMode === "local"
              ? t("settings.modeLocalHint")
              : connMode === "ssh"
                ? "Tunnel to a remote SPS service over SSH — no exposed ports or API keys needed."
                : t("settings.modeRemoteHint")}
          </div>
        </div>

        {!apiServerKeyMissing ? null : connMode === "local" ? (
          <div className="settings-api-key-banner">
            <div className="settings-api-key-banner-title">
              Session history disabled — <code>API_SERVER_KEY</code> not set
            </div>
            <div className="settings-api-key-banner-desc">
              Without an API server key the connection service cannot
              authenticate session continuation requests. Messages will still
              send, but conversation history won&apos;t be preserved across
              restarts.
            </div>
            <button
              className="btn btn-primary"
              disabled={generatingKey}
              onClick={async () => {
                setGeneratingKey(true);
                await window.hermesAPI.generateApiServerKey(profile);
                setApiServerKeyMissing(false);
                setGeneratingKey(false);
                setConnStatus(
                  "API key generated — connection service restarting…",
                );
                setTimeout(() => setConnStatus(null), 4000);
              }}
            >
              {generatingKey ? "Generating…" : "Generate & save a key for me"}
            </button>
          </div>
        ) : (
          <div className="settings-api-key-banner settings-api-key-banner--info">
            <div className="settings-api-key-banner-title">
              Set <code>API_SERVER_KEY</code> on the remote server
            </div>
            <div className="settings-api-key-banner-desc">
              {connMode === "ssh"
                ? "SSH mode: add API_SERVER_KEY=<your-key> to ~/.hermes/profiles/<profile>/.env on the remote host, then restart the connection service there."
                : "Remote mode: add API_SERVER_KEY=<your-key> to the .env on your remote SPS service, then restart the connection service."}
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
              <label className="settings-field-label">SSH Host</label>
              <input
                className="input"
                type="text"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder="192.168.1.100 or myserver.local"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">SSH Port</label>
              <input
                className="input"
                type="number"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
                placeholder="22"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">Username</label>
              <input
                className="input"
                type="text"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder="hermes"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                Private Key Path{" "}
                <span style={{ fontWeight: 400, opacity: 0.6 }}>
                  (optional, defaults to ~/.ssh/id_rsa)
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
                Remote Hermes Port{" "}
                <span style={{ fontWeight: 400, opacity: 0.6 }}>
                  (default 8642)
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
                Make sure you can run{" "}
                <code style={{ fontFamily: "monospace" }}>
                  ssh {sshUser || "user"}@{sshHost || "host"}
                </code>{" "}
                without a password prompt. The first connection trusts the host
                key and stores it in{" "}
                <code style={{ fontFamily: "monospace" }}>
                  ~/.ssh/known_hosts
                </code>
                ; SSH will fail closed if that key changes later.
              </div>
            </div>
            <div className="settings-hermes-actions">
              <button
                className="btn btn-secondary"
                onClick={handleTestConnection}
                disabled={connTesting}
              >
                {connTesting ? "Testing SSH…" : "Test SSH Connection"}
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

      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">
          {t("settings.sections.appearance")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.theme.label")}
          </label>
          <div className="settings-theme-options">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`settings-theme-option ${theme === opt.value ? "active" : ""}`}
                onClick={() => {
                  setTheme(opt.value);
                  // Keep the SPS workspace (the source of truth) in lockstep:
                  // its Tweaks.dark drives both the workspace and, via
                  // applyTweaks → document root, this admin overlay.
                  const prefersDark = window.matchMedia(
                    "(prefers-color-scheme: dark)",
                  ).matches;
                  const dark =
                    opt.value === "dark" ||
                    (opt.value === "system" && prefersDark);
                  useSpsStore.getState().setTweak("dark", dark);
                }}
              >
                {opt.value === "system"
                  ? t("settings.theme.system")
                  : opt.value === "light"
                    ? t("settings.theme.light")
                    : t("settings.theme.dark")}
              </button>
            ))}
          </div>
          <div className="settings-field-hint">
            {t("settings.appearanceHint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="app-zoom-range">
            Display zoom
            <span className="settings-zoom-value">{appZoom.percent}%</span>
          </label>
          <div className="settings-zoom-control">
            <button
              className="btn btn-secondary settings-zoom-button"
              type="button"
              onClick={() => void updateAppZoom(appZoom.factor - appZoom.step)}
              disabled={appZoomSaving || appZoom.factor <= appZoom.min}
              aria-label="Decrease display zoom"
            >
              -
            </button>
            <input
              id="app-zoom-range"
              className="settings-zoom-range"
              type="range"
              min={appZoom.min}
              max={appZoom.max}
              step={appZoom.step}
              value={appZoom.factor}
              onChange={(event) =>
                void updateAppZoom(event.currentTarget.valueAsNumber)
              }
              aria-label="Display zoom"
              aria-valuetext={`${appZoom.percent}%`}
              disabled={appZoomSaving}
            />
            <button
              className="btn btn-secondary settings-zoom-button"
              type="button"
              onClick={() => void updateAppZoom(appZoom.factor + appZoom.step)}
              disabled={appZoomSaving || appZoom.factor >= appZoom.max}
              aria-label="Increase display zoom"
            >
              +
            </button>
            <button
              className="btn btn-secondary settings-zoom-reset"
              type="button"
              onClick={() => void updateAppZoom(APP_ZOOM_DEFAULT)}
              disabled={appZoomSaving || appZoom.factor === APP_ZOOM_DEFAULT}
            >
              Reset
            </button>
          </div>
          <div className="settings-field-hint">
            Make text and interface controls larger or smaller. Applies after
            restart too.
          </div>
        </div>
      </div>

      <div className="settings-section" data-section-tab="dataPrivacy">
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

      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">Automation</div>
        <div className="settings-field">
          <label className="settings-field-label">
            Scoped auto-approve
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setAutoApproveState(val);
                  await window.hermesAPI.setAutoApprove(val, profile);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            Applies to this profile only. Auto-approves just provably-safe,
            read-only commands (ls, cat, git status, grep…). Writes, deletes,
            installs, network sends, and anything chained or redirected always
            ask for your approval. Off by default; turn it off any time to
            require manual approval again.
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            Completion sound
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={completionSound}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setCompletionSoundState(val);
                  await window.hermesAPI.setCompletionSound(val);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            Play a system chime when My Assistant finishes — the cue for which
            of several parallel runs just landed.
          </div>
        </div>
        <div className="settings-field">
          <div className="settings-field-label">Owner notifications</div>
          <div className="settings-field-hint">
            Profile-scoped delivery for briefs, nags, alerts, and updates.
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {[
              ["macos", "macOS notifications"],
              ["telegram", "Telegram DM"],
              ["email", "Email"],
              ["whatsapp", "WhatsApp"],
            ].map(([channel, label]) => (
              <label
                key={channel}
                className="settings-field-label"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={
                    ownerNotifications.channels[
                      channel as keyof OwnerNotificationPrefs["channels"]
                    ]
                  }
                  onChange={(e) =>
                    void updateOwnerNotifications({
                      channels: { [channel]: e.target.checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              marginTop: 12,
            }}
          >
            <label className="settings-field-label">
              Telegram chat id
              <input
                className="input"
                value={ownerNotifications.targets.telegramChatId}
                onChange={(e) =>
                  void updateOwnerNotifications({
                    targets: { telegramChatId: e.target.value },
                  })
                }
              />
            </label>
            <label className="settings-field-label">
              Delivery email
              <input
                className="input"
                type="email"
                value={ownerNotifications.targets.emailAddress}
                onChange={(e) =>
                  void updateOwnerNotifications({
                    targets: { emailAddress: e.target.value },
                  })
                }
              />
            </label>
            <label className="settings-field-label">
              WhatsApp target
              <input
                className="input"
                value={ownerNotifications.targets.whatsappTarget}
                onChange={(e) =>
                  void updateOwnerNotifications({
                    targets: { whatsappTarget: e.target.value },
                  })
                }
              />
            </label>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 14px",
              marginTop: 12,
            }}
          >
            {OWNER_NOTIFICATION_EVENTS.map((event) => (
              <label
                key={event}
                className="settings-field-label"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <input
                  type="checkbox"
                  checked={ownerNotifications.events[event]}
                  onChange={(e) =>
                    void updateOwnerNotifications({
                      events: { [event]: e.target.checked },
                    })
                  }
                />
                {OWNER_EVENT_LABELS[event]}
              </label>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px 12px",
              marginTop: 12,
              alignItems: "end",
            }}
          >
            <label
              className="settings-field-label"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="checkbox"
                checked={ownerNotifications.quietHours.enabled}
                onChange={(e) =>
                  void updateOwnerNotifications({
                    quietHours: { enabled: e.target.checked },
                  })
                }
              />
              Quiet hours
            </label>
            <label className="settings-field-label">
              Start
              <input
                className="input"
                type="time"
                value={ownerNotifications.quietHours.start}
                onChange={(e) =>
                  void updateOwnerNotifications({
                    quietHours: { start: e.target.value },
                  })
                }
              />
            </label>
            <label className="settings-field-label">
              End
              <input
                className="input"
                type="time"
                value={ownerNotifications.quietHours.end}
                onChange={(e) =>
                  void updateOwnerNotifications({
                    quietHours: { end: e.target.value },
                  })
                }
              />
            </label>
            <label className="settings-field-label">
              Rate limit minutes
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={ownerNotifications.rateLimitMinutes}
                onChange={(e) =>
                  void updateOwnerNotifications({
                    rateLimitMinutes: Math.max(
                      0,
                      parseInt(e.target.value, 10) || 0,
                    ),
                  })
                }
              />
            </label>
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="approval-timeout">
            Approval auto-deny timeout
          </label>
          <input
            id="approval-timeout"
            className="input"
            type="number"
            min={0}
            step={5}
            style={{ maxWidth: 140 }}
            value={approvalTimeout}
            onChange={(e) => {
              const next = String(
                Math.max(0, parseInt(e.target.value, 10) || 0),
              );
              setApprovalTimeout(next);
              void window.hermesAPI.setConfig(
                "approval.timeout_seconds",
                next,
                profile,
              );
            }}
          />
          <div className="settings-field-hint">
            Seconds before an unanswered command-approval auto-denies (a safety
            default for when you operate from mobile). <strong>0 = off</strong>;
            approvals then wait indefinitely for your decision.
          </div>
        </div>
      </div>

      <div className="settings-section" data-section-tab="advanced">
        <div className="settings-section-title">Developer mode</div>
        <div className="settings-field">
          <label className="settings-field-label">
            Show developer controls in chat
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={devModeOn}
                onChange={(e) => {
                  const val = e.target.checked;
                  setDevModeOn(val);
                  setDevMode(val);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            Reveals the worktree panel and filesystem checkpoint controls in the
            Chat header. Off by default — tool use itself is always available.
          </div>
        </div>
      </div>

      <div className="settings-section" data-section-tab="advanced">
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
            onChange={(e) => setHttpProxy(e.target.value)}
            onBlur={async () => {
              await window.hermesAPI.setConfig(
                "network.proxy",
                httpProxy.trim(),
                profile,
              );
              setNetworkSaved(true);
              setTimeout(() => setNetworkSaved(false), 2000);
            }}
            placeholder={t("settings.proxyPlaceholder")}
          />
          <div className="settings-field-hint">
            {t("settings.httpProxyHint")}
          </div>
        </div>
      </div>

      {connMode === "remote" && (
        <div className="settings-section" data-section-tab="advanced">
          <div className="settings-section-title">
            {t("settings.serverConfigTitle")}
          </div>
          <div
            className="settings-field-hint"
            dangerouslySetInnerHTML={{ __html: t("settings.serverConfigHint") }}
          />
        </div>
      )}

      <div className="settings-section" data-section-tab="dataPrivacy">
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

      <div className="settings-section" data-section-tab="troubleshooting">
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

export default Settings;
