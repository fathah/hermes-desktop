import { useState, useEffect, useCallback, useRef } from "react";
import { ThemeProvider } from "./components/ThemeProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import Welcome from "./screens/Welcome/Welcome";
import Install from "./screens/Install/Install";
import Setup from "./screens/Setup/Setup";
import Onboarding from "./screens/Onboarding/Onboarding";
import SpsAgent from "./screens/SpsAgent/SpsAgent";
import Layout from "./screens/Layout/Layout";
import hermeslogo from "./assets/hermes.png";
import { useFocusTrap } from "./components/useFocusTrap";
import { captureScreenView } from "./utils/analytics";
import {
  OPEN_SETTINGS_EVENT,
  readLastAdminView,
  type AdminView,
} from "./lib/openSettings";
import {
  spsNewChat,
  spsSearch,
  SWITCH_TO_LOCAL_EVENT,
} from "./lib/spsCommands";

// "loading" is a neutral blank shown only while the async install check runs;
// it replaces the former branded splash screen.
type Screen =
  | "loading"
  | "welcome"
  | "installing"
  | "setup"
  | "onboarding"
  | "main";

interface StartupStep {
  label: string;
  timeoutMs: number;
}

interface StartupIssue {
  label: string;
  timeoutMs: number;
  connectionMode: "local" | "remote" | "ssh" | "unknown";
  message: string;
}

const STARTUP_SHORT_TIMEOUT_MS = 8000;
const STARTUP_SSH_TIMEOUT_MS = 35000;

const STARTUP_STEPS = {
  connection: {
    label: "connection settings",
    timeoutMs: STARTUP_SHORT_TIMEOUT_MS,
  },
  onboarding: {
    label: "first-run onboarding state",
    timeoutMs: STARTUP_SHORT_TIMEOUT_MS,
  },
  localInstall: {
    label: "local install status",
    timeoutMs: STARTUP_SHORT_TIMEOUT_MS,
  },
  remoteHealth: {
    label: "remote health check",
    timeoutMs: STARTUP_SHORT_TIMEOUT_MS,
  },
  sshTunnel: {
    label: "SSH tunnel startup",
    timeoutMs: STARTUP_SSH_TIMEOUT_MS,
  },
} satisfies Record<string, StartupStep>;

class StartupTimeoutError extends Error {
  constructor(public readonly step: StartupStep) {
    super(`Timed out while checking ${step.label}.`);
    this.name = "StartupTimeoutError";
  }
}

class StaleStartupRunError extends Error {
  constructor() {
    super("Startup check was superseded.");
    this.name = "StaleStartupRunError";
  }
}

