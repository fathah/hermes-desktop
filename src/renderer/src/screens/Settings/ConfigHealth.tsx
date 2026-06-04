import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../components/useI18n";
import { CONFIG_HEALTH_UPDATED_EVENT } from "../../components/ConfigHealthBanner";
import {
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

/**
 * Diagnose pane: full config-health report with per-issue auto-fix
 * actions. Reachable from Settings → Diagnose, and also as a direct
 * navigation target when the user clicks the ConfigHealthBanner.
 *
 * All actions are explicit (no "Fix all" by default) — the user sees
 * what each fix will do before confirming. Auto-fix results are
 * announced inline and the report is re-run after each fix so the
 * user can verify the issue is gone.
 */

interface Issue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
  locations: string[];
  autoFixable: boolean;
  fixDescription?: string;
  fixLocation?: string;
  context?: Record<string, string>;
}

interface Report {
  ranAt: number;
  profile: string;
  issues: Issue[];
  summary: { errors: number; warnings: number; infos: number };
}

interface ConfigHealthProps {
  profile?: string;
}

function publishConfigHealthReport(report: Report): void {
  window.dispatchEvent(
    new CustomEvent(CONFIG_HEALTH_UPDATED_EVENT, { detail: report }),
  );
}

function SeverityIcon({
  severity,
}: {
  severity: "error" | "warning" | "info";
}): React.JSX.Element {
  if (severity === "error")
    return <AlertCircle size={16} className="diag-icon-error" />;
  if (severity === "warning")
    return <AlertTriangle size={16} className="diag-icon-warning" />;
  return <CheckCircle size={16} className="diag-icon-info" />;
}

export function ConfigHealth({
  profile,
}: ConfigHealthProps): React.JSX.Element {
  const { t } = useI18n();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [fixingCode, setFixingCode] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const r = (await window.hermesAPI.getConfigHealth(profile)) as Report;
      setReport(r);
      publishConfigHealthReport(r);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const rerun = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const r = (await window.hermesAPI.rerunConfigHealth(profile)) as Report;
      setReport(r);
      publishConfigHealthReport(r);
      setResults({});
    } finally {
      setLoading(false);
    }
  }, [profile]);

  const fix = useCallback(
    async (issue: Issue): Promise<void> => {
      setFixingCode(issue.code);
      try {
        const res = await window.hermesAPI.autofixConfigIssue(
          issue.code,
          profile,
          issue.context,
        );
        setResults((prev) => ({
          ...prev,
          [issue.code]:
            res.message ||
            (res.ok ? t("diagnose.fix.success") : t("diagnose.fix.failure")),
        }));
        if (res.ok) {
          // Re-run so the issue disappears from the list when fixed
          const r = (await window.hermesAPI.rerunConfigHealth(
            profile,
          )) as Report;
          setReport(r);
          publishConfigHealthReport(r);
        }
      } finally {
        setFixingCode(null);
      }
    },
    [profile, t],
  );

  // Only surface this section when the audit actually found something to act
  // on. A clean config needs no UI here — the "all good" state is just noise in
  // Settings, and any real issue is still announced separately via the
  // ConfigHealthBanner. While loading (or on a failed/empty report) we render
  // nothing so the section never flashes in for a healthy config.
  if (loading || !report || report.issues.length === 0) {
    return <></>;
  }

  return (
    <div className="settings-section diagnose-section">
      <div className="diagnose-header">
        <h3 className="settings-section-title">{t("diagnose.title")}</h3>
        <button
          className="diagnose-rerun-btn"
          type="button"
          onClick={rerun}
          disabled={loading}
          aria-label={t("diagnose.rerun")}
        >
          <RefreshCw size={14} />
          {t("diagnose.rerun")}
        </button>
      </div>

      <p className="settings-section-description">
        {t("diagnose.description")}
      </p>

      <ul className="diagnose-issue-list">
        {report.issues.map((issue, idx) => (
          <li
            key={`${issue.code}-${idx}`}
            className={`diagnose-issue diagnose-issue-${issue.severity}`}
          >
            <div className="diagnose-issue-head">
              <SeverityIcon severity={issue.severity} />
              <span className="diagnose-issue-code">{issue.code}</span>
            </div>
            <p className="diagnose-issue-message">{issue.message}</p>
            {issue.detail && (
              <p className="diagnose-issue-detail">{issue.detail}</p>
            )}
            {issue.locations.length > 0 && (
              <ul className="diagnose-issue-locations">
                {issue.locations.map((loc) => (
                  <li key={loc}>{loc}</li>
                ))}
              </ul>
            )}
            {issue.autoFixable && issue.fixDescription && (
              <div className="diagnose-issue-fix">
                <button
                  className="diagnose-fix-btn"
                  type="button"
                  onClick={() => fix(issue)}
                  disabled={fixingCode !== null}
                >
                  {fixingCode === issue.code
                    ? t("diagnose.fix.running")
                    : t("diagnose.fix.apply")}
                </button>
                <span className="diagnose-issue-fix-desc">
                  {issue.fixDescription}
                </span>
              </div>
            )}
            {results[issue.code] && (
              <p className="diagnose-issue-result">{results[issue.code]}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ConfigHealth;
