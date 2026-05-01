import { useEffect, useState, useRef } from "react";
import { ArrowRight, Copy } from "../../assets/icons";

interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

interface InstallProps {
  onComplete: () => void;
  onFailed: (error: string) => void;
}

function Install({ onComplete, onFailed }: InstallProps): React.JSX.Element {
  const [progress, setProgress] = useState<InstallProgress>({
    step: 0,
    totalSteps: 7,
    title: "Preparing...",
    detail: "Starting installation",
    log: "",
  });
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    const cleanup = window.hermesAPI.onInstallProgress((p) => {
      if (isMounted) setProgress(p);
    });

    window.hermesAPI
      .startInstall()
      .then((result) => {
        if (!isMounted) return;
        if (result.success) {
          setDone(true);
        } else {
          setFailed(
            result.error ||
              "Installation failed. Please try again or install via terminal.",
          );
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setFailed(
          err.message ||
            "Installation failed. Please try again or install via terminal.",
        );
      });

    return () => {
      isMounted = false;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progress.log]);

  function handleCopyLogs(): void {
    const text = `Installation Error:\n${failed}\n\n--- Full Log ---\n${progress.log}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const percent =
    progress.totalSteps > 0
      ? Math.round((progress.step / progress.totalSteps) * 100)
      : 0;

  return (
    <div className="screen install-screen">
      <h1 className="install-title">
        {done
          ? "Installation Complete"
          : failed
            ? "Installation Failed"
            : "Installing Hermes Agent"}
      </h1>

      <div className="install-progress-container">
        <div className="install-progress-bar">
          <div
            className={`install-progress-fill ${failed ? "install-progress-fill--error" : ""}`}
            style={{ width: `${done ? 100 : percent}%` }}
          />
        </div>
        <div className="install-percent">{done ? "100" : percent}%</div>
      </div>

      {failed && (
        <div className="install-error-banner">
          <p className="install-error-text">{failed}</p>
          <div className="install-error-actions">
            <button className="btn btn-primary btn-sm" onClick={() => {
              setFailed(null);
              setProgress({ step: 0, totalSteps: 7, title: "Preparing...", detail: "Starting installation", log: "" });
              // Re-trigger install via parent
              onFailed(failed);
            }}>
              Retry Installation
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleCopyLogs}>
              <Copy size={13} />
              {copied ? "Copied!" : "Copy Logs"}
            </button>
          </div>
        </div>
      )}

      {!done && !failed && (
        <div className="install-step-info">
          <div className="install-step-title">
            Step {progress.step}/{progress.totalSteps}: {progress.title}
          </div>
          <div className="install-step-detail">{progress.detail}</div>
        </div>
      )}

      <div className="install-log" ref={logRef}>
        {progress.log || "Waiting to start..."}
      </div>

      {done && (
        <div className="install-done">
          <button className="btn btn-primary" onClick={onComplete}>
            Continue to Setup
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export default Install;
