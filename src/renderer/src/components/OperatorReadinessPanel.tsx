import { useEffect, useState } from "react";
import type {
  OperatorReadinessAction,
  OperatorReadinessItem,
  OperatorReadinessReport,
  OperatorReadinessStatus,
} from "../../../shared/operator-readiness";

interface OperatorReadinessPanelProps {
  profile?: string;
  title?: string;
  onAction: (action: OperatorReadinessAction) => void;
}

const STATUS_LABEL: Record<OperatorReadinessStatus, string> = {
  ready: "Ready",
  attention: "Attention",
  blocked: "Blocked",
};

function visibleItems(
  report: OperatorReadinessReport,
): OperatorReadinessItem[] {
  const needsWork = report.items.filter((item) => item.status !== "ready");
  return needsWork.length ? needsWork : report.items.slice(0, 3);
}

export function OperatorReadinessPanel({
  profile = "default",
  title = "Operator readiness",
  onAction,
}: OperatorReadinessPanelProps): React.JSX.Element {
  const [report, setReport] = useState<OperatorReadinessReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError("");

    void window.hermesAPI
      .getOperatorReadiness(profile)
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load readiness.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  return (
    <section className="operator-readiness-panel" aria-label={title}>
      <div className="operator-readiness-head">
        <div>
          <h2>{title}</h2>
          <p>{report ? report.summary : "Checking readiness..."}</p>
        </div>
        {report && (
          <span className={`operator-readiness-badge is-${report.status}`}>
            {STATUS_LABEL[report.status]}
          </span>
        )}
      </div>

      {error && <div className="operator-readiness-error">{error}</div>}
      {report && (
        <>
          <strong className="operator-readiness-headline">
            {report.headline}
          </strong>
          <div className="operator-readiness-items">
            {visibleItems(report).map((item) => (
              <div className="operator-readiness-item" key={item.id}>
                <div>
                  <span
                    className={`operator-readiness-dot is-${item.status}`}
                  />
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onAction(item.action)}
                >
                  {item.action.label}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
