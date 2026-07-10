import { useState, useEffect, useRef } from "react";
import { X, Check, Copy } from "../assets/icons";
import { useI18n } from "./useI18n";
import HermesLogo from "./common/HermesLogo";
import type {
  DeviceCodeInfo,
  HermesAccountUser,
} from "../../../shared/account";

interface HermesAccountModalProps {
  profile?: string;
  onClose: () => void;
  onSignedIn: (user: HermesAccountUser) => void;
}

type Status = "running" | "success" | "error";

/**
 * Drives the Hermes One account device-login (RFC 8628). The main process
 * requests a code, opens the browser to the approval page, and polls for the
 * token; this modal shows the user_code to confirm — with a loader spinning
 * around the brand mark while it waits — and reports the result.
 */
function HermesAccountModal({
  profile,
  onClose,
  onSignedIn,
}: HermesAccountModalProps): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("running");
  const [error, setError] = useState("");
  const [code, setCode] = useState<DeviceCodeInfo | null>(null);
  const [copied, setCopied] = useState(false);
  // Guard the single-flight login against React StrictMode's double effect.
  const startedRef = useRef(false);
  // Keep the latest onSignedIn without re-subscribing the IPC listeners.
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  useEffect(() => {
    const offCode = window.hermesAPI.onAccountLoginCode((info) =>
      setCode(info),
    );
    if (!startedRef.current) {
      startedRef.current = true;
      window.hermesAPI
        .accountLogin(profile)
        .then((res) => {
          if (res.success && res.user) {
            setStatus("success");
            onSignedInRef.current(res.user);
            // First cloud-agent sync right at sign-in; the Agents screen
            // hears about it via the agent-sync-updated event.
            void window.hermesAPI.syncAgents?.().catch(() => {});
          } else {
            setStatus("error");
            setError(res.error || t("providers.hermesAccount.failed"));
          }
        })
        .catch((err: unknown) => {
          setStatus("error");
          setError(
            (err as Error)?.message || t("providers.hermesAccount.failed"),
          );
        });
    }
    return offCode;
  }, [profile, t]);

  function handleClose(): void {
    // Abandoning mid-flow: stop the polling loop in the main process.
    if (status === "running") void window.hermesAPI.cancelAccountLogin();
    onClose();
  }

  function copyCode(): void {
    if (!code) return;
    navigator.clipboard
      .writeText(code.userCode)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard unavailable (e.g. permission denied) — don't claim "Copied".
      });
  }

  const subtitle =
    status === "error"
      ? error
      : status === "success"
        ? t("providers.hermesAccount.successHint")
        : t("providers.hermesAccount.codeHint");

  const footerStatus =
    status === "running"
      ? t("providers.hermesAccount.waitingHint")
      : status === "success"
        ? t("providers.hermesAccount.signedIn")
        : t("providers.hermesAccount.failed");

  return (
    <div className="models-modal-overlay" onClick={handleClose}>
      <div className="hermes-signin-modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="hermes-signin-close"
          onClick={handleClose}
          aria-label={t("common.close")}
        >
          <X size={18} />
        </button>

        <div className="hermes-signin-emblem">
          {status === "running" && (
            <span className="hermes-signin-ring" aria-hidden="true" />
          )}
          {status === "success" ? (
            <span className="hermes-signin-bolt">
              <Check size={26} />
            </span>
          ) : status === "error" ? (
            <span className="hermes-signin-bolt">
              <X size={26} />
            </span>
          ) : (
            // The mark asset is a black tile with padding; clip it to a disc and
            // scale it up so the mark fills the emblem with no surrounding gap.
            <span className="hermes-signin-mark">
              <HermesLogo size={92} />
            </span>
          )}
        </div>

        <h2 className="hermes-signin-title">
          {t("providers.hermesAccount.modalTitle")}
        </h2>
        <p className="hermes-signin-subtitle">{subtitle}</p>

        {status === "running" && code && (
          <>
            <div className="hermes-signin-code">{code.userCode}</div>
            <button className="hermes-signin-copy" onClick={copyCode}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              <span>
                {copied
                  ? t("providers.hermesAccount.copied")
                  : t("providers.hermesAccount.copyCode")}
              </span>
            </button>
          </>
        )}

        <div className="hermes-signin-footer">
          <span className="hermes-signin-footer-status">{footerStatus}</span>
          <button className="hermes-signin-cancel" onClick={handleClose}>
            {status === "running" ? t("common.cancel") : t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default HermesAccountModal;
