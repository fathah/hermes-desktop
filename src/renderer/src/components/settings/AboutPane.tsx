import {
  Bug,
  Calendar,
  Cpu,
  Download,
  FolderOpen,
  Loader,
  Monitor,
  RefreshCw,
  RotateCw,
  Stethoscope,
} from "lucide-react";
import { useI18n } from "../useI18n";
import BrandLogo from "../common/BrandLogo";
import hermesIcon from "../../assets/hermes-icon.svg";
import pythonLogo from "../../assets/logos/python.svg";
import openaiLogo from "../../assets/logos/openai.svg";
import { ConfigHealth } from "../../screens/Settings/ConfigHealth";
import { useSettings } from "./SettingsDataContext";

/**
 * About & Updates. Two clearly-separated cards for the two distinct update
 * channels: the **Hermes Agent** (Python engine) and **Hermes Desktop** (this
 * Electron app). They ship independently, so each owns its own update action.
 */
export default function AboutPane(): React.JSX.Element {
  const { t } = useI18n();
  const {
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
    desktopUpdateState,
    desktopUpdateVersion,
    desktopUpdatePercent,
    desktopUpdateError,
    checkDesktopUpdate,
    handleDesktopUpdate,
  } = useSettings();

  const engineHasUpdate = !!parsedVersion?.updateInfo;
  const loading = hermesVersion === null;

  return (
    <div className="settings-modal-pane">
      <ConfigHealth />

      {/* ── Hermes Agent (engine) ─────────────────────────────── */}
      <section className="settings-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <BrandLogo provider="nous" size={20} />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">
              {t("settings.sections.hermesAgent")}
            </div>
            <div className="settings-card-sub">
              {t("settings.agentSubtitle")}
            </div>
          </div>
          {!loading && (
            <span
              className={`settings-card-badge ${engineHasUpdate ? "is-update" : "is-ok"}`}
            >
              {engineHasUpdate
                ? t("settings.statusUpdateAvailable")
                : t("settings.statusUpToDate")}
            </span>
          )}
        </header>

        <div className="settings-card-body">
          <div className="settings-meta-grid">
            <Meta
              label={t("common.engine")}
              loading={loading}
              icon={<Cpu size={13} />}
            >
              {parsedVersion
                ? `v${parsedVersion.version}`
                : t("settings.notDetected")}
            </Meta>
            <Meta
              label={t("common.released")}
              loading={loading}
              icon={<Calendar size={13} />}
            >
              {parsedVersion?.date || "—"}
            </Meta>
            <Meta
              label="Python"
              loading={loading}
              icon={<MetaLogo src={pythonLogo} alt="Python" />}
            >
              {parsedVersion?.python || "—"}
            </Meta>
            <Meta
              label="OpenAI SDK"
              loading={loading}
              icon={<MetaLogo src={openaiLogo} alt="OpenAI" />}
            >
              {parsedVersion?.sdk || "—"}
            </Meta>
          </div>

          <div className="settings-meta-path">
            <span className="settings-meta-label">
              <FolderOpen size={13} />
              {t("common.home")}
            </span>
            {!hermesHome ? (
              <span className="skeleton skeleton-md" />
            ) : (
              <code className="settings-meta-pathvalue">{hermesHome}</code>
            )}
          </div>

          {engineHasUpdate && (
            <div className="settings-hermes-update-badge">
              {parsedVersion?.updateInfo}
            </div>
          )}

          <div className="settings-card-actions">
            {engineHasUpdate ? (
              <button
                className="btn btn-primary"
                onClick={handleUpdateHermes}
                disabled={updating}
              >
                {updating ? (
                  <Loader size={14} className="settings-spin" />
                ) : (
                  <Download size={14} />
                )}
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
              <Stethoscope size={14} />
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
              <Bug size={14} />
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
      </section>

      {/* ── Hermes Desktop (this app) ─────────────────────────── */}
      <section className="settings-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <img
              src={hermesIcon}
              width={20}
              height={20}
              className="brand-logo brand-logo--match-theme"
              alt={t("settings.desktopTitle")}
            />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">
              {t("settings.desktopTitle")}
            </div>
            <div className="settings-card-sub">
              {t("settings.desktopSubtitle")}
            </div>
          </div>
          {desktopUpdateState === "ready" ? (
            <span className="settings-card-badge is-update">
              {t("settings.statusUpdateReady")}
            </span>
          ) : desktopUpdateState === "available" ? (
            <span className="settings-card-badge is-update">
              {t("settings.statusUpdateAvailable")}
            </span>
          ) : desktopUpdateState === "uptodate" ? (
            <span className="settings-card-badge is-ok">
              {t("settings.statusUpToDate")}
            </span>
          ) : null}
        </header>

        <div className="settings-card-body">
          <div className="settings-meta-grid">
            <Meta
              label={t("common.desktop")}
              loading={!appVersion}
              icon={<Monitor size={13} />}
            >
              {t("settings.version", { version: appVersion })}
            </Meta>
          </div>

          <div className="settings-card-actions">
            <DesktopUpdateButton
              state={desktopUpdateState}
              version={desktopUpdateVersion}
              percent={desktopUpdatePercent}
              onCheck={checkDesktopUpdate}
              onAct={handleDesktopUpdate}
            />
            {desktopUpdateState === "uptodate" && (
              <span className="settings-card-actions-note">
                {t("settings.onLatestVersion")}
              </span>
            )}
          </div>

          {desktopUpdateError && (
            <div className="settings-hermes-result error">
              {desktopUpdateError}
            </div>
          )}

          <div className="settings-toggle-row">
            <div className="settings-toggle-text">
              <div className="settings-toggle-title">
                {t("settings.autoUpgradeDesktop")}
                {autoUpgradeSaved && (
                  <span className="settings-saved">{t("settings.saved")}</span>
                )}
              </div>
              <div className="settings-field-hint">
                {t("settings.autoUpgradeDesktopHint")}
              </div>
            </div>
            <label className="tools-toggle">
              <input
                type="checkbox"
                checked={autoUpgradeEnabled}
                onChange={(e) => void handleAutoUpgradeChange(e.target.checked)}
              />
              <span className="tools-toggle-track" />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

/** A labelled version/metadata cell with a leading icon. */
function Meta({
  label,
  loading,
  icon,
  children,
}: {
  label: string;
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="settings-meta">
      <span className="settings-meta-label">
        {icon}
        {label}
      </span>
      {loading ? (
        <span className="skeleton skeleton-sm" />
      ) : (
        <span className="settings-meta-value">{children}</span>
      )}
    </div>
  );
}

/** A brand logo (from assets/logos) tinted to the theme for use as a meta icon. */
function MetaLogo({
  src,
  alt,
}: {
  src: string;
  alt: string;
}): React.JSX.Element {
  return (
    <img
      src={src}
      width={13}
      height={13}
      alt={alt}
      className="brand-logo brand-logo--match-theme"
    />
  );
}

/** The desktop-app update action, driven by the live updater state machine. */
function DesktopUpdateButton({
  state,
  version,
  percent,
  onCheck,
  onAct,
}: {
  state:
    | "available"
    | "downloading"
    | "ready"
    | "error"
    | "checking"
    | "uptodate"
    | null;
  version: string | null;
  percent: number | null;
  onCheck: () => void;
  onAct: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  if (state === "downloading") {
    return (
      <button className="btn btn-primary" disabled>
        <Loader size={14} className="settings-spin" />
        {t("common.downloading", { percent: percent ?? 0 })}
      </button>
    );
  }
  if (state === "ready") {
    return (
      <button className="btn btn-primary" onClick={onAct}>
        <RotateCw size={14} />
        {t("common.restartToUpdate")}
      </button>
    );
  }
  if (state === "available") {
    return (
      <button className="btn btn-primary" onClick={onAct}>
        <Download size={14} />
        {version
          ? t("common.updateAvailable", { version })
          : t("settings.downloadUpdate")}
      </button>
    );
  }
  if (state === "checking") {
    return (
      <button className="btn btn-secondary" disabled>
        <Loader size={14} className="settings-spin" />
        {t("settings.checkingUpdates")}
      </button>
    );
  }
  // null, "uptodate", or "error" → offer a (re)check.
  return (
    <button className="btn btn-secondary" onClick={onCheck}>
      <RefreshCw size={14} />
      {state === "error" ? t("settings.retry") : t("settings.checkForUpdates")}
    </button>
  );
}
