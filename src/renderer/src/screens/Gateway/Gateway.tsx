import { useState, useEffect, useCallback, useRef } from "react";
import { GATEWAY_SECTIONS, GATEWAY_PLATFORMS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";

function Gateway({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [platformEnabled, setPlatformEnabled] = useState<
    Record<string, boolean>
  >({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const gatewayStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const platformStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Pairing / Access Control states
  const [pairingsList, setPairingsList] = useState("");
  const [pairingsLoading, setPairingsLoading] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [userIdToRevoke, setUserIdToRevoke] = useState("");
  const [pairingOutput, setPairingOutput] = useState<string | null>(null);
  const [pairingActioning, setPairingActioning] = useState(false);

  const loadPairings = useCallback(async (): Promise<void> => {
    setPairingsLoading(true);
    try {
      const list = await window.hermesAPI.listPairings(profile);
      setPairingsList(list);
    } catch (err) {
      console.error("Failed to list pairings:", err);
    } finally {
      setPairingsLoading(false);
    }
  }, [profile]);

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
    loadPairings();
  }, [loadConfig, loadPairings]);

  async function handleApprovePairing(): Promise<void> {
    if (!pairingCode.trim()) return;
    setPairingActioning(true);
    setPairingOutput(null);
    try {
      const res = await window.hermesAPI.approvePairing(
        pairingCode.trim(),
        profile,
      );
      setPairingOutput(
        res.output ||
          (res.success
            ? "Successfully approved pairing code"
            : "Failed to approve pairing code"),
      );
      setPairingCode("");
      await loadPairings();
    } catch (err) {
      setPairingOutput("Error: " + (err as Error).message);
    } finally {
      setPairingActioning(false);
    }
  }

  async function handleRevokePairing(): Promise<void> {
    if (!userIdToRevoke.trim()) return;
    setPairingActioning(true);
    setPairingOutput(null);
    try {
      const res = await window.hermesAPI.revokePairing(
        userIdToRevoke.trim(),
        profile,
      );
      setPairingOutput(
        res.output ||
          (res.success
            ? "Successfully revoked pairing"
            : "Failed to revoke pairing"),
      );
      setUserIdToRevoke("");
      await loadPairings();
    } catch (err) {
      setPairingOutput("Error: " + (err as Error).message);
    } finally {
      setPairingActioning(false);
    }
  }

  async function handleClearPendingPairings(): Promise<void> {
    setPairingActioning(true);
    setPairingOutput(null);
    try {
      const res = await window.hermesAPI.clearPendingPairings(profile);
      setPairingOutput(
        res.output ||
          (res.success
            ? "Successfully cleared pending pairings"
            : "Failed to clear pending pairings"),
      );
      await loadPairings();
    } catch (err) {
      setPairingOutput("Error: " + (err as Error).message);
    } finally {
      setPairingActioning(false);
    }
  }

  // Poll gateway status (10s interval to reduce IPC overhead)
  useEffect(() => {
    const interval = setInterval(async () => {
      const status = await window.hermesAPI.gatewayStatus();
      setGatewayRunning(status);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  async function toggleGateway(): Promise<void> {
    if (gatewayStatusTimeoutRef.current) {
      clearTimeout(gatewayStatusTimeoutRef.current);
      gatewayStatusTimeoutRef.current = null;
    }
    if (gatewayRunning) {
      await window.hermesAPI.stopGateway();
      setGatewayRunning(false);
    } else {
      const started = await window.hermesAPI.startGateway();
      setGatewayRunning(started);
      gatewayStatusTimeoutRef.current = setTimeout(async () => {
        const status = await window.hermesAPI.gatewayStatus();
        setGatewayRunning(status);
        gatewayStatusTimeoutRef.current = null;
      }, 5000);
    }
  }

  async function togglePlatform(platform: string): Promise<void> {
    if (platformStatusTimeoutRef.current) {
      clearTimeout(platformStatusTimeoutRef.current);
      platformStatusTimeoutRef.current = null;
    }
    const newValue = !platformEnabled[platform];
    setPlatformEnabled((prev) => ({ ...prev, [platform]: newValue }));
    await window.hermesAPI.setPlatformEnabled(platform, newValue, profile);
    platformStatusTimeoutRef.current = setTimeout(async () => {
      const status = await window.hermesAPI.gatewayStatus();
      setGatewayRunning(status);
      platformStatusTimeoutRef.current = null;
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

  // Map env keys to their field definitions for rendering inside platform cards
  const fieldDefs = new Map(
    GATEWAY_SECTIONS.flatMap((s) => s.items).map((f) => [f.key, f]),
  );

  return (
    <div className="settings-container">
      <h1 className="settings-header">{t("gateway.title")}</h1>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("gateway.messagingGateway")}
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
          <div className="settings-field-hint">{t("gateway.gatewayHint")}</div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t("gateway.platforms")}</div>
        {GATEWAY_PLATFORMS.map((platform) => (
          <div key={platform.key} className="settings-platform-card">
            <div className="settings-platform-header">
              <div className="settings-platform-left">
                <BrandLogo provider={platform.key} size={28} />
                <div className="settings-platform-info">
                  <span className="settings-platform-label">
                    {t(platform.label)}
                  </span>
                  <span className="settings-platform-desc">
                    {t(platform.description)}
                  </span>
                </div>
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
                        {t(field.label)}
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
                          placeholder={t(field.label)}
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
                      <div className="settings-field-hint">{t(field.hint)}</div>
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
          <div className="settings-section-title">{t(section.title)}</div>
          {section.items.map((field) => (
            <div key={field.key} className="settings-field">
              <label className="settings-field-label">
                {t(field.label)}
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
                  placeholder={t(field.label)}
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
              <div className="settings-field-hint">{t(field.hint)}</div>
            </div>
          ))}
        </div>
      ))}

      {/* Access Control & Pairing Section */}
      <div className="settings-section">
        <div className="settings-section-title">
          Gateway Access Control & Pairing
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "24px",
            marginBottom: pairingOutput ? 16 : 0,
          }}
        >
          {/* Active / Pending Pairings list */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span className="settings-field-label" style={{ margin: 0 }}>
                Paired Devices & Requests
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={loadPairings}
                disabled={pairingsLoading}
                style={{ padding: "2px 8px", fontSize: 11 }}
              >
                Refresh List
              </button>
            </div>
            {pairingsLoading ? (
              <div
                className="settings-loading"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 0",
                }}
              >
                <div
                  className="loading-spinner"
                  style={{
                    width: 14,
                    height: 14,
                    border: "2px solid rgba(127,127,127,0.2)",
                    borderTopColor: "var(--accent)",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <span className="settings-field-hint">Loading pairings...</span>
              </div>
            ) : (
              <pre
                className="settings-hermes-doctor"
                style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  fontSize: 11,
                  margin: 0,
                }}
              >
                {pairingsList || "No pairings or requests found."}
              </pre>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleClearPendingPairings}
              disabled={pairingActioning}
              style={{ alignSelf: "flex-start" }}
            >
              Clear All Pending Requests
            </button>
          </div>

          {/* Action inputs */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div className="settings-field" style={{ margin: 0 }}>
              <label className="settings-field-label">
                Approve Pairing Code
              </label>
              <div className="settings-input-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Enter 6-character code"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value)}
                  maxLength={6}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleApprovePairing}
                  disabled={pairingActioning || !pairingCode.trim()}
                >
                  Approve
                </button>
              </div>
              <div className="settings-field-hint">
                Approve a new client (e.g. mobile app, browser extension) using
                the code shown on that device.
              </div>
            </div>

            <div className="settings-field" style={{ margin: 0 }}>
              <label className="settings-field-label">
                Revoke Client/User ID
              </label>
              <div className="settings-input-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Enter user or device ID"
                  value={userIdToRevoke}
                  onChange={(e) => setUserIdToRevoke(e.target.value)}
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleRevokePairing}
                  disabled={pairingActioning || !userIdToRevoke.trim()}
                >
                  Revoke
                </button>
              </div>
              <div className="settings-field-hint">
                Revoke access for a paired device using its user/device ID.
              </div>
            </div>
          </div>
        </div>

        {pairingOutput && (
          <div style={{ marginTop: 16 }}>
            <div className="settings-field-label">Action Log</div>
            <pre
              className="settings-hermes-doctor"
              style={{
                maxHeight: 150,
                overflowY: "auto",
                fontSize: 11,
                margin: 0,
              }}
            >
              {pairingOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default Gateway;
