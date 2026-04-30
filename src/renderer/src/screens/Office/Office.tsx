import { useState, useEffect, useRef, useCallback } from "react";
import { Refresh, ExternalLink, Settings } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

type OfficeState =
  | "checking"
  | "remote-mode"
  | "not-installed"
  | "installing"
  | "ready"
  | "error";

interface SetupProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

function Office({ visible }: { visible?: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const [state, setState] = useState<OfficeState>("checking");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [port, setPort] = useState(3000);
  const [portInput, setPortInput] = useState("3000");
  const [portInUse, setPortInUse] = useState(false);
  const [wsUrlInput, setWsUrlInput] = useState("ws://localhost:18789");
  const [error, setError] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [progress, setProgress] = useState<SetupProgress>({
    step: 0,
    totalSteps: 2,
    title: "Preparing...",
    detail: "",
    log: "",
  });
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<HTMLWebViewElement>(null);

  // Refs to avoid restarting the poll interval on every state change
  const startingRef = useRef(starting);
  const runningRef = useRef(running);
  const errorRef = useRef(error);
  startingRef.current = starting;
  runningRef.current = running;
  errorRef.current = error;

  const checkStatus = useCallback(async (): Promise<void> => {
    setState("checking");
    // Office (Claw3D) requires a local Hermes Agent process via the local
    // hermes-adapter. Remote mode bypasses the local agent, so the local
    // Office stack would have nothing to talk to. Surface guidance instead
    // of silently failing the install/start.
    const remote = await window.hermesAPI.isRemoteMode();
    if (remote) {
      setState("remote-mode");
      return;
    }
    const status = await window.hermesAPI.claw3dStatus();
    setRunning(status.running);
    setPort(status.port);
    setPortInput(String(status.port));
    setPortInUse(status.portInUse);
    setWsUrlInput(status.wsUrl || "ws://localhost:18789");
    if (status.error) setError(status.error);
    if (status.installed) {
      setState("ready");
    } else {
      setState("not-installed");
    }
  }, []);

  async function handleSwitchToLocal(): Promise<void> {
    await window.hermesAPI.setConnectionConfig("local", "", "");
    await checkStatus();
  }

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Poll status only when tab is visible and in ready state
  useEffect(() => {
    if (state !== "ready" || !visible) return;
    const interval = setInterval(async () => {
      const status = await window.hermesAPI.claw3dStatus();
      setRunning(status.running);
      setPort(status.port);
      setPortInUse(status.portInUse);
      if (status.error && !errorRef.current) {
        setError(status.error);
      }
      if (startingRef.current && status.running) {
        setStarting(false);
      }
      if (!startingRef.current && !status.running && runningRef.current) {
        setRunning(false);
        if (status.error) setError(status.error);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [state, visible]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progress.log, logs]);

  // Webview load/error handling
  useEffect(() => {
    const wv = webviewRef.current as unknown as {
      addEventListener: (e: string, fn: (evt?: unknown) => void) => void;
      removeEventListener: (e: string, fn: (evt?: unknown) => void) => void;
      executeJavaScript?: (code: string) => Promise<unknown>;
    };
    if (!wv) return;
    const onLoad = (): void => {
      setWebviewReady(true);
      setWebviewError("");
      if (wv.executeJavaScript) {
        wv.executeJavaScript(
          `try { localStorage.setItem("claw3d:onboarding:completed", "true") } catch(e) {}`,
        ).catch(() => {});
      }
    };
    const onFail = (evt: unknown): void => {
      setWebviewReady(false);
      const e = evt as { errorDescription?: string; errorCode?: number };
      if (e?.errorCode === -3) return; // Aborted — ignore (happens on reload)
      setWebviewError(
        e?.errorDescription ||
          "Failed to load Claw3D. The dev server may still be starting up.",
      );
    };
    wv.addEventListener("did-finish-load", onLoad);
    wv.addEventListener("did-fail-load", onFail);
    return () => {
      wv.removeEventListener("did-finish-load", onLoad);
      wv.removeEventListener("did-fail-load", onFail);
    };
  }, [running, port]);

  async function handleInstall(): Promise<void> {
    setState("installing");
    setError("");

    const cleanup = window.hermesAPI.onClaw3dSetupProgress((p) => {
      setProgress(p);
    });

    try {
      const result = await window.hermesAPI.claw3dSetup();
      cleanup();
      if (result.success) {
        setState("ready");
      } else {
        setError(result.error || "Setup failed");
        setState("error");
      }
    } catch (err) {
      cleanup();
      setError((err as Error).message || "Setup failed");
      setState("error");
    }
  }

  async function handleStartStop(): Promise<void> {
    if (running) {
      await window.hermesAPI.claw3dStopAll();
      setRunning(false);
      setWebviewReady(false);
      setWebviewError("");
      setError("");
    } else {
      setError("");
      setWebviewError("");
      setStarting(true);
      const result = await window.hermesAPI.claw3dStartAll();
      if (!result.success) {
        setError(result.error || "Failed to start Claw3D");
        setStarting(false);
      } else {
        // Give processes a moment to actually start, polling will confirm
        setTimeout(() => {
          setRunning(true);
        }, 2000);
      }
    }
  }

  async function handlePortSave(): Promise<void> {
    const newPort = parseInt(portInput, 10);
    if (isNaN(newPort) || newPort < 1024 || newPort > 65535) return;
    await window.hermesAPI.claw3dSetPort(newPort);
    setPort(newPort);
    const status = await window.hermesAPI.claw3dStatus();
    setPortInUse(status.portInUse);
  }

  async function handleWsUrlSave(): Promise<void> {
    const trimmed = wsUrlInput.trim();
    if (!trimmed) return;
    await window.hermesAPI.claw3dSetWsUrl(trimmed);
  }

  async function loadLogs(): Promise<void> {
    const l = await window.hermesAPI.claw3dGetLogs();
    setLogs(l);
    setShowLogs(true);
  }

  function refreshWebview(): void {
    setWebviewError("");
    const wv = webviewRef.current as unknown as { reload?: () => void };
    if (wv?.reload) wv.reload();
  }

  const percent =
    progress.totalSteps > 0
      ? Math.round((progress.step / progress.totalSteps) * 100)
      : 0;

  const claw3dUrl = `http://localhost:${port}`;

  // --- Checking ---
  if (state === "checking") {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("office.title")}</h1>
        <div className="office-center">
          <div className="office-spinner" />
          <p className="office-muted">{t("office.checkingStatus")}</p>
        </div>
      </div>
    );
  }

  // --- Remote mode (Office requires local Hermes Agent) ---
  if (state === "remote-mode") {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("office.title")}</h1>
        <div className="office-center">
          <div className="office-setup-card">
            <h2 className="office-setup-title">
              {t("office.remoteModeTitle")}
            </h2>
            <p className="office-setup-desc">{t("office.remoteModeDesc1")}</p>
            <p className="office-setup-desc">{t("office.remoteModeDesc2")}</p>

            <div className="office-remote-option">
              <h3 className="office-remote-option-title">
                {t("office.remoteModeOption1Title")}
              </h3>
              <p className="office-setup-desc">
                {t("office.remoteModeOption1Desc")}
              </p>
              <button className="btn btn-primary" onClick={handleSwitchToLocal}>
                {t("office.switchToLocal")}
              </button>
            </div>

            <div className="office-remote-option">
              <h3 className="office-remote-option-title">
                {t("office.remoteModeOption2Title")}
              </h3>
              <p className="office-setup-desc">
                {t("office.remoteModeOption2Desc")}
              </p>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const url =
                    await window.hermesAPI.getDocUrl("office-on-docker");
                  await window.hermesAPI.openExternal(url);
                }}
              >
                <ExternalLink size={14} />
                {t("office.viewDockerGuide")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Not installed ---
  if (state === "not-installed" || state === "error") {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("office.title")}</h1>
        <div className="office-center">
          <div className="office-setup-card">
            <h2 className="office-setup-title">{t("office.setupTitle")}</h2>
            <p className="office-setup-desc">{t("office.setupDesc1")}</p>
            <p className="office-setup-desc">{t("office.setupDesc2")}</p>
            {error && <div className="office-error">{error}</div>}
            <div className="office-setup-actions">
              <button className="btn btn-primary" onClick={handleInstall}>
                {t("office.installClaw3d")}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  window.hermesAPI.openExternal(
                    "https://github.com/iamlukethedev/Claw3D",
                  )
                }
              >
                <ExternalLink size={14} />
                {t("office.viewOnGithub")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Installing ---
  if (state === "installing") {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("office.title")}</h1>
        <div className="office-installing">
          <h2 className="office-install-title">{t("office.installTitle")}</h2>
          <div className="install-progress-container">
            <div className="install-progress-bar">
              <div
                className="install-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="install-percent">{percent}%</div>
          </div>
          <div className="install-step-info">
            <div className="install-step-title">
              Step {progress.step}/{progress.totalSteps}: {progress.title}
            </div>
            <div className="install-step-detail">{progress.detail}</div>
          </div>
          <div className="install-log" ref={logRef}>
            {progress.log || t("office.waitingToStart")}
          </div>
        </div>
      </div>
    );
  }

  // --- Ready state ---
  return (
    <div className="office-ready">
      <div className="office-toolbar">
        <div className="office-toolbar-left">
          <h1 className="office-toolbar-title">{t("office.title")}</h1>
          <span
            className={`office-status-dot ${running ? "running" : "stopped"}`}
          />
          <span className="office-status-label">
            {starting
              ? t("office.starting")
              : running
                ? t("gateway.running")
                : t("gateway.stopped")}
          </span>
        </div>
        <div className="office-toolbar-right">
          <button
            className={`btn btn-sm ${running ? "btn-secondary" : "btn-primary"}`}
            onClick={handleStartStop}
            disabled={starting || (portInUse && !running)}
          >
            {starting
              ? t("office.starting")
              : running
                ? t("common.stop")
                : t("common.start")}
          </button>
          {running && (
            <>
              <button
                className="btn-ghost office-toolbar-btn"
                onClick={refreshWebview}
                title={t("common.refresh")}
              >
                <Refresh size={16} />
              </button>
              <button
                className="btn-ghost office-toolbar-btn"
                onClick={() => window.hermesAPI.openExternal(claw3dUrl)}
                title={t("office.openInBrowser")}
              >
                <ExternalLink size={16} />
              </button>
            </>
          )}
          <button
            className="btn-ghost office-toolbar-btn"
            onClick={() => setShowSettings(!showSettings)}
            title={t("common.settings")}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="office-settings-bar">
          <div className="office-setting">
            <label className="office-setting-label">{t("common.port")}</label>
            <input
              className="office-port-input"
              type="number"
              min={1024}
              max={65535}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              onBlur={handlePortSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePortSave();
              }}
            />
          </div>
          <div className="office-setting">
            <label className="office-setting-label">
              {t("office.websocketUrl")}
            </label>
            <input
              className="office-ws-input"
              type="text"
              value={wsUrlInput}
              onChange={(e) => setWsUrlInput(e.target.value)}
              onBlur={handleWsUrlSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleWsUrlSave();
              }}
              placeholder="ws://localhost:18789"
            />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={loadLogs}>
            {t("office.viewLogs")}
          </button>
        </div>
      )}

      {portInUse && !running && (
        <div className="office-warning-bar">
          {t("office.portInUseWarning", { port })}
        </div>
      )}

      {error && (
        <div className="office-error-bar">
          <div className="office-error-text">{error}</div>
          <div className="office-error-actions">
            <button className="btn btn-secondary btn-sm" onClick={loadLogs}>
              {t("office.viewLogs")}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setError("")}
            >
              {t("office.close")}
            </button>
          </div>
        </div>
      )}

      {showLogs && (
        <div className="office-logs-panel">
          <div className="office-logs-header">
            <span>{t("office.processLogs")}</span>
            <button className="btn-ghost" onClick={() => setShowLogs(false)}>
              {t("common.close")}
            </button>
          </div>
          <div className="office-logs-content" ref={logRef}>
            {logs || t("office.noLogs")}
          </div>
        </div>
      )}

      <div className="office-content">
        {running && !showLogs ? (
          <>
            {(!webviewReady || webviewError) && (
              <div className="office-loading-overlay">
                {webviewError ? (
                  <div className="office-webview-error">
                    <p className="office-webview-error-title">
                      {t("office.cannotLoadClaw3d")}
                    </p>
                    <p className="office-muted">{webviewError}</p>
                    <div className="office-webview-error-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={refreshWebview}
                      >
                        {t("common.retry")}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={loadLogs}
                      >
                        {t("office.viewLogs")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="office-spinner" />
                    <p className="office-muted">
                      {starting
                        ? t("office.startingClaw3dService")
                        : t("office.loadingClaw3d")}
                    </p>
                  </>
                )}
              </div>
            )}
            <webview
              ref={webviewRef as React.RefObject<HTMLWebViewElement>}
              src={claw3dUrl}
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          </>
        ) : !showLogs ? (
          <div className="office-center">
            <p className="office-muted">
              {portInUse && !running
                ? t("office.portInUse", { port })
                : t("office.clickToStart")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default Office;
