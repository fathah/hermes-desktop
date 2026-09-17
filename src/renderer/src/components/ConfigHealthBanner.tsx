import { useEffect, useState } from "react";
import { useI18n } from "./useI18n";
import { X } from "lucide-react";

/**
 * Dismissible banner that surfaces config-health issues at the top of
 * the Chat tab. Renders nothing when the report has no issues or when
 * the user has already dismissed it for this session.
 *
 * Clicking "Show details" routes to Settings → Diagnose for the full
 * per-issue list + auto-fix controls. The banner itself only shows a
 * one-line summary count so it stays out of the user's way.
 */

interface ConfigHealthBannerProps {
  /** Active profile (forwarded to the audit IPC). */
  profile?: string;
  /** Open Settings → Diagnose section. */
  onOpenDiagnose?: (section?: string) => void;
}

interface Report {
  profile?: string;
  issues: { code: string; severity: "error" | "warning" | "info" }[];
  summary: { errors: number; warnings: number; infos: number };
}

const DISMISS_STORAGE_KEY = "hermes-config-health-dismissed";
export const CONFIG_HEALTH_UPDATED_EVENT = "hermes-config-health-updated";

function readDismissedReportStamp(): number {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function rememberDismiss(ranAt: number): void {
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, String(ranAt));
  } catch {
    // localStorage can be unavailable in some sandboxed renderers
  }
}

function isReportForProfile(
  report: (Report & { ranAt: number }) | null,
  profile?: string,
): boolean {
  if (!report) return false;
  const expected = profile || "default";
  return !report.profile || report.profile === expected;
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ConfigHealthBanner({
  profile,
  onOpenDiagnose,
}: ConfigHealthBannerProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [report, setReport] = useState<(Report & { ranAt: number }) | null>(
    null,
  );
  const [showModal, setShowModal] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const r = (await window.hermesAPI.getConfigHealth(profile)) as
          | (Report & { ranAt: number })
          | null;
        if (!cancelled) setReport(r);
      } catch {
        // Silent — config-health is best-effort. No banner if it fails.
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    const onConfigHealthUpdated = (event: Event): void => {
      const next = (event as CustomEvent<Report & { ranAt: number }>).detail;
      if (isReportForProfile(next, profile)) {
        setReport(next);
      }
    };

    window.addEventListener(CONFIG_HEALTH_UPDATED_EVENT, onConfigHealthUpdated);
    return (): void => {
      window.removeEventListener(
        CONFIG_HEALTH_UPDATED_EVENT,
        onConfigHealthUpdated,
      );
    };
  }, [profile]);

  if (!report || report.issues.length === 0) return null;

  // Only surface the banner for errors/warnings. Info-level issues are
  // visible in Settings → Diagnose but don't demand attention in the
  // chat header (avoids "Configuration issues detected: 1 note(s)" noise
  // when the user is running without API_SERVER_KEY or has harmless drift).
  if (report.summary.errors === 0 && report.summary.warnings === 0) {
    return null;
  }

  const dismissedAt = readDismissedReportStamp();
  if (dismissedAt >= report.ranAt) return null;

  // Severity → CSS class. The banner takes on the worst severity's
  // colour so the user sees error-level issues at a glance.
  const worstSeverity = report.summary.errors
    ? "error"
    : report.summary.warnings
      ? "warning"
      : "info";

  const summaryParts: string[] = [];
  if (report.summary.errors) {
    summaryParts.push(
      t("diagnose.banner.errors", { count: report.summary.errors }),
    );
  }
  if (report.summary.warnings) {
    summaryParts.push(
      t("diagnose.banner.warnings", { count: report.summary.warnings }),
    );
  }
  if (report.summary.infos && summaryParts.length === 0) {
    summaryParts.push(
      t("diagnose.banner.infos", { count: report.summary.infos }),
    );
  }
  const hasEmptyApiKey = report.issues.some(
    (i) => i.code === "EMPTY_API_SERVER_KEY",
  );
  const onlyEmptyApiKey =
    hasEmptyApiKey &&
    report.issues.length === 1 &&
    report.summary.errors === 0 &&
    report.summary.warnings === 1;

  const summary = summaryParts.join(", ");

  async function handleSaveApiKey(): Promise<void> {
    if (!apiKeyValue.trim()) return;
    setSaving(true);
    try {
      await window.hermesAPI.setEnv(
        "API_SERVER_KEY",
        apiKeyValue.trim(),
        profile,
      );
      // Re-run the health check so the banner disappears.
      const r = (await window.hermesAPI.rerunConfigHealth(profile)) as
        | (Report & { ranAt: number })
        | null;
      setReport(r);
      setShowModal(false);
      setApiKeyValue("");
    } catch {
      // Silently fail; the user can retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className={`config-health-banner config-health-banner-${worstSeverity}`}
        role="status"
        data-testid="config-health-banner"
      >
        <span className="config-health-banner-text">
          {onlyEmptyApiKey
            ? t("diagnose.apiKeyBanner.lead")
            : `${t("diagnose.banner.lead")} ${summary}.`}
        </span>
        <div className="config-health-banner-actions">
          {hasEmptyApiKey && (
            <button
              className="config-health-banner-link"
              type="button"
              onClick={() => setShowModal(true)}
            >
              {t("diagnose.apiKeyBanner.setNow")}
            </button>
          )}
          {onOpenDiagnose && (
            <button
              className="config-health-banner-link"
              type="button"
              onClick={() => onOpenDiagnose("diagnose")}
            >
              {t("diagnose.banner.showDetails")}
            </button>
          )}
          <button
            className="config-health-banner-dismiss"
            type="button"
            aria-label={t("common.dismiss")}
            onClick={() => {
              rememberDismiss(report.ranAt);
              setReport(null);
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {showModal && (
        <div
          className="models-modal-overlay"
          onClick={() => setShowModal(false)}
        >
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {t("diagnose.apiKeyModal.title")}
              </h2>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setShowModal(false)}
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="models-modal-body">
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  margin: 0,
                }}
              >
                {t("diagnose.apiKeyModal.description")}
              </p>
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("diagnose.apiKeyModal.label")}
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    className="input"
                    value={apiKeyValue}
                    onChange={(e) => setApiKeyValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveApiKey();
                    }}
                    placeholder={t("diagnose.apiKeyModal.placeholder")}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => setApiKeyValue(generateUUID())}
                  >
                    {t("diagnose.apiKeyModal.autoGenerate")}
                  </button>
                </div>
                <span className="models-modal-hint">
                  {t("diagnose.apiKeyModal.hint")}
                </span>
              </div>
            </div>
            <div className="models-modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => setShowModal(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={!apiKeyValue.trim() || saving}
                onClick={() => void handleSaveApiKey()}
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ConfigHealthBanner;