function withStartupTimeout<T>(
  step: StartupStep,
  run: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new StartupTimeoutError(step));
    }, step.timeoutMs);

    Promise.resolve()
      .then(run)
      .then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          window.clearTimeout(timer);
          reject(err);
        },
      );
  });
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("loading");
  const [installError, setInstallError] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<
    "local" | "remote" | "ssh"
  >("local");
  const [startupIssue, setStartupIssue] = useState<StartupIssue | null>(null);
  // Soft warning: install files exist but the deep `verifyInstall` probe
  // failed (e.g. slow Python startup, restricted network). We surface this
  // as a dismissible banner instead of bouncing the user back to Welcome,
  // which previously trapped restricted-network users in a reinstall
  // loop on every launch (#130).
  const [verifyWarning, setVerifyWarning] = useState(false);
  // SPS Agent is the app; the Hermes admin screens (Providers/Gateway/Settings/
  // …) open on demand as an overlay via the gear button or ⌘,. This is the
  // "settings escape hatch" so the assistant's provider/keys stay configurable.
  const [adminOpen, setAdminOpen] = useState(false);
  // Which admin tab the overlay opens on. Defaults to the last-used tab, but a
  // missing API key forces Providers (the #1 post-setup task), and an explicit
  // deep-link (status chip, banners) overrides both. `null` until the first
  // install check resolves so we don't force Providers before we know.
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [adminInitialView, setAdminInitialView] =
    useState<AdminView>("settings");
  const isMac = window.electron?.process?.platform === "darwin";
  const startupRunIdRef = useRef(0);

  // Pick the tab the overlay should open on when no explicit target is given.
  const defaultAdminView = useCallback(
    (): AdminView => (hasApiKey === false ? "providers" : readLastAdminView()),
    [hasApiKey],
  );

  const openAdmin = useCallback(
    (view?: AdminView): void => {
      setAdminInitialView(view ?? defaultAdminView());
      setAdminOpen(true);
    },
    [defaultAdminView],
  );

  // Menu accelerators are routed by whether the overlay is open. A ref keeps the
  // once-registered IPC listeners reading the *current* value, not a stale one.
  const adminOpenRef = useRef(adminOpen);
  useEffect(() => {
    adminOpenRef.current = adminOpen;
  }, [adminOpen]);

  // Trap focus inside the admin overlay and restore it to the trigger on close.
  const adminOverlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(adminOverlayRef, adminOpen);

  // Expose the platform so CSS can reserve room for the macOS traffic-light
  // buttons (hiddenInset title bar) above the sidebar header.
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-platform",
      isMac ? "mac" : "other",
    );
  }, [isMac]);

  // ⌘, (mac) / Ctrl+, toggles the admin overlay, only once on the main screen.
  // The SPS chrome (sidebar "Settings" item) opens it via a `hermes:open-settings`
  // event instead of a floating gear, so the trigger lives in the layout, not on
  // top of the content.
  useEffect(() => {
    if (screen !== "main") return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        // Toggle: close if open, else open on the computed default tab.
        setAdminOpen((open) => {
          if (open) return false;
          setAdminInitialView(defaultAdminView());
          return true;
        });
      } else if (e.key === "Escape") {
        setAdminOpen(false);
      }
    };
    const onOpenSettings = (
      e: WindowEventMap[typeof OPEN_SETTINGS_EVENT],
    ): void => openAdmin(e.detail?.view);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
    };
  }, [screen, openAdmin, defaultAdminView]);

  // App menu shortcuts (⌘N new chat / ⌘K search). Registered ONCE at the always-
  // mounted root and routed to the active surface — previously these lived in
  // Layout and went dead whenever the admin overlay was closed (the workspace's
  // normal state). The admin overlay no longer hosts a chat surface (the Agents
  // screen + its Chat pane were consolidated away), so ⌘N always starts a new
  // chat in the SPS workspace. Search likewise always opens the SPS palette.
  useEffect(() => {
    if (screen !== "main") return;
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      spsNewChat();
    });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => {
      if (adminOpenRef.current) setAdminOpen(false);
      spsSearch();
    });
    return () => {
      cleanupNewChat();
      cleanupSearch();
    };
  }, [screen]);

  const runInstallCheck = useCallback(async () => {
    const runId = startupRunIdRef.current + 1;
    startupRunIdRef.current = runId;
    setStartupIssue(null);

    let next: Screen = "welcome";
    let error: string | null = null;
    let isRemote = false;
    let currentConnectionMode: "local" | "remote" | "ssh" | "unknown" =
      "unknown";
    let currentStep = STARTUP_STEPS.connection;

    const ensureCurrent = (): void => {
      if (startupRunIdRef.current !== runId) {
        throw new StaleStartupRunError();
      }
    };

    const runStep = async <T,>(
      step: StartupStep,
      run: () => Promise<T>,
    ): Promise<T> => {
      currentStep = step;
      const value = await withStartupTimeout(step, run);
      ensureCurrent();
      return value;
    };

    // First-run gate: every path that would otherwise land in the workspace
    // routes through onboarding once, until the "completed" flag is set. Default
    // to completed so a read failure lands the user in the workspace rather than
    // trapping them on onboarding.
    let onboardingDone = true;
    const landing = (): Screen => (onboardingDone ? "main" : "onboarding");

    try {
      const conn = await runStep(STARTUP_STEPS.connection, () =>
        window.hermesAPI.getConnectionConfig(),
      );
      isRemote = conn.mode === "remote" || conn.mode === "ssh";
      currentConnectionMode = conn.mode;
      setConnectionMode(conn.mode);
      onboardingDone = await runStep(STARTUP_STEPS.onboarding, () =>
        window.hermesAPI.getOnboardingCompleted(),
      );

      if (conn.mode === "ssh" && conn.ssh) {
        // Start (or ensure) the SSH tunnel, then go straight to the workspace
        try {
          await runStep(STARTUP_STEPS.sshTunnel, () =>
            window.hermesAPI.startSshTunnel(),
          );
          next = landing();
        } catch (tunnelErr) {
          if (
            tunnelErr instanceof StartupTimeoutError ||
            tunnelErr instanceof StaleStartupRunError
          ) {
            throw tunnelErr;
          }
          error = `SSH tunnel failed to start: ${(tunnelErr as Error).message}`;
          next = "welcome";
        }
      } else if (conn.mode === "remote" && conn.remoteUrl) {
        const ok = await runStep(STARTUP_STEPS.remoteHealth, () =>
          window.hermesAPI.testRemoteConnection(conn.remoteUrl),
        );
        if (ok) {
          next = landing();
        } else {
          error = `Cannot reach remote Hermes at ${conn.remoteUrl}. Check the URL or switch to local mode.`;
          next = "welcome";
        }
      } else {
        const status = await runStep(STARTUP_STEPS.localInstall, () =>
          window.hermesAPI.checkInstall(),
        );
        setHasApiKey(status.hasApiKey);
        if (!status.installed) {
          next = "welcome";
        } else if (!status.hasApiKey) {
          next = "setup";
        } else {
          next = landing();
        }
      }
    } catch (err) {
      if (err instanceof StaleStartupRunError) return;
      if (err instanceof StartupTimeoutError) {
        if (startupRunIdRef.current === runId) {
          startupRunIdRef.current += 1;
          setInstallError(null);
          setStartupIssue({
            label: err.step.label,
            timeoutMs: err.step.timeoutMs,
            connectionMode: currentConnectionMode,
            message: err.message,
          });
          setScreen("loading");
        }
        return;
      }
      error = `Startup check failed while checking ${currentStep.label}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      next = "welcome";
    }

    if (startupRunIdRef.current !== runId) return;
    if (error) setInstallError(error);

    setScreen(next);

    // Lazy deep-verify in the background after the UI is up. If the
    // install is broken, surface the warning then — don't block startup.
    //
    // Skip for remote-mode connections: verifyInstall() probes the LOCAL
    // Python + script paths (HERMES_PYTHON / HERMES_SCRIPT in installer.ts),
    // which don't exist on machines that only use a remote backend. Without
    // this guard the user is bounced back to Welcome with an "installBroken"
    // error immediately after a successful remote connect. (#47, #41, #30)
    if (
      (next === "main" || next === "setup" || next === "onboarding") &&
      !isRemote
    ) {
      window.hermesAPI
        .verifyInstall()
        .then((ok) => {
          if (startupRunIdRef.current !== runId) return;
          // Files exist (checkInstall passed) but the probe failed. Surface
          // a soft warning instead of bouncing to Welcome — see #130.
          if (!ok) setVerifyWarning(true);
        })
        .catch(() => {
          if (startupRunIdRef.current === runId) setVerifyWarning(true);
        });
    }
  }, []);

  useEffect(() => {
    runInstallCheck();
  }, [runInstallCheck]);

  // Track screen views for analytics
  useEffect(() => {
    captureScreenView(screen);
  }, [screen]);

  function handleInstallComplete(): void {
    setInstallError(null);
    setScreen("setup");
  }

  function handleInstallFailed(error: string): void {
    setInstallError(error);
    setScreen("welcome");
  }

  function handleRetryInstall(): void {
    setStartupIssue(null);
    setInstallError(null);
    setScreen("installing");
  }

  const handleRecheck = useCallback((): void => {
    setStartupIssue(null);
    setInstallError(null);
    setScreen("loading");
    runInstallCheck();
  }, [runInstallCheck]);

  const handleSwitchToLocal = useCallback(async (): Promise<void> => {
    await window.hermesAPI.setConnectionConfig("local", "", "");
    setConnectionMode("local");
    handleRecheck();
  }, [handleRecheck]);

  // Recovery action from a remote-mode block (RemoteNotice button).
  useEffect(() => {
    if (screen !== "main") return;
    const onSwitchLocal = (): void => void handleSwitchToLocal();
    window.addEventListener(SWITCH_TO_LOCAL_EVENT, onSwitchLocal);
    return () =>
      window.removeEventListener(SWITCH_TO_LOCAL_EVENT, onSwitchLocal);
  }, [screen, handleSwitchToLocal]);

  function handleVerifyReinstall(): void {
    setStartupIssue(null);
    setVerifyWarning(false);
    setInstallError(null);
    setScreen("installing");
  }

  function handleDismissVerifyWarning(): void {
    setVerifyWarning(false);
  }

  // After fresh install/setup, a first-time user routes through onboarding (which
  // owns the post-setup config nudge that used to be a blunt "open Providers").
  // Honour the flag in case onboarding was somehow already completed.
  const handleSetupComplete = useCallback(async (): Promise<void> => {
    const done = await window.hermesAPI.getOnboardingCompleted();
    setScreen(done ? "main" : "onboarding");
  }, []);

  // Mark onboarding done and enter the workspace.
  const finishOnboarding = useCallback(async (): Promise<void> => {
    await window.hermesAPI.setOnboardingCompleted(true);
    setScreen("main");
  }, []);

  // Onboarding deep-link: mark done, enter the workspace, and open the admin
  // overlay on the requested tab (Providers / Models) so the user can fix config.
  const configureFromOnboarding = useCallback(
    async (view: AdminView): Promise<void> => {
      await window.hermesAPI.setOnboardingCompleted(true);
      setScreen("main");
      openAdmin(view);
    },
    [openAdmin],
  );

  const copyStartupDiagnostics = useCallback((): void => {
    if (!startupIssue) return;
    const platform = window.electron?.process?.platform ?? "unknown";
    const diagnostics = [
      "SPS Agent startup diagnostics",
      `Platform: ${platform}`,
      `Connection mode: ${startupIssue.connectionMode}`,
      `Startup phase: ${startupIssue.label}`,
      `Timeout: ${formatSeconds(startupIssue.timeoutMs)}`,
      `Message: ${startupIssue.message}`,
    ].join("\n");

    void window.hermesAPI.copyToClipboard(diagnostics);
  }, [startupIssue]);

  function renderScreen(): React.JSX.Element {
    switch (screen) {
      case "loading":
        if (startupIssue) {
          const canSwitchToLocal =
            startupIssue.connectionMode === "remote" ||
            startupIssue.connectionMode === "ssh";
          return (
            <div className="boot-screen">
              <img src={hermeslogo} alt="Hermes" className="boot-logo" />
              <section
                className="boot-diagnostic-card"
                role="alert"
                aria-live="assertive"
              >
                <h1 className="boot-diagnostic-title">
                  Startup check is taking too long
                </h1>
                <p className="boot-diagnostic-message">
                  SPS Agent did not get a response while checking{" "}
                  <strong>{startupIssue.label}</strong> after{" "}
                  {formatSeconds(startupIssue.timeoutMs)}. The app is still
                  running; retry the check or choose another recovery path.
                </p>
                <dl className="boot-diagnostic-details">
                  <div>
                    <dt>Phase</dt>
                    <dd>{startupIssue.label}</dd>
                  </div>
                  <div>
                    <dt>Connection</dt>
                    <dd>{startupIssue.connectionMode}</dd>
                  </div>
                  <div>
                    <dt>Timeout</dt>
                    <dd>{formatSeconds(startupIssue.timeoutMs)}</dd>
                  </div>
                </dl>
                <div className="boot-diagnostic-actions">
                  <button className="btn btn-primary" onClick={handleRecheck}>
                    Retry check
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={handleRetryInstall}
                  >
                    Start install
                  </button>
                  {canSwitchToLocal && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => void handleSwitchToLocal()}
                    >
                      Switch to local
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={copyStartupDiagnostics}
                  >
                    Copy diagnostics
                  </button>
                </div>
              </section>
            </div>
          );
        }
        return (
          <div className="boot-screen">
            <img src={hermeslogo} alt="Hermes" className="boot-logo" />
            <div className="boot-spinner" aria-hidden="true" />
            <p className="boot-text">Checking installation…</p>
          </div>
        );
      case "welcome":
        return (
          <Welcome
            error={installError}
            connectionMode={connectionMode}
            onStart={handleRetryInstall}
            onRecheck={handleRecheck}
            onSwitchToLocal={handleSwitchToLocal}
          />
        );
      case "installing":
        return (
          <Install
            onComplete={handleInstallComplete}
            onFailed={handleInstallFailed}
            onCancel={() => setScreen("welcome")}
          />
        );
      case "setup":
        return (
          <Setup
            onComplete={handleSetupComplete}
            verifyWarning={verifyWarning}
            onReinstall={handleVerifyReinstall}
            onDismissVerifyWarning={handleDismissVerifyWarning}
          />
        );
      case "onboarding":
        return (
          <Onboarding
            connectionMode={connectionMode}
            onFinish={finishOnboarding}
            onConfigure={configureFromOnboarding}
          />
        );
      case "main":
        // SPS Agent IS the desktop application — it replaces the former Hermes
        // Agent Desktop UI (Layout). Onboarding (install/setup) still runs first
        // because the SPS assistant talks to the Hermes gateway it configures.
        // The gear / ⌘, opens the SPS control screens (Providers, Connections,
        // Models, Settings, …) as an overlay so config stays reachable.
        return (
          <>
            <SpsAgent />
            {/* No floating gear — the SPS sidebar's "Settings" item (and ⌘,) open
                this overlay via the `hermes:open-settings` event, so the trigger
                stays in the layout instead of floating over the workspace. */}
            {adminOpen && (
              <div
                className="sps-admin-overlay"
                ref={adminOverlayRef}
                role="dialog"
                aria-modal="true"
                aria-label="SPS Control Center"
              >
                <button
                  className="sps-admin-back"
                  onClick={() => setAdminOpen(false)}
                >
                  ← Back to workspace
                </button>
                <button
                  className="sps-admin-close"
                  onClick={() => setAdminOpen(false)}
                  title="Close (Esc)"
                  aria-label="Close settings"
                >
                  ✕
                </button>
                <Layout
                  initialView={adminInitialView}
                  verifyWarning={verifyWarning}
                  onReinstall={handleVerifyReinstall}
                  onDismissVerifyWarning={handleDismissVerifyWarning}
                />
              </div>
            )}
          </>
        );
    }
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <div className="app">
          {isMac && <div className="drag-region" />}
          <div className="app-content">{renderScreen()}</div>
        </div>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
