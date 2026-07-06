import { useState } from "react";
import HermesLogo from "../../components/common/HermesLogo";
import {
  ArrowRight,
  Refresh,
  Copy,
  Globe,
  KeyRound,
  Spinner,
} from "../../assets/icons";
import { getInstallCmd } from "../../constants";
import { useI18n } from "../../components/useI18n";

interface WelcomeProps {
  error: string | null;
  connectionMode: "local" | "remote" | "ssh";
  onStart: () => void;
  onRecheck: () => void;
  onSwitchToLocal: () => void;
}

type ConnectionPanel = "none" | "remote" | "ssh";

function Welcome({
  error,
  connectionMode,
  onStart,
  onRecheck,
  onSwitchToLocal,
}: WelcomeProps): React.JSX.Element {
  const { t } = useI18n();
  const [panel, setPanel] = useState<ConnectionPanel>("none");

  // Remote state
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteTesting, setRemoteTesting] = useState(false);

  // SSH state
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshRemotePort, setSshRemotePort] = useState("");
  const [sshError, setSshError] = useState<string | null>(null);
  const [sshTesting, setSshTesting] = useState(false);

  async function handleConnectRemote(): Promise<void> {
    const url = remoteUrl.trim();
    const key = remoteApiKey.trim();
    if (!url) {
      setRemoteError(t("settings.remoteErrorUrl"));
      return;
    }
    setRemoteTesting(true);
    setRemoteError(null);
    try {
      const ok = await window.hermesAPI.testRemoteConnection(url, key);
      if (ok) {
        await window.hermesAPI.setConnectionConfig("remote", url, key);
        onRecheck();
      } else {
        setRemoteError(t("settings.remoteErrorConnection"));
      }
    } catch {
      setRemoteError(t("settings.remoteErrorFailed"));
    } finally {
      setRemoteTesting(false);
    }
  }

  async function handleConnectSsh(): Promise<void> {
    const host = sshHost.trim();
    const user = sshUser.trim();
    if (!host || !user) {
      setSshError(t("settings.sshErrorRequired"));
      return;
    }
    const port = parseInt(sshPort, 10) || 22;
    const remotePort = parseInt(sshRemotePort, 10) || 8642;
    setSshTesting(true);
    setSshError(null);
    try {
      const ok = await window.hermesAPI.testSshConnection(
        host,
        port,
        user,
        sshKeyPath.trim(),
        remotePort,
      );
      if (ok) {
        await window.hermesAPI.setSshConfig(
          host,
          port,
          user,
          sshKeyPath.trim(),
          remotePort,
          18642,
        );
        onRecheck();
      } else {
        setSshError(t("settings.sshErrorConnection"));
      }
    } catch (e) {
      setSshError(t("settings.sshErrorFailed", { msg: (e as Error).message }));
    } finally {
      setSshTesting(false);
    }
  }

  if (panel === "remote") {
    return (
      <div className="screen welcome-screen">
        <HermesLogo size={36} />
        <h1 className="welcome-title" style={{ fontSize: 22 }}>
          {t("welcome.connectRemoteTitle")}
        </h1>
        <p className="welcome-subtitle" style={{ marginBottom: 24 }}>
          {t("welcome.connectRemoteSubtitle")}
        </p>

        <div className="welcome-remote-card">
          <label className="welcome-remote-label">
            {t("welcome.remoteServerUrl")}
          </label>
          <input
            type="url"
            className="welcome-remote-input"
            placeholder="http://192.168.1.100:8642"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnectRemote();
            }}
            autoFocus
          />

          <label className="welcome-remote-label" style={{ marginTop: 12 }}>
            {t("welcome.remoteApiKey")}
          </label>
          <input
            type="password"
            className="welcome-remote-input"
            placeholder={t("welcome.remoteApiKeyPlaceholder")}
            value={remoteApiKey}
            onChange={(e) => setRemoteApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnectRemote();
            }}
          />

          <div className="welcome-remote-row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={handleConnectRemote}
              disabled={remoteTesting}
              style={{ whiteSpace: "nowrap", width: "100%" }}
            >
              {remoteTesting ? (
                <>
                  {t("welcome.testingConnection")}
                  <Spinner size={14} className="animate-spin" />
                </>
              ) : (
                t("welcome.connect")
              )}
            </button>
          </div>
          {remoteError && (
            <p
              className="welcome-remote-error"
              style={{ whiteSpace: "pre-line" }}
            >
              {remoteError}
            </p>
          )}
          <p className="welcome-remote-hint">{t("welcome.remoteHint")}</p>
        </div>

        <button
          className="btn-ghost"
          onClick={() => setPanel("none")}
          style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}
        >
          {t("common.back")}
        </button>
      </div>
    );
  }

  if (panel === "ssh") {
    return (
      <div className="screen welcome-screen">
        <HermesLogo size={36} />
        <h1 className="welcome-title" style={{ fontSize: 22 }}>
          {t("settings.sshTitle")}
        </h1>
        <p className="welcome-subtitle" style={{ marginBottom: 24 }}>
          {t("settings.sshSubtitle")}
        </p>

        <div className="welcome-remote-card">
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 3 }}>
              <label className="welcome-remote-label">
                {t("settings.sshHost")}
              </label>
              <input
                type="text"
                className="welcome-remote-input"
                placeholder={t("settings.sshHostPlaceholder")}
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="welcome-remote-label">
                {t("settings.sshPort")}
              </label>
              <input
                type="number"
                className="welcome-remote-input"
                placeholder="22"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
              />
            </div>
          </div>

          <label className="welcome-remote-label" style={{ marginTop: 12 }}>
            {t("settings.sshUsername")}
          </label>
          <input
            type="text"
            className="welcome-remote-input"
            placeholder={t("settings.sshUsernamePlaceholder")}
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
          />

          <label className="welcome-remote-label" style={{ marginTop: 12 }}>
            {t("settings.sshKeyPath")}{" "}
            <span style={{ fontWeight: 400, opacity: 0.6 }}>
              {t("settings.sshKeyPathOptional")}
            </span>
          </label>
          <input
            type="text"
            className="welcome-remote-input"
            placeholder="~/.ssh/id_rsa"
            value={sshKeyPath}
            onChange={(e) => setSshKeyPath(e.target.value)}
          />

          <label className="welcome-remote-label" style={{ marginTop: 12 }}>
            {t("settings.sshRemotePort")}{" "}
            <span style={{ fontWeight: 400, opacity: 0.6 }}>
              {t("settings.sshRemotePortDefault")}
            </span>
          </label>
          <input
            type="number"
            className="welcome-remote-input"
            placeholder="8642"
            value={sshRemotePort}
            onChange={(e) => setSshRemotePort(e.target.value)}
          />

          <div className="welcome-remote-row" style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary"
              onClick={handleConnectSsh}
              disabled={sshTesting || !sshHost.trim() || !sshUser.trim()}
              style={{ whiteSpace: "nowrap", width: "100%" }}
            >
              {sshTesting ? (
                <>
                  {t("settings.testingSsh")}
                  <Spinner size={14} className="animate-spin" />
                </>
              ) : (
                <>
                  {t("settings.connectSsh")}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>

          {sshError && (
            <p
              className="welcome-remote-error"
              style={{ whiteSpace: "pre-line" }}
            >
              {sshError}
            </p>
          )}

          <p className="welcome-remote-hint">
            {t("settings.sshHintWelcome", {
              cmd: `${sshUser || "user"}@${sshHost || "host"}`,
            })}
          </p>
        </div>

        <button
          className="btn-ghost"
          onClick={() => setPanel("none")}
          style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}
        >
          {t("common.back")}
        </button>
      </div>
    );
  }

  return (
    <div className="screen welcome-screen">
      <HermesLogo size={80} />
      <br />
      {error ? (
        <>
          <h1 className="welcome-title">{t("welcome.installIssueTitle")}</h1>
          <p className="welcome-subtitle">{error}</p>

          <div className="welcome-actions">
            <button
              className="btn btn-primary welcome-button"
              onClick={onStart}
            >
              {t("welcome.retryInstall")}
              <Refresh size={16} />
            </button>
            <div className="welcome-divider">
              <span>{t("welcome.dividerOr")}</span>
            </div>
            <div className="welcome-terminal-option">
              <p className="welcome-terminal-label">
                {t("welcome.terminalInstallHint")}
              </p>
              <div className="welcome-terminal-box">
                <code>{getInstallCmd()}</code>
                <button
                  className="btn-ghost welcome-copy-btn"
                  onClick={() => navigator.clipboard.writeText(getInstallCmd())}
                  title={t("welcome.copyInstallCommand")}
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
            <button
              className="btn btn-secondary welcome-recheck-btn"
              onClick={onRecheck}
            >
              {t("welcome.recheck")}
            </button>
            {connectionMode !== "local" && (
              <button
                className="btn btn-secondary welcome-recheck-btn"
                onClick={onSwitchToLocal}
              >
                {t("welcome.switchToLocal")}
              </button>
            )}
            <div className="welcome-divider">
              <span>{t("welcome.dividerOr")}</span>
            </div>
            <button
              className="btn btn-secondary welcome-recheck-btn"
              onClick={() => setPanel("ssh")}
            >
              <KeyRound size={16} />
              {t("settings.connectSsh")}
            </button>{" "}
            <button
              className="btn btn-secondary welcome-recheck-btn "
              onClick={() => setPanel("remote")}
            >
              <Globe size={16} />
              {t("welcome.connectRemote")}
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="welcome-title">{t("welcome.title")}</h1>
          <p className="welcome-subtitle">{t("welcome.subtitle")}</p>
          <button className="btn btn-primary welcome-button" onClick={onStart}>
            {t("welcome.getStarted")}
            <ArrowRight size={16} />
          </button>
          <p className="welcome-note">{t("welcome.installSizeHint")}</p>

          <div className="welcome-divider">
            <span>{t("welcome.dividerOr")}</span>
          </div>

          <button
            className="btn btn-secondary welcome-recheck-btn"
            onClick={() => setPanel("ssh")}
          >
            <KeyRound size={16} />
            {t("settings.connectSsh")}
          </button>

          <button
            className="btn btn-secondary welcome-recheck-btn"
            onClick={() => setPanel("remote")}
            style={{ marginTop: 12 }}
          >
            <Globe size={16} />
            {t("welcome.connectRemote")}
          </button>
        </>
      )}
    </div>
  );
}

export default Welcome;
