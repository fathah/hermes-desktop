import { useState, useEffect, useCallback } from "react";
import { GATEWAY_SECTIONS } from "../constants";

function Gateway({ profile }: { profile?: string }): React.JSX.Element {
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const loadConfig = useCallback(async (): Promise<void> => {
    const envData = await window.hermesAPI.getEnv(profile);
    setEnv(envData);
    const gwStatus = await window.hermesAPI.gatewayStatus();
    setGatewayRunning(gwStatus);
  }, [profile]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Poll gateway status
  useEffect(() => {
    const interval = setInterval(async () => {
      const status = await window.hermesAPI.gatewayStatus();
      setGatewayRunning(status);
    }, 3000);
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

  return (
    <div className="settings-container">
      <h1 className="settings-header">Gateway</h1>

      <div className="settings-section">
        <div className="settings-section-title">Messaging Gateway</div>
        <div className="settings-field">
          <label className="settings-field-label">Status</label>
          <div className="settings-gateway-row">
            <span
              className={`settings-gateway-status ${gatewayRunning ? "running" : "stopped"}`}
            >
              {gatewayRunning ? "Running" : "Stopped"}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={toggleGateway}
            >
              {gatewayRunning ? "Stop" : "Start"}
            </button>
          </div>
          <div className="settings-field-hint">
            Connects Hermes to Telegram, Discord, Slack, and other platforms
          </div>
        </div>
      </div>

      {GATEWAY_SECTIONS.map((section) => (
        <div key={section.title} className="settings-section">
          <div className="settings-section-title">{section.title}</div>
          {section.items.map((field) => (
            <div key={field.key} className="settings-field">
              <label className="settings-field-label">
                {field.label}
                {savedKey === field.key && (
                  <span className="settings-saved">Saved</span>
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
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                />
                {field.type === "password" && (
                  <button
                    className="btn-ghost settings-toggle-btn"
                    onClick={() => toggleVisibility(field.key)}
                  >
                    {visibleKeys.has(field.key) ? "Hide" : "Show"}
                  </button>
                )}
              </div>
              <div className="settings-field-hint">{field.hint}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default Gateway;
