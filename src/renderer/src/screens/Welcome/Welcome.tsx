import { useState } from "react";
import HermesLogo from "../../components/common/HermesLogo";
import {
  ArrowRight,
  Refresh,
  Copy,
  Globe,
  Spinner,
} from "../../assets/icons";
import { INSTALL_CMD } from "../../constants";
import { useI18n } from "../../components/useI18n";

interface WelcomeProps {
  error: string | null;
  onStart: () => void;
  onRecheck: () => void;
}

type ConnectionPanel = "none" | "remote" | "ssh";

function Welcome({
  error,
  onStart,
  onRecheck,
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
  const [sshPort, setSshPort] = useState("22");
  const [sshUser, setSshUser] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshRemotePort, setSshRemotePort] = useState("8642");
  const [sshError, setSshError] = useState<string | null>(null);
  const [sshTesting, setSshTesting] = useState(false);

  async function handleConnectRemote(): Promise<void> {
    const url = remoteUrl.trim();
    const key = remoteApiKey.trim();
    if (!url) { setRemoteError("Please enter a URL."); return; }
    setRemoteTesting(true);
    setRemoteError(null);
    try {
      const ok = await window.hermesAPI.testRemoteConnection(url, key);
      if (ok) {
        await window.hermesAPI.setConnectionConfig("remote", url, key);
        onRecheck();
      } else {
        setRemoteError(
          "Could not reach Hermes at this URL. Check the URL and API key.\n\nLeave the key empty if the server accepts unauthenticated requests (e.g. via SSH tunnel to localhost).",
        );
      }
    } catch {
      setRemoteError("Connection test failed.");
    } finally {
      setRemoteTesting(false);
    }
  }

  async function handleConnectSsh(): Promise<void> {
    const host = sshHost.trim();
    const user = sshUser.trim();
    if (!host || !user) { setSshError("Host and username are required."); return; }
    const port = parseInt(sshPort, 10) || 22;
    const remotePort = parseInt(sshRemotePort, 10) || 8642;
    setSshTesting(true);
    setSshError(null);
    try {
      const ok = await window.hermesAPI.testSshConnection(host, port, user, sshKeyPath.trim(), remotePort);
      if (ok) {
        await window.hermesAPI.setSshConfig(host, port, user, sshKeyPath.trim(), remotePort, 18642);
        onRecheck();
      } else {
        setSshError(
          "Could not connect via SSH or reach Hermes on the remote. Make sure:\n• SSH key is correct (or default ~/.ssh/id_rsa works)\n• Hermes gateway is running on the remote\n• The remote port is correct (default 8642)",
        );
      }
    } catch (e) {
      setSshError("SSH connection test failed: " + (e as Error).message);
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
            onKeyDown={(e) => { if (e.key === "Enter") handleConnectRemote(); }}
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
            onKeyDown={(e) => { if (e.key === "Enter") handleConnectRemote(); }}
          />

          <div className="welcome-remote-row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={handleConnectRemote}
              disabled={remoteTesting}
              style={{ whiteSpace: "nowrap", width: "100%" }}
            >
              {remoteTesting ? (
                <>{t("welcome.testingConnection")}<Spinner size={14} className="animate-spin" /></>
              ) : (
                t("welcome.connect")
              )}
            </button>
          </div>
          {remoteError && <p className="welcome-remote-error" style={{ whiteSpace: "pre-line" }}>{remoteError}</p>}
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
          Connect via SSH
        </h1>
        <p className="welcome-subtitle" style={{ marginBottom: 24 }}>
          Tunnel to a remote Hermes over SSH — no exposed ports or API keys needed.
        </p>

        <div className="welcome-remote-card">
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 3 }}>
              <label className="welcome-remote-label">SSH Host</label>
              <input
                type="text"
                className="welcome-remote-input"
                placeholder="192.168.1.100 or myserver.local"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="welcome-remote-label">SSH Port</label>
              <input
                type="number"
                className="welcome-remote-input"
                placeholder="22"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
              />
            </div>
          </div>

          <label className="welcome-remote-label" style={{ marginTop: 12 }}>Username</label>
          <input
            type="text"
            className="welcome-remote-input"
            placeholder="hermes"
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
          />

          <label className="welcome-remote-label" style={{ marginTop: 12 }}>
            Private Key Path <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional — defaults to ~/.ssh/id_rsa)</span>
          </label>
          <input
            type="text"
            className="welcome-remote-input"
            placeholder="~/.ssh/id_rsa"
            value={sshKeyPath}
            onChange={(e) => setSshKeyPath(e.target.value)}
          />

          <label className="welcome-remote-label" style={{ marginTop: 12 }}>
            Remote Hermes Port <span style={{ fontWeight: 400, opacity: 0.6 }}>(default 8642)</span>
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
                <>Testing SSH connection…<Spinner size={14} className="animate-spin" /></>
              ) : (
                <>Connect via SSH<ArrowRight size={16} /></>
              )}
            </button>
          </div>

          {sshError && (
            <p className="welcome-remote-error" style={{ whiteSpace: "pre-line" }}>
              {sshError}
            </p>
          )}

          <p className="welcome-remote-hint">
            Uses your system SSH. Make sure you can already run{" "}
            <code style={{ fontFamily: "monospace", fontSize: 12 }}>
              ssh {sshUser || "user"}@{sshHost || "host"}
            </code>{" "}
            without a password prompt.
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
      <HermesLogo size={40} />

      {error ? (
        <>
          <h1 className="welcome-title">{t("welcome.installIssueTitle")}</h1>
          <p className="welcome-subtitle">{error}</p>

          <div className="welcome-actions">
            <button className="btn btn-primary welcome-button" onClick={onStart}>
              {t("welcome.retryInstall")}
              <Refresh size={16} />
            </button>

            <div className="welcome-divider"><span>{t("welcome.dividerOr")}</span></div>

            <div className="welcome-terminal-option">
              <p className="welcome-terminal-label">{t("welcome.terminalInstallHint")}</p>
              <div className="welcome-terminal-box">
                <code>{INSTALL_CMD}</code>
                <button
                  className="btn-ghost welcome-copy-btn"
                  onClick={() => navigator.clipboard.writeText(INSTALL_CMD)}
                  title={t("welcome.copyInstallCommand")}
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>

            <button className="btn btn-secondary welcome-recheck-btn" onClick={onRecheck}>
              {t("welcome.recheck")}
            </button>

            <div className="welcome-divider"><span>or</span></div>

            <button className="btn btn-secondary welcome-recheck-btn" onClick={() => setPanel("ssh")}>
              🔐 Connect via SSH
            </button>

            <button className="btn btn-secondary welcome-recheck-btn" onClick={() => setPanel("remote")}>
              <Globe size={16} />
              Connect to Remote Hermes
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

          <div className="welcome-divider"><span>{t("welcome.dividerOr")}</span></div>

          <button className="btn btn-secondary welcome-recheck-btn" onClick={() => setPanel("ssh")}>
            🔐 Connect via SSH
          </button>

          <button className="btn btn-secondary welcome-recheck-btn" onClick={() => setPanel("remote")}>
            <Globe size={16} />
            {t("welcome.connectRemote")}
          </button>
        </>
      )}
    </div>
  );
}

export default Welcome;
