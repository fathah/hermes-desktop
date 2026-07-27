import { useEffect, useState, useRef } from "react";
import { ArrowRight, Copy, Send, Folder } from "../../assets/icons";
import OnboardHero from "../../components/common/OnboardHero";

const TELEGRAM_COMMUNITY_URL = "https://t.me/hermes_agent_desktop";
import { useI18n } from "../../components/useI18n";

// Small info glyph for the confirmation note card (no Info icon in the set).
function InfoIcon(): React.JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

interface InstallTarget {
  hermesHome: string;
  repoPath: string;
  state: "fresh" | "update" | "replace";
}

interface InstallProps {
  onComplete: () => void;
  onFailed: (error: string) => void;
  onCancel: () => void;
}

function Install({
  onComplete,
  onFailed,
  onCancel,
}: InstallProps): React.JSX.Element {
  const { t } = useI18n();
  // Gate the install behind an explicit confirmation so it can't run
  // silently and surprise a user who already has Hermes installed (#272).
  const [phase, setPhase] = useState<"confirm" | "running">("confirm");
  const [target, setTarget] = useState<InstallTarget | null>(null);
  const [useExistingError, setUseExistingError] = useState<string | null>(null);
  // Set once the user adopts an existing install — the new location only
  // applies on the next launch, so we ask them to restart.
  const [adopted, setAdopted] = useState(false);
  const [progress, setProgress] = useState<InstallProgress>({
    step: 0,
    totalSteps: 7,
    title: t("install.preparing"),
    detail: t("install.startingInstall"),
    log: "",
  });
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Inspect what the installer will do to the target directory, so the
  // confirmation can say exactly what to expect (fresh / update / replace).
  useEffect(() => {
    let mounted = true;
    window.hermesAPI
      .inspectInstallTarget()
      .then((info) => {
        if (mounted) setTarget(info);
      })
      .catch(() => {
        /* leave target null — the confirmation falls back to generic copy */
      });
    return () => {
      mounted = false;
    };
  }, []);

  // The install itself runs only once the user confirms.
  useEffect(() => {
    if (phase !== "running") return;
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
          setFailed(result.error || t("install.installationFailedHint"));
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setFailed(err.message || t("install.installationFailedHint"));
      });

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [phase]);

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

  // "Use an existing installation": let the user point the app at a Hermes
  // install it didn't auto-detect. A valid pick is persisted; the app must
  // restart to adopt it (#272).
  async function handleUseExisting(): Promise<void> {
    setUseExistingError(null);
    const dir = await window.hermesAPI.selectFolder();
    if (!dir) return;
    const ok = await window.hermesAPI.validateHermesHome(dir);
    if (!ok) {
      setUseExistingError(t("install.useExistingInvalid"));
      return;
    }
    const saved = await window.hermesAPI.adoptHermesHome(dir);
    if (saved) {
      setAdopted(true);
    } else {
      // Lost a race (dir changed between validate and adopt).
      setUseExistingError(t("install.useExistingInvalid"));
    }
  }

  const percent =
    progress.totalSteps > 0
      ? Math.round((progress.step / progress.totalSteps) * 100)
      : 0;

  if (phase === "confirm") {
    // After adopting an existing install, the choice only applies on the
    // next launch — ask the user to restart.
    if (adopted) {
      return (
        <OnboardHero eyebrow="SETUP" title={t("install.confirmTitle")}>
          <p className="onboard-subtitle">{t("install.useExistingDone")}</p>
          <div className="onboard-actions">
            <button
              className="onboard-btn onboard-btn-primary"
              onClick={() => window.hermesAPI.quitApp()}
            >
              {t("install.useExistingQuitBtn")}
            </button>
          </div>
        </OnboardHero>
      );
    }

    const stateMessage =
      target?.state === "update"
        ? t("install.confirmUpdate")
        : target?.state === "replace"
          ? t("install.confirmReplace")
          : t("install.confirmFresh");

    return (
      <OnboardHero eyebrow="SETUP" title={t("install.confirmTitle")}>
        <span className="onboard-field-label">
          {t("install.confirmLocationLabel")}
        </span>
        <div className="onboard-field">
          <Folder size={18} />
          <code data-selectable>{target?.repoPath || "…"}</code>
        </div>

        <div className="onboard-note-card">
          <InfoIcon />
          <div>
            <div className="onboard-note-card-title">{stateMessage}</div>
            <div className="onboard-note-card-sub">
              {t("install.confirmNotInherited")}
            </div>
          </div>
        </div>

        <div className="onboard-actions">
          <button
            className="onboard-btn onboard-btn-primary"
            onClick={() => setPhase("running")}
          >
            {t("install.confirmInstallBtn")}
          </button>
          <button
            className="onboard-btn onboard-btn-glass"
            onClick={handleUseExisting}
          >
            {t("install.useExistingBtn")}
          </button>
          <button className="onboard-btn onboard-btn-text" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>

        <p className="onboard-hint">{t("install.useExistingHint")}</p>
        {useExistingError && (
          <p className="onboard-error">{useExistingError}</p>
        )}
      </OnboardHero>
    );
  }

  const eyebrow = done ? "COMPLETE" : failed ? "ERROR" : "INSTALLING";
  const title = done
    ? t("install.installationComplete")
    : failed
      ? t("install.installationFailed")
      : t("install.installingHermes");

  return (
    <OnboardHero eyebrow={eyebrow} title={title} wide>
      <div className="onboard-progress">
        <div className="onboard-progress-head">
          <span className="onboard-progress-step">
            {done || failed ? (
              title
            ) : (
              <>
                <b>
                  Step {progress.step} of {progress.totalSteps}
                </b>{" "}
                · {progress.title}
              </>
            )}
          </span>
          <span className="onboard-progress-percent">
            {done ? 100 : percent}%
          </span>
        </div>
        <div className="onboard-progress-track">
          <div
            className={`onboard-progress-fill${failed ? " onboard-progress-fill--error" : ""}`}
            style={{ width: `${done ? 100 : percent}%` }}
          />
        </div>
        {!done && !failed && (
          <p className="onboard-progress-detail">{progress.detail}</p>
        )}
      </div>

      <div className="onboard-terminal">
        <div className="onboard-terminal-bar">
          <div className="onboard-terminal-dots">
            <span />
            <span />
            <span />
          </div>
          <span className="onboard-terminal-title">hermes-installer</span>
        </div>
        <div className="onboard-terminal-body" ref={logRef} data-selectable>
          {progress.log || t("install.waitingToStart")}
        </div>
      </div>

      {failed && (
        <div className="onboard-actions">
          <button
            className="onboard-btn onboard-btn-primary"
            onClick={() => {
              setFailed(null);
              setProgress({
                step: 0,
                totalSteps: 7,
                title: t("install.preparing"),
                detail: t("install.startingInstall"),
                log: "",
              });
              // Re-trigger install via parent
              onFailed(failed);
            }}
          >
            {t("install.retryInstallation")}
          </button>
          <button
            className="onboard-btn onboard-btn-glass"
            onClick={handleCopyLogs}
          >
            <Copy size={15} />
            {copied ? t("install.copied") : t("install.copyLogs")}
          </button>
          <button
            className="onboard-btn onboard-btn-glass"
            onClick={() =>
              window.hermesAPI.openExternal(TELEGRAM_COMMUNITY_URL)
            }
            title={TELEGRAM_COMMUNITY_URL}
          >
            <Send size={15} />
            Join Community
          </button>
        </div>
      )}

      {done && (
        <div className="onboard-actions">
          <button
            className="onboard-btn onboard-btn-primary"
            onClick={onComplete}
          >
            {t("install.continueToSetup")}
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {!done && !failed && (
        <button className="onboard-btn onboard-btn-text" onClick={onCancel}>
          {t("install.cancelInstallation")}
        </button>
      )}
    </OnboardHero>
  );
}

export default Install;
