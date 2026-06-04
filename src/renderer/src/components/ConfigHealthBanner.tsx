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
  onOpenDiagnose?: () => void;
}

interface Report {
  profile?: string;
  issues: { severity: "error" | "warning" | "info" }[];
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

export function ConfigHealthBanner({
  profile,
  onOpenDiagnose,
}: ConfigHealthBannerProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [report, setReport] = useState<(Report & { ranAt: number }) | null>(
    null,
  );

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
  const summary = summaryParts.join(", ");

  return (
    <div
      className={`config-health-banner config-health-banner-${worstSeverity}`}
      role="status"
      data-testid="config-health-banner"
    >
      <span className="config-health-banner-text">
        {t("diagnose.banner.lead")} {summary}.
      </span>
      <div className="config-health-banner-actions">
        {onOpenDiagnose && (
          <button
            className="config-health-banner-link"
            type="button"
            onClick={onOpenDiagnose}
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
  );
}

export default ConfigHealthBanner;
