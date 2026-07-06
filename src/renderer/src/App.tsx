import { useState, useEffect, useCallback, useRef } from "react";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "./components/ThemeProvider";
import { FontProvider } from "./components/FontProvider";
import { ProfileModalProvider } from "./components/profile/ProfileModalProvider";
import { SettingsModalProvider } from "./components/settings/SettingsModalProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import Welcome from "./screens/Welcome/Welcome";
import Install from "./screens/Install/Install";
import Setup from "./screens/Setup/Setup";
import Layout from "./screens/Layout/Layout";
import SplashScreen from "./screens/SplashScreen/SplashScreen";
import { captureScreenView } from "./utils/analytics";

type Screen = "splash" | "welcome" | "installing" | "setup" | "main";

// Minimum time the splash stays visible so the background video plays
// through. Gateway / config checks happen during this window.
const SPLASH_MIN_MS = 3000;

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("splash");
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
  const [splashStatus, setSplashStatus] = useState<string | undefined>(
    undefined,
  );
  const isMac = window.electron?.process?.platform === "darwin";
  // Bumped on every runInstallCheck so a superseded run (e.g. the user hit
  // "Switch to local mode" while an SSH tunnel attempt was still in flight)
  // can't clobber the newer run's screen transition.
  const runIdRef = useRef(0);

  const runInstallCheck = useCallback(async () => {
    const myRun = ++runIdRef.current;
    const startedAt = Date.now();
    let next: Screen = "welcome";
    const error: string | null = null;
    let isRemote = false;

    try {
      setSplashStatus("Checking connection…");
      const conn = await window.hermesAPI.getConnectionConfig();
      isRemote = conn.mode === "remote" || conn.mode === "ssh";
      setConnectionMode(conn.mode);

      if (conn.mode === "ssh" && conn.ssh) {
        setSplashStatus("Starting SSH tunnel…");
        try {
          await window.hermesAPI.startSshTunnel();
        } catch (tunnelErr) {
          console.warn("SSH tunnel failed to start on launch:", tunnelErr);
        }
        next = "main";
      } else if (conn.mode === "remote" && conn.remoteUrl) {
        setSplashStatus("Testing remote connection…");
        const ok = await window.hermesAPI.testRemoteConnection(conn.remoteUrl);
        if (ok) {
          next = "main";
        } else {
          console.warn(`Cannot reach remote Hermes at ${conn.remoteUrl}.`);
          next = "main";
        }
      } else {
        setSplashStatus("Checking local install…");
        const status = await window.hermesAPI.checkInstall();
        if (!status.installed) {
          next = "welcome";
        } else if (!status.hasApiKey) {
          next = "setup";
        } else {
          next = "main";
        }

        // Warm config-health and gateway status in the background while the
        // splash is still visible so the first render is snappy. Cap at 800ms
        // so it never pushes us past the 3s minimum.
        if (next === "main") {
          setSplashStatus("Checking configuration…");
          await Promise.race([
            Promise.all([
              window.hermesAPI
                .getConfigHealth()
                .catch(() => null)
                .then(() => undefined),
              window.hermesAPI
                .gatewayStatus()
                .catch(() => null)
                .then(() => undefined),
            ]),
            new Promise<void>((r) => setTimeout(r, 800)),
          ]);
        }
      }
    } catch {
      next = "welcome";
    }

    // Abandoned by a newer run (the user switched modes mid-connect) — leave
    // all screen/status state to that run.
    if (myRun !== runIdRef.current) return;

    setSplashStatus(undefined);
    if (error) setInstallError(error);

    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    if (myRun !== runIdRef.current) return;
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

  const handleSplashFinished = useCallback(() => {
    /* splash transition is driven by the install check, not a timer */
  }, []);

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
    setScreen("splash");
    runInstallCheck();
  }

  async function handleSwitchToLocal(): Promise<void> {
    // Tear down any in-flight SSH tunnel so a hung connect attempt doesn't keep
    // running (or race the local recheck) after we switch.
    await window.hermesAPI.stopSshTunnel().catch(() => undefined);
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
      case "splash":
        return (
          <SplashScreen
            onFinished={handleSplashFinished}
            status={splashStatus}
            onSwitchToLocal={
              connectionMode !== "local" ? handleSwitchToLocal : undefined
            }
          />
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
            onComplete={() => setScreen("main")}
            verifyWarning={verifyWarning}
            onReinstall={handleVerifyReinstall}
            onDismissVerifyWarning={handleDismissVerifyWarning}
          />
        );
      case "main":
        return (
          <Layout
            verifyWarning={verifyWarning}
            onReinstall={handleVerifyReinstall}
            onDismissVerifyWarning={handleDismissVerifyWarning}
          />
        );
    }
  }

  return (
    <ThemeProvider>
      <FontProvider>
        <ProfileModalProvider>
          <SettingsModalProvider>
            <ErrorBoundary>
              <div className={`app${isMac ? " is-mac" : ""}`}>
                {isMac && <div className="drag-region" />}
                <div className="app-content">{renderScreen()}</div>
              </div>
              <Toaster
                position="bottom-right"
                reverseOrder={false}
                toastOptions={{
                  style: {
                    background: "var(--bg-elevated)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-bright)",
                    fontSize: 13,
                  },
                }}
              />
            </ErrorBoundary>
          </SettingsModalProvider>
        </ProfileModalProvider>
      </FontProvider>
    </ThemeProvider>
  );
}

export default App;
