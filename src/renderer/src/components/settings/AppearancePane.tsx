import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { useFont } from "../FontProvider";
import { THEMES, FONT_OPTIONS } from "../../constants";
import { useI18n } from "../useI18n";
import type { GpuPreferenceMode, GpuStatus } from "../../../../shared/gpu";

const GPU_MODES: GpuPreferenceMode[] = ["auto", "on", "off"];
// Show two rows of the 4-col grid up front (7 themes + a "more" tile); the
// rest stay one click away so the pane opens tidy.
const THEME_PREVIEW_COUNT = 7;

/** Theme, rounded corners, interface font, and hardware acceleration. */
export default function AppearancePane(): React.JSX.Element {
  const { t } = useI18n();
  const { theme, setTheme, rounded, setRounded } = useTheme();
  const { font, setFont } = useFont();
  const [showAllThemes, setShowAllThemes] = useState(false);
  // Hardware acceleration is fixed pre-ready, so a changed preference only
  // applies after a relaunch; `savedPref` tracks what's on disk, `bootPref`
  // what this process actually launched with (to decide the restart prompt).
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [savedPref, setSavedPref] = useState<GpuPreferenceMode | null>(null);
  const [gpuSaveError, setGpuSaveError] = useState(false);

  useEffect(() => {
    window.hermesAPI
      .getGpuStatus()
      .then((status) => {
        setGpuStatus(status);
        setSavedPref(status.preference);
      })
      .catch(() => {
        // Older main processes without the handler: hide the field.
      });
  }, []);

  const selectGpuMode = (mode: GpuPreferenceMode): void => {
    setGpuSaveError(false);
    setSavedPref(mode);
    window.hermesAPI
      .setGpuPreference(mode)
      .then((ok) => {
        if (!ok) setGpuSaveError(true);
      })
      .catch(() => setGpuSaveError(true));
  };

  const gpuEnvForced = gpuStatus?.reason === "env";
  const gpuRestartNeeded =
    gpuStatus !== null &&
    savedPref !== null &&
    savedPref !== gpuStatus.bootPreference;

  const hiddenThemeCount = THEMES.length - THEME_PREVIEW_COUNT;
  const visibleThemes = showAllThemes
    ? THEMES
    : THEMES.slice(0, THEME_PREVIEW_COUNT);

  return (
    <div className="settings-modal-pane">
      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.theme.label")}
        </label>
        <div className="settings-theme-grid">
          {visibleThemes.map((th) => {
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
          {!showAllThemes && hiddenThemeCount > 0 && (
            <button
              type="button"
              className="settings-theme-card settings-theme-more"
              onClick={() => setShowAllThemes(true)}
            >
              {t("settings.theme.more", { count: hiddenThemeCount })}
            </button>
          )}
        </div>
      </div>

      {/* Grouped preferences — one card, row dividers, control on the right. */}
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">
              {t("settings.roundedCorners.label")}
            </div>
            <div className="settings-row-hint">
              {t("settings.roundedCorners.hint")}
            </div>
          </div>
          <label className="tools-toggle" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={rounded}
              onChange={() => setRounded(!rounded)}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">{t("settings.font.label")}</div>
            <div className="settings-row-hint">{t("settings.font.hint")}</div>
          </div>
          <div className="settings-seg">
            {FONT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`settings-seg-btn ${font === opt.value ? "active" : ""}`}
                style={{ fontFamily: opt.stack }}
                onClick={() => setFont(opt.value)}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
        </div>

        {gpuStatus !== null && savedPref !== null && (
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-label">
                {t("settings.hardwareAcceleration.label")}
              </div>
              <div className="settings-row-hint">
                {gpuEnvForced
                  ? t("settings.hardwareAcceleration.envOverride")
                  : t("settings.hardwareAcceleration.hint")}
              </div>
            </div>
            <div className="settings-seg">
              {GPU_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`settings-seg-btn ${savedPref === mode ? "active" : ""}`}
                  onClick={() => selectGpuMode(mode)}
                >
                  {t(`settings.hardwareAcceleration.${mode}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {gpuSaveError && (
        <div className="settings-field-hint" style={{ color: "#ef4444" }}>
          {t("settings.hardwareAcceleration.saveFailed")}
        </div>
      )}
      {gpuRestartNeeded && !gpuSaveError && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="settings-field-hint" style={{ margin: 0 }}>
            {t("settings.hardwareAcceleration.restartToApply")}
          </span>
          <button
            type="button"
            className="settings-seg-btn"
            onClick={() => void window.hermesAPI.relaunchApp()}
          >
            {t("settings.hardwareAcceleration.restartNow")}
          </button>
        </div>
      )}
    </div>
  );
}
