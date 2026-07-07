import { useEffect, useState } from "react";
import type {
  RoutinePanelStatus,
  RoutinesStatusReport,
} from "../../../../../shared/routines-status";

interface RoutinesStatusPanelProps {
  profile?: string;
  pendingApprovals?: number;
}

function formatWhen(value: string | number | null | undefined): string {
  if (!value) return "never";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "none recorded";
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

function statusLabel(status: RoutinePanelStatus): string {
  if (status === "failure") return "Failure";
  if (status === "warning") return "Attention";
  return "Healthy";
}

function attentionCount(
  report: RoutinesStatusReport,
  pendingApprovals: number,
): number {
  const routineFailures = report.updateRoutines.filter(
    (routine) =>
      routine.lastError ||
      routine.lastStatus === "failed" ||
      routine.lastStatus === "error",
  ).length;
  const jobFailures = report.ownerRoutineJobs.filter(
    (job) => job.lastError,
  ).length;
  const gatewayIssue =
    report.closedAppGateway &&
    !["healthy", "managed-by-desktop"].includes(report.closedAppGateway.status)
      ? 1
      : 0;
  const ownerDeliveryIssue = ["failed", "warning"].includes(
    report.ownerDelivery.status,
  )
    ? 1
    : 0;
  return (
    report.scheduler.skipCount +
    routineFailures +
    jobFailures +
    gatewayIssue +
    ownerDeliveryIssue +
    pendingApprovals
  );
}

export function RoutinesStatusPanel({
  profile = "default",
  pendingApprovals = 0,
}: RoutinesStatusPanelProps): React.JSX.Element {
  const [report, setReport] = useState<RoutinesStatusReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .getRoutinesStatus(profile)
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const count = report ? attentionCount(report, pendingApprovals) : 0;

  return (
    <section
      className="health-section"
      data-status={report?.status ?? "loading"}
    >
      <div className="health-sec-header">
        <span className="health-sec-label">Routines status</span>
        <span className="health-sec-count">{count}</span>
        <span className="health-sec-hint">
          {report ? statusLabel(report.status) : "Loading"}
        </span>
      </div>
      {error && <div className="health-error">{error}</div>}
      {!report && !error && <div className="health-sec-hint">Loading…</div>}
      {report && (
        <ul className="health-list">
          <li className="health-row">
            <span className="health-mono-text">Scheduler skips</span>
            <span className="health-arrow">·</span>
            <span>
              {report.scheduler.skipCount === 0
                ? "none"
                : `${report.scheduler.skipCount} recorded, latest ${formatWhen(
                    report.scheduler.lastSkipAt,
                  )}: ${report.scheduler.lastReason ?? "unknown"}`}
            </span>
          </li>
          <li className="health-row">
            <span className="health-mono-text">Pending approvals</span>
            <span className="health-arrow">·</span>
            <span>{pendingApprovals}</span>
          </li>
          {report.updateRoutines.map((routine) => (
            <li key={routine.id} className="health-row">
              <span className="health-mono-text">{routine.label}</span>
              <span className="health-arrow">·</span>
              <span>
                {routine.lastError ??
                  routine.lastStatus ??
                  (routine.enabled ? "not checked yet" : "disabled")}
              </span>
            </li>
          ))}
          <li className="health-row">
            <span className="health-mono-text">Closed-app gateway</span>
            <span className="health-arrow">·</span>
            <span>
              {report.closedAppGateway
                ? `${report.closedAppGateway.status}; outage ${formatDuration(
                    report.closedAppGateway.lastOutageMs,
                  )}`
                : "no closed-app checks recorded"}
            </span>
          </li>
          <li className="health-row">
            <span className="health-mono-text">Owner routines</span>
            <span className="health-arrow">·</span>
            <span>
              {report.ownerRoutineJobs.length === 0
                ? "not created yet"
                : report.ownerRoutineJobs
                    .map(
                      (job) =>
                        `${job.name.replace("owner-routine:", "")}: ${
                          job.lastError ?? job.lastStatus ?? job.state
                        }`,
                    )
                    .join(", ")}
            </span>
          </li>
          <li className="health-row">
            <span className="health-mono-text">Owner delivery</span>
            <span className="health-arrow">·</span>
            <span>{report.ownerDelivery.summary}</span>
          </li>
        </ul>
      )}
    </section>
  );
}
