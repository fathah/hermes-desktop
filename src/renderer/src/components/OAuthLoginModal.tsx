import { useState, useEffect, useRef } from "react";
import { X } from "../assets/icons";
import { useI18n } from "./useI18n";

interface OAuthLoginModalProps {
  provider: string;
  providerLabel: string;
  profile?: string;
  onClose: () => void;
}

type Status = "running" | "success" | "error";

/**
 * Drives an interactive OAuth sign-in for a subscription provider.
 * Spawns `hermes auth add <provider> --type oauth` in the main process,
 * streams the CLI output here, and reports success/failure. The CLI
 * opens the system browser for the consent step.
 */
function OAuthLoginModal({
  provider,
  providerLabel,
  profile,
  onClose,
}: OAuthLoginModalProps): React.JSX.Element {
  const { t } = useI18n();
  const [log, setLog] = useState("");
  const [status, setStatus] = useState<Status>("running");
  const [error, setError] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  // The login subprocess is single-flight in the main process. React
  // StrictMode (dev) double-invokes effects, so guard against firing a
  // second `oauthLogin` that would just bounce off that guard.
  const startedRef = useRef(false);

  useEffect(() => {
    const cleanup = window.hermesAPI.onOAuthLoginProgress((chunk) => {
      setLog((prev) => prev + chunk);
    });
    if (!startedRef.current) {
      startedRef.current = true;
      window.hermesAPI
        .oauthLogin(provider, profile)
        .then((res) => {
          if (res.success) {
            setStatus("success");
          } else {
            setStatus("error");
            setError(res.error || t("providers.oauth.failed"));
          }
        })
        .catch((err: unknown) => {
          setStatus("error");
          setError((err as Error)?.message || t("providers.oauth.failed"));
        });
    }
    return cleanup;
  }, [provider, profile, t]);

  // Keep the streamed log scrolled to the newest line.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  function handleClose(): void {
    // Abandoning a flow mid-OAuth: tell main to kill the CLI subprocess
    // so its loopback redirect server doesn't linger.
    if (status === "running") {
      void window.hermesAPI.cancelOAuthLogin();
    }
    onClose();
  }

  return (
    <div className="models-modal-overlay" onClick={handleClose}>
      <div className="models-modal" onClick={(e) => e.stopPropagation()}>
        <div className="models-modal-header">
          <h2 className="models-modal-title">
            {t("providers.oauth.signIn")} — {providerLabel}
          </h2>
          <button
            className="btn-ghost"
            onClick={handleClose}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="models-modal-body">
          {status === "running" && (
            <p className="oauth-login-status">
              {t("providers.oauth.runningHint")}
            </p>
          )}
          {status === "success" && (
            <div className="oauth-login-result oauth-login-result-success">
              ✓&nbsp;{t("providers.oauth.successHint")}
            </div>
          )}
          {status === "error" && (
            <div className="oauth-login-result oauth-login-result-error">
              ✗&nbsp;{error}
            </div>
          )}
          {log && (
            <pre className="settings-hermes-doctor" ref={logRef}>
              {log}
            </pre>
          )}
        </div>
        <div className="models-modal-footer">
          <button className="btn btn-primary btn-sm" onClick={handleClose}>
            {status === "running" ? t("common.cancel") : t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OAuthLoginModal;
