import { useState, useEffect, useCallback } from "react";
import { ThemeProvider } from "./components/ThemeProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import Welcome from "./screens/Welcome/Welcome";
import Install from "./screens/Install/Install";
import Setup from "./screens/Setup/Setup";
import SpsAgent from "./screens/SpsAgent/SpsAgent";
import Layout from "./screens/Layout/Layout";
import { captureScreenView } from "./utils/analytics";

// "loading" is a neutral blank shown only while the async install check runs;
// it replaces the former branded splash screen.
type Screen = "loading" | "welcome" | "installing" | "setup" | "main";

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("loading");
  const [installError, setInstallError] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<
    "local" | "remote" | "ssh"
  >("local");
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
  const isMac = window.electron?.process?.platform === "darwin";

  // Expose the platform so CSS can reserve room for the macOS traffic-light
  // buttons (hiddenInset title bar) above the sidebar header.
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-platform",
      isMac ? "mac" : "other",
    );
  }, [isMac]);

  // ⌘, (mac) / Ctrl+, toggles the admin overlay, only once on the main screen.
  useEffect(() => {
    if (screen !== "main") return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setAdminOpen((open) => !open);
      } else if (e.key === "Escape") {
        setAdminOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  const runInstallCheck = useCallback(async () => {
    let next: Screen = "welcome";
    let error: string | null = null;
    let isRemote = false;

    try {
      const conn = await window.hermesAPI.getConnectionConfig();
      isRemote = conn.mode === "remote" || conn.mode === "ssh";
      setConnectionMode(conn.mode);

      if (conn.mode === "ssh" && conn.ssh) {
        // Start (or ensure) the SSH tunnel, then go straight to main
        try {
          await window.hermesAPI.startSshTunnel();
          next = "main";
        } catch (tunnelErr) {
          error = `SSH tunnel failed to start: ${(tunnelErr as Error).message}`;
          next = "welcome";
        }
      } else if (conn.mode === "remote" && conn.remoteUrl) {
        const ok = await window.hermesAPI.testRemoteConnection(conn.remoteUrl);
        if (ok) {
          next = "main";
        } else {
          error = `Cannot reach remote Hermes at ${conn.remoteUrl}. Check the URL or switch to local mode.`;
          next = "welcome";
        }
      } else {
        const status = await window.hermesAPI.checkInstall();
        if (!status.installed) {
          next = "welcome";
        } else if (!status.hasApiKey) {
          next = "setup";
        } else {
          next = "main";
        }
      }
    } catch {
      next = "welcome";
    }

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
    if ((next === "main" || next === "setup") && !isRemote) {
      window.hermesAPI.verifyInstall().then((ok) => {
        // Files exist (checkInstall passed) but the probe failed. Surface
        // a soft warning instead of bouncing to Welcome — see #130.
        if (!ok) setVerifyWarning(true);
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
    setInstallError(null);
    setScreen("installing");
  }

  function handleRecheck(): void {
    setInstallError(null);
    setScreen("loading");
    runInstallCheck();
  }

  async function handleSwitchToLocal(): Promise<void> {
    await window.hermesAPI.setConnectionConfig("local", "", "");
    setConnectionMode("local");
    handleRecheck();
  }

  function handleVerifyReinstall(): void {
    setVerifyWarning(false);
    setInstallError(null);
    setScreen("installing");
  }

  function handleDismissVerifyWarning(): void {
    setVerifyWarning(false);
  }

  function renderScreen(): React.JSX.Element {
    switch (screen) {
      case "loading":
        return <div className="boot-screen" />;
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
            onComplete={() => setScreen("main")}
            verifyWarning={verifyWarning}
            onReinstall={handleVerifyReinstall}
            onDismissVerifyWarning={handleDismissVerifyWarning}
          />
        );
      case "main":
        // SPS Agent IS the desktop application — it replaces the former Hermes
        // Agent Desktop UI (Layout). Onboarding (install/setup) still runs first
        // because the SPS assistant talks to the Hermes gateway it configures.
        // The gear / ⌘, opens the Hermes admin screens (Providers, Gateway,
        // Models, Settings, …) as an overlay so config stays reachable.
        return (
          <>
            <SpsAgent />
            <button
              className="sps-admin-gear"
              onClick={() => setAdminOpen(true)}
              title="Settings (⌘,)"
              aria-label="Open settings"
            >
              ⚙
            </button>
            {adminOpen && (
              <div className="sps-admin-overlay">
                <button
                  className="sps-admin-close"
                  onClick={() => setAdminOpen(false)}
                  title="Close (Esc)"
                  aria-label="Close settings"
                >
                  ✕
                </button>
                <Layout
                  initialView="settings"
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
