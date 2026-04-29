import { useState, useEffect, useCallback } from "react";
import { ThemeProvider } from "./components/ThemeProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import Welcome from "./screens/Welcome/Welcome";
import Install from "./screens/Install/Install";
import Setup from "./screens/Setup/Setup";
import Layout from "./screens/Layout/Layout";
import SplashScreen from "./screens/SplashScreen/SplashScreen";
import { useI18n } from "./components/useI18n";

type Screen = "splash" | "welcome" | "installing" | "setup" | "main";

function App(): React.JSX.Element {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>("splash");
  const [installError, setInstallError] = useState<string | null>(null);
  const [nextScreen, setNextScreen] = useState<Screen | null>(null);
  const [splashDone, setSplashDone] = useState(false);
  const [installCompleted, setInstallCompleted] = useState(false);
  const isMac = window.electron?.process?.platform === "darwin";

  const runInstallCheck = useCallback(async () => {
    // Skip re-check if we just completed installation
    if (installCompleted) return;
    
    try {
      const conn = await window.hermesAPI.getConnectionConfig();

      // Remote mode: verify the remote server is reachable
      if (conn.mode === "remote" && conn.remoteUrl) {
        const ok = await window.hermesAPI.testRemoteConnection(
          conn.remoteUrl,
          conn.apiKey,
        );
        if (ok) {
          setNextScreen("main");
        } else {
          setInstallError(
            `Cannot reach remote Hermes at ${conn.remoteUrl}. Check the URL or switch to local mode.`,
          );
          setNextScreen("welcome");
        }
        return;
      }

      // Local mode: normal install check
      const status = await window.hermesAPI.checkInstall();
      if (!status.installed) {
        setNextScreen("welcome");
      } else if (!status.verified) {
        setInstallError(t("errors.installBroken"));
        setNextScreen("welcome");
      } else if (!status.hasApiKey) {
        setNextScreen("setup");
      } else {
        setNextScreen("main");
      }
    } catch {
      setNextScreen("welcome");
    }
  }, [t, installCompleted]);

  // Run install check during splash
  useEffect(() => {
    runInstallCheck();
  }, [runInstallCheck]);

  // Transition away from splash when both animation and install check are done
  useEffect(() => {
    if (splashDone && nextScreen) {
      setScreen(nextScreen);
    }
  }, [splashDone, nextScreen]);

  const handleSplashFinished = useCallback(() => {
    setSplashDone(true);
  }, []);

function handleInstallComplete(): void {
  console.log("Installation complete - navigating to setup");
  setInstallError(null);
  setInstallCompleted(true);
  // Go directly to setup without re-checking
  try {
    setScreen("setup");
  } catch (err) {
    console.error("Error setting screen to setup:", err);
  }
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
    setSplashDone(false);
    setNextScreen(null);
    runInstallCheck();
  }

  function renderScreen(): React.JSX.Element {
    switch (screen) {
      case "splash":
        return <SplashScreen onFinished={handleSplashFinished} />;
      case "welcome":
        return (
          <Welcome
            error={installError}
            onStart={handleRetryInstall}
            onRecheck={handleRecheck}
          />
        );
      case "installing":
        return (
          <Install
            onComplete={handleInstallComplete}
            onFailed={handleInstallFailed}
          />
        );
      case "setup":
        return <Setup onComplete={() => setScreen("main")} />;
      case "main":
        return <Layout />;
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
