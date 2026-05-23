/**
 * Schedules tab in remote mode — read-only cron job summary
 * driven by GET /v1/telemetry/schedules.
 *
 * Job *payloads* (prompts) are intentionally not returned by the
 * backend — only structural metadata reaches the renderer.
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { SchedulesTelemetry } from "../../../../shared/telemetry-types";

function SchedulesView({
  data,
}: {
  data: SchedulesTelemetry;
}): React.JSX.Element {
  if (data.jobs.length === 0) {
    return (
      <div className="telemetry-summary">
        <h2 className="telemetry-summary-title">Schedules</h2>
        <p className="telemetry-summary-hint">
          No scheduled jobs configured on this Hermes instance.
        </p>
      </div>
    );
  }
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">Schedules</h2>
      <table className="telemetry-schedules-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Schedule</th>
            <th>Next run</th>
            <th>Last status</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {data.jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.name || job.id}</td>
              <td>{job.kind}</td>
              <td>
                <code>{job.schedule}</code>
              </td>
              <td>{job.nextRunAt || "—"}</td>
              <td>{job.lastStatus || "—"}</td>
              <td>{job.enabled ? "enabled" : "paused"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="telemetry-summary-hint">
        Read-only view. Manage jobs server-side with{" "}
        <code>hermes cron</code>.
      </p>
    </div>
  );
}

function SchedulesTelemetryView(): React.JSX.Element {
  const state = useTelemetryQuery<SchedulesTelemetry>(
    "schedules",
    () => window.hermesAPI.telemetry.schedules(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Schedules">
      {(data) => <SchedulesView data={data} />}
    </TelemetryCard>
  );
}

export default SchedulesTelemetryView;
