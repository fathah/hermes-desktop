import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Keep loading/clean status visible when opened from the warning banner. */
  showStatus?: boolean;
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

export function ConfigHealth(props: ConfigHealthProps): React.JSX.Element {
  return <ConfigHealthReport key={props.profile || "default"} {...props} />;
}

function ConfigHealthReport({
  profile,
  showStatus = false,
}: ConfigHealthProps): React.JSX.Element {
  const { t } = useI18n();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fixingCode, setFixingCode] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const request = useRef(0);
  const busy = useRef(false);

  const load = useCallback(
    async (refresh = false): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      const id = ++request.current;
      setLoading(true);
      setError(false);
      try {
        const next = (await (refresh
          ? window.hermesAPI.rerunConfigHealth(profile)
          : window.hermesAPI.getConfigHealth(profile))) as Report;
        if (id !== request.current) return;
        setReport(next);
        publishConfigHealthReport(next);
        setResults({});
      } catch {
        if (id === request.current) setError(true);
      } finally {
        if (id === request.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [profile],
  );

  const invalidate = useCallback(() => {
    ++request.current;
    busy.current = false;
  }, []);

  useEffect(() => {
    void load();
    return invalidate;
  }, [load, invalidate]);

  const fix = useCallback(
    async (issue: Issue): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      const id = ++request.current;
      setFixingCode(issue.code);
      setError(false);
      try {
        const res = await window.hermesAPI.autofixConfigIssue(
          issue.code,
          profile,
          issue.context,
        );
        if (id === request.current) {
          setResults((prev) => ({
            ...prev,
            [issue.code]:
              res.message ||
              (res.ok ? t("diagnose.fix.success") : t("diagnose.fix.failure")),
          }));
        }
        if (res.ok) {
          // A successful mutation followed by a failed audit must remain visible.
          try {
            const next = (await window.hermesAPI.rerunConfigHealth(
              profile,
            )) as Report;
            // The mutation outlives the pane. Refresh profile-scoped observers
            // even after navigation, while suppressing obsolete local state.
            publishConfigHealthReport(next);
            if (id === request.current) setReport(next);
          } catch {
            if (id === request.current) setError(true);
          }
        }
      } catch {
        if (id === request.current) {
          setResults((prev) => ({
            ...prev,
            [issue.code]: t("diagnose.fix.failure"),
          }));
        }
      } finally {
        if (id === request.current) {
          busy.current = false;
          setFixingCode(null);
        }
      }
    },
    [profile, t],
  );

  // Keep the normal About page quiet, but always explain the result of an
  // explicit Show details action (including a now-clean or failed audit).
  if (!showStatus && !error && (!report || report.issues.length === 0)) {
    return <></>;
  }

  return (
    <div className="settings-section diagnose-section">
      <div className="diagnose-header">
        <h3 className="settings-section-title">{t("diagnose.title")}</h3>
        <button
          className="diagnose-rerun-btn"
          type="button"
          onClick={() => void load(true)}
          disabled={loading || fixingCode !== null}
          aria-label={t("diagnose.rerun")}
        >
          <RefreshCw size={14} />
          {t("diagnose.rerun")}
        </button>
      </div>

      <p className="settings-section-description">
        {t("diagnose.description")}
      </p>

      {loading && <p role="status">{t("common.loading")}</p>}
      {error && <p role="alert">{t("common.errorMessage")}</p>}
      {!loading && !error && report?.issues.length === 0 && (
        <p role="status">{t("diagnose.allGood")}</p>
      )}
      <ul className="diagnose-issue-list">
        {report?.issues.map((issue, idx) => (
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
                  disabled={loading || fixingCode !== null}
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
