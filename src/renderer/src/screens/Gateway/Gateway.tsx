import { useState, useEffect, useCallback } from "react";
import { GATEWAY_SECTIONS, GATEWAY_PLATFORMS } from "../../constants";
import {
  getEnvFieldHint,
  getEnvFieldLabel,
  getGatewayPlatformDescription,
  getGatewayPlatformLabel,
  useI18n,
} from "../../i18n";

function Gateway({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [platformEnabled, setPlatformEnabled] = useState<
    Record<string, boolean>
  >({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const loadConfig = useCallback(async (): Promise<void> => {
    const envData = await window.hermesAPI.getEnv(profile);
    setEnv(envData);
    const gwStatus = await window.hermesAPI.gatewayStatus();
    setGatewayRunning(gwStatus);
    const platforms = await window.hermesAPI.getPlatformEnabled(profile);
    setPlatformEnabled(platforms);
  }, [profile]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Poll gateway status (10s interval to reduce IPC overhead)
  useEffect(() => {
    const interval = setInterval(async () => {
      const status = await window.hermesAPI.gatewayStatus();
      setGatewayRunning(status);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  async function toggleGateway(): Promise<void> {
    if (gatewayRunning) {
      await window.hermesAPI.stopGateway();
      setGatewayRunning(false);
    } else {
      const started = await window.hermesAPI.startGateway();
      setGatewayRunning(started);
      // Re-check status after a short delay to confirm it stayed up
      setTimeout(async () => {
        const status = await window.hermesAPI.gatewayStatus();
        setGatewayRunning(status);
      }, 2000);
    }
  }

  async function togglePlatform(platform: string): Promise<void> {
    const newValue = !platformEnabled[platform];
    setPlatformEnabled((prev) => ({ ...prev, [platform]: newValue }));
    await window.hermesAPI.setPlatformEnabled(platform, newValue, profile);
    // Re-check gateway status after restart
    setTimeout(async () => {
      const status = await window.hermesAPI.gatewayStatus();
      setGatewayRunning(status);
    }, 3000);
  }

  async function handleBlur(key: string): Promise<void> {
    const value = env[key] || "";
    await window.hermesAPI.setEnv(key, value, profile);
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 2000);
  }

  function handleChange(key: string, value: string): void {
    setEnv((prev) => ({ ...prev, [key]: value }));
  }

  function toggleVisibility(key: string): void {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Build a set of field keys that belong to platforms (for grouping)
  const platformFieldKeys = new Set(GATEWAY_PLATFORMS.flatMap((p) => p.fields));

  // Non-platform fields from GATEWAY_SECTIONS
  const otherSections = GATEWAY_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !platformFieldKeys.has(item.key)),
  })).filter((section) => section.items.length > 0);
  const sectionTitleMap: Record<string, string> = {
    "Messaging Platforms": "gateway.section.messagingPlatforms",
  };

  // Map env keys to their field definitions for rendering inside platform cards
  const fieldDefs = new Map(
    GATEWAY_SECTIONS.flatMap((s) => s.items).map((f) => [f.key, f]),
  );

  return (
    <div className="settings-container">
      <h1 className="settings-header">{t("gateway.title")}</h1>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("gateway.section.messaging")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">{t("gateway.status")}</label>
          <div className="settings-gateway-row">
            <span
              className={`settings-gateway-status ${gatewayRunning ? "running" : "stopped"}`}
            >
              {gatewayRunning ? t("gateway.running") : t("gateway.stopped")}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={toggleGateway}
            >
              {gatewayRunning ? t("common.stop") : t("common.start")}
            </button>
          </div>
          <div className="settings-field-hint">{t("gateway.hint")}</div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("gateway.section.platforms")}
        </div>
        {GATEWAY_PLATFORMS.map((platform) => (
          <div key={platform.key} className="settings-platform-card">
            <div className="settings-platform-header">
              <div className="settings-platform-info">
                <span className="settings-platform-label">
                  {getGatewayPlatformLabel(t, platform.key, platform.label)}
                </span>
                <span className="settings-platform-desc">
                  {getGatewayPlatformDescription(
                    t,
                    platform.key,
                    platform.description,
                  )}
                </span>
              </div>
              <label className="tools-toggle">
                <input
                  type="checkbox"
                  checked={!!platformEnabled[platform.key]}
                  onChange={() => togglePlatform(platform.key)}
                />
                <span className="tools-toggle-track" />
              </label>
            </div>
            {platformEnabled[platform.key] && (
              <div className="settings-platform-fields">
                {platform.fields.map((fieldKey) => {
                  const field = fieldDefs.get(fieldKey);
                  if (!field) return null;
                  return (
                    <div key={field.key} className="settings-field">
                      <label className="settings-field-label">
                        {getEnvFieldLabel(t, field.key, field.label)}
                        {savedKey === field.key && (
                          <span className="settings-saved">
                            {t("common.saved")}
                          </span>
                        )}
                      </label>
                      <div className="settings-input-row">
                        <input
                          className="input"
                          type={
                            field.type === "password" &&
                            !visibleKeys.has(field.key)
                              ? "password"
                              : "text"
                          }
                          value={env[field.key] || ""}
                          onChange={(e) =>
                            handleChange(field.key, e.target.value)
                          }
                          onBlur={() => handleBlur(field.key)}
                          placeholder={t("settings.fieldPlaceholder", {
                            label: getEnvFieldLabel(t, field.key, field.label),
                          })}
                        />
                        {field.type === "password" && (
                          <button
                            className="btn-ghost settings-toggle-btn"
                            onClick={() => toggleVisibility(field.key)}
                          >
                            {visibleKeys.has(field.key)
                              ? t("common.hide")
                              : t("common.show")}
                          </button>
                        )}
                      </div>
                      <div className="settings-field-hint">
                        {getEnvFieldHint(t, field.key, field.hint)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {otherSections.map((section) => (
        <div key={section.title} className="settings-section">
          <div className="settings-section-title">
            {t(
              sectionTitleMap[section.title] || section.title,
              undefined,
              section.title,
            )}
          </div>
          {section.items.map((field) => (
            <div key={field.key} className="settings-field">
              <label className="settings-field-label">
                {getEnvFieldLabel(t, field.key, field.label)}
                {savedKey === field.key && (
                  <span className="settings-saved">{t("common.saved")}</span>
                )}
              </label>
              <div className="settings-input-row">
                <input
                  className="input"
                  type={
                    field.type === "password" && !visibleKeys.has(field.key)
                      ? "password"
                      : "text"
                  }
                  value={env[field.key] || ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  onBlur={() => handleBlur(field.key)}
                  placeholder={t("settings.fieldPlaceholder", {
                    label: getEnvFieldLabel(t, field.key, field.label),
                  })}
                />
                {field.type === "password" && (
                  <button
                    className="btn-ghost settings-toggle-btn"
                    onClick={() => toggleVisibility(field.key)}
                  >
                    {visibleKeys.has(field.key)
                      ? t("common.hide")
                      : t("common.show")}
                  </button>
                )}
              </div>
              <div className="settings-field-hint">
                {getEnvFieldHint(t, field.key, field.hint)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default Gateway;
