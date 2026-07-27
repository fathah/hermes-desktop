import { Laptop, Server, Terminal, Wifi } from "lucide-react";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
import { CHAT_TRANSPORT_OPTIONS } from "./settingsHelpers";
import SshDockerTargetSection from "./SshDockerTargetSection";

/**
 * Local / Remote / SSH connection mode, chat transport, server config, and the
 * outgoing Network settings (Force IPv4 + proxy) — proxy/IPv4 shape every
 * connection, so they live here as a subsection rather than a separate tab.
 */
export default function ConnectionPane(): React.JSX.Element {
  const { t } = useI18n();
  const s = useSettings();
  const {
    profile,
    connMode,
    setConnMode,
    connStatus,
    setConnStatus,
    connLoaded,
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
    apiServerKeyMissing,
    setApiServerKeyMissing,
    generatingKey,
    setGeneratingKey,
    remoteChatTransport,
    sshChatTransport,
    transportProbe,
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
    handleSaveConnection,
    handleTestConnection,
    handleRemoteOAuthLogin,
    handleRemoteOAuthLogout,
    handleChatTransportChange,
    handleSwitchToLocal,
    handleSwitchToRemote,
    handleSwitchToSsh,
    forceIpv4,
    setForceIpv4,
    httpProxy,
    setHttpProxy,
    httpProxyRef,
    saveHttpProxy,
    networkSaved,
    setNetworkSaved,
  } = s;

  return (
    <div className="settings-modal-pane">
      {connStatus && <div className="settings-pane-flash">{connStatus}</div>}

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
            <span className="settings-mode-option">
              <Laptop size={15} />
              {t("settings.modeLocal")}
            </span>
          </button>
          <button
            className={`settings-theme-option ${connMode === "remote" ? "active" : ""}`}
            onClick={() => void handleSwitchToRemote()}
          >
            <span className="settings-mode-option">
              <Server size={15} />
              {t("settings.modeRemote")}
            </span>
          </button>
          <button
            className={`settings-theme-option ${connMode === "ssh" ? "active" : ""}`}
            onClick={() => void handleSwitchToSsh()}
          >
            <span className="settings-mode-option">
              <Terminal size={15} />
              {t("settings.modeSsh")}
            </span>
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
            <label className="settings-field-label" htmlFor="remote-url">
              {t("settings.remoteUrl")}
            </label>
            <input
              id="remote-url"
              className="input"
              type="url"
              value={connRemoteUrl}
              onChange={(e) => {
                setConnRemoteUrl(e.target.value);
                setRemoteAuthMode("auto");
              }}
              placeholder="http://192.168.1.100:8642"
              onBlur={handleSaveConnection}
            />
            <div className="settings-field-hint">
              {t("settings.remoteUrlHint")}
            </div>
          </div>
          {remoteAuthMode === "oauth" ? (
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.remoteOAuthTitle")}
              </label>
              <div className="settings-field-hint">
                {remoteOAuthSignedIn
                  ? t("settings.remoteOAuthConnected")
                  : t("settings.remoteOAuthHint")}
              </div>
              <div className="settings-hermes-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={remoteOAuthBusy}
                  onClick={() =>
                    void (remoteOAuthSignedIn
                      ? handleRemoteOAuthLogout()
                      : handleRemoteOAuthLogin())
                  }
                >
                  {remoteOAuthBusy
                    ? t("settings.remoteOAuthWorking")
                    : remoteOAuthSignedIn
                      ? t("settings.remoteOAuthSignOut")
                      : t("settings.remoteOAuthSignIn")}
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-field">
              <label className="settings-field-label" htmlFor="remote-api-key">
                {t("settings.remoteApiKey")}
              </label>
              <input
                id="remote-api-key"
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
                {remoteAuthMode === "auto"
                  ? t("settings.remoteAuthDetecting")
                  : t("settings.remoteApiKeyHint")}
              </div>
            </div>
          )}
          <div className="settings-field">
            <label className="settings-field-label">Chat transport</label>
            <div className="settings-theme-options">
              {CHAT_TRANSPORT_OPTIONS.filter(
                (option) => remoteAuthMode !== "oauth" || option !== "legacy",
              ).map((option) => (
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
              {t("settings.remoteChatTransportHint")}
            </div>
            {transportProbe && (
              <div
                className={`settings-transport-status settings-transport-status--${transportProbe.kind}`}
              >
                <span>{transportProbe.label}</span>
                {transportProbe.loading && <span>Checking…</span>}
                {transportProbe.detail && <code>{transportProbe.detail}</code>}
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
            <button className="btn btn-primary" onClick={handleSaveConnection}>
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
          <SshDockerTargetSection
            draft={{
              host: sshHost,
              port: parseInt(sshPort, 10) || 22,
              username: sshUser,
              keyPath: sshKeyPath,
              remotePort: parseInt(sshRemotePort, 10) || 8642,
            }}
            value={sshDockerContainer}
            onChange={setSshDockerContainer}
            onProvisioned={() => void handleSaveConnection()}
          />
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
                  onClick={() => void handleChatTransportChange("ssh", option)}
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
                {transportProbe.detail && <code>{transportProbe.detail}</code>}
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
            <button className="btn btn-primary" onClick={handleSaveConnection}>
              {t("settings.save")}
            </button>
          </div>
        </>
      )}

      {connMode === "remote" && (
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.serverConfigTitle")}
          </label>
          <div
            className="settings-field-hint"
            dangerouslySetInnerHTML={{ __html: t("settings.serverConfigHint") }}
          />
        </div>
      )}

      {/* Network — applies to every outgoing connection above. */}
      <div className="settings-subsection">
        <div className="settings-subsection-head">
          <Wifi size={14} />
          <span>{t("settings.networkSection")}</span>
          {networkSaved && (
            <span className="settings-saved">{t("settings.saved")}</span>
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
    </div>
  );
}
