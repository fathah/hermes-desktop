import { useState, useEffect, useCallback, useRef } from "react";
import { GATEWAY_SECTIONS, GATEWAY_PLATFORMS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import { useGatewayHealth } from "../../hooks/useGatewayHealth";
import PlatformCard from "./components/PlatformCard";
import WhatsAppCloudSetup from "./components/WhatsAppCloudSetup";
import ConnectedApps from "../Settings/ConnectedApps";

function Gateway({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const gatewayHealth = useGatewayHealth();
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [platformEnabled, setPlatformEnabled] = useState<
    Record<string, boolean>
  >({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [keychainKeys, setKeychainKeys] = useState<Set<string>>(new Set());
  const [gatewayStderrTail, setGatewayStderrTail] = useState("");
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
    const keys = await window.hermesAPI.getKeychainKeys(profile);
    setKeychainKeys(new Set(keys));
    const gwStatus = await window.hermesAPI.gatewayStatus();
    setGatewayRunning(gwStatus);
    if (gwStatus) setGatewayError(null);
    const platforms = await window.hermesAPI.getPlatformEnabled(profile);
    setPlatformEnabled(platforms);
  }, [profile]);

  useEffect(() => {
    loadConfig();
    loadPairings();
  }, [loadConfig, loadPairings]);

  useEffect(() => {
    let cancelled = false;
    if (gatewayHealth !== "down") {
      setGatewayStderrTail("");
      return;
    }
    void window.hermesAPI
      .readLogs("gateway-stderr.log", 80)
      .then((res) => {
        if (!cancelled) setGatewayStderrTail(res.content.trim());
      })
      .catch(() => {
        if (!cancelled) setGatewayStderrTail("");
      });
    return () => {
      cancelled = true;
    };
  }, [gatewayHealth]);

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
      if (status) setGatewayError(null);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  async function toggleGateway(): Promise<void> {
    if (gatewayBusy) return;
    if (gatewayStatusTimeoutRef.current) {
      clearTimeout(gatewayStatusTimeoutRef.current);
      gatewayStatusTimeoutRef.current = null;
    }
    const wasRunning = gatewayRunning;
    setGatewayBusy(true);
    setGatewayError(null);
    try {
      if (wasRunning) {
        const stopped = await window.hermesAPI.stopGateway();
        if (!stopped) setGatewayError(t("gateway.stopFailed"));
        setGatewayRunning(false);
        return;
      }

      const result = await window.hermesAPI.startGateway();
      setGatewayRunning(result.running);
      if (!result.success) {
        const message = result.error || t("gateway.startFailed");
        setGatewayError(
          result.logPath
            ? `${message} ${t("gateway.checkLog", { path: result.logPath })}`
            : message,
        );
        return;
      }

      gatewayStatusTimeoutRef.current = setTimeout(async () => {
        const status = await window.hermesAPI.gatewayStatus();
        setGatewayRunning(status);
        if (!status) {
          setGatewayError(
            result.logPath
              ? `${t("gateway.startExited")} ${t("gateway.checkLog", {
                  path: result.logPath,
                })}`
              : t("gateway.startExited"),
          );
        }
        gatewayStatusTimeoutRef.current = null;
      }, 5000);
    } catch (err) {
      const prefix = wasRunning
        ? t("gateway.stopFailed")
        : t("gateway.startFailed");
      setGatewayError(`${prefix} ${(err as Error).message}`);
    } finally {
      setGatewayBusy(false);
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
    const keys = await window.hermesAPI.getKeychainKeys(profile);
    setKeychainKeys(new Set(keys));
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

      <ConnectedApps profile={profile} />

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
              disabled={gatewayBusy}
            >
              {gatewayBusy
                ? t("gateway.working")
                : gatewayRunning
                  ? t("common.stop")
                  : t("common.start")}
            </button>
          </div>
          {gatewayError && (
            <div
              className="settings-field-hint settings-field-error"
              role="alert"
            >
              {gatewayError}
            </div>
          )}
          {gatewayHealth === "recovering" && (
            <div className="settings-field-hint">
              {t("gateway.healthRecovering")}
            </div>
          )}
          {gatewayHealth === "down" && (
            <>
              <div className="settings-field-hint settings-field-error">
                {t("gateway.healthDown")}
              </div>
              {gatewayStderrTail && (
                <details className="settings-field-hint">
                  <summary>Gateway stderr tail</summary>
                  <pre
                    style={{
                      maxHeight: 220,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      margin: "8px 0 0",
                    }}
                  >
                    {gatewayStderrTail}
                  </pre>
                </details>
              )}
            </>
          )}
          <div className="settings-field-hint">{t("gateway.gatewayHint")}</div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t("gateway.platforms")}</div>
        {GATEWAY_PLATFORMS.map((platform) => (
          <PlatformCard
            key={platform.key}
            platform={platform}
            enabled={!!platformEnabled[platform.key]}
            fields={fieldDefs}
            env={env}
            savedKey={savedKey}
            visibleKeys={visibleKeys}
            keychainKeys={keychainKeys}
            t={t}
            onToggle={togglePlatform}
            onChange={handleChange}
            onBlur={handleBlur}
            onToggleVisibility={toggleVisibility}
          >
            {platform.key === "whatsapp_cloud" && (
              <WhatsAppCloudSetup
                profile={profile}
                env={env}
                savedKey={savedKey}
                gatewayRunning={gatewayRunning}
              />
            )}
          </PlatformCard>
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
                {field.type === "password" &&
                  env[field.key] &&
                  (keychainKeys.has(field.key) ? (
                    <span
                      className="settings-secured-badge"
                      title="Stored securely in your operating system's native keychain (macOS Keychain, Windows Credential Manager, or GNOME Keyring)"
                    >
                      🔒 Secured in OS Keychain
                    </span>
                  ) : (
                    <span
                      className="settings-warning-badge"
                      title="Saved as plain text in your profile's .env file. Enter your system password if prompted to store it in the Keychain."
                    >
                      ⚠️ Saved as plain text (.env)
                    </span>
                  ))}
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

        <div className={`gateway-pairing-grid ${pairingOutput ? "mb-16" : ""}`}>
          {/* Active / Pending Pairings list */}
          <div className="gateway-flex-col-10">
            <div className="gateway-flex-between">
              <span className="settings-field-label no-margin">
                Paired Devices & Requests
              </span>
              <button
                className="btn btn-secondary btn-sm gateway-btn-small"
                onClick={loadPairings}
                disabled={pairingsLoading}
              >
                Refresh List
              </button>
            </div>
            {pairingsLoading ? (
              <div className="settings-loading gateway-loading">
                <div className="loading-spinner gateway-spinner" />
                <span className="settings-field-hint">Loading pairings...</span>
              </div>
            ) : (
              <pre className="settings-hermes-doctor gateway-pre-pairings">
                {pairingsList || "No pairings or requests found."}
              </pre>
            )}
            <button
              className="btn btn-secondary btn-sm align-start"
              onClick={handleClearPendingPairings}
              disabled={pairingActioning}
            >
              Clear All Pending Requests
            </button>
          </div>

          {/* Action inputs */}
          <div className="gateway-flex-col-16">
            <div className="settings-field no-margin">
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

            <div className="settings-field no-margin">
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
          <div className="mt-16">
            <div className="settings-field-label">Action Log</div>
            <pre className="settings-hermes-doctor gateway-pre-log">
              {pairingOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default Gateway;
