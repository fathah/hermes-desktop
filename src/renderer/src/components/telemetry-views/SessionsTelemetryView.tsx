/**
 * Sessions tab in remote mode — recent sessions metadata driven
 * by GET /v1/telemetry/sessions. Message bodies stay on the server.
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { SessionsTelemetry } from "../../../../shared/telemetry-types";

function SessionsView({
  data,
}: {
  data: SessionsTelemetry;
}): React.JSX.Element {
  if (data.recent.length === 0) {
    return (
      <div className="telemetry-summary">
        <h2 className="telemetry-summary-title">
          Sessions — {data.totalCount} total
        </h2>
        <p className="telemetry-summary-hint">
          No sessions yet on this Hermes instance.
        </p>
      </div>
    );
  }
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">
        Sessions — {data.totalCount} total · {data.activeCount} active
      </h2>
      <table className="telemetry-schedules-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Model</th>
            <th>Source</th>
            <th>Messages</th>
            <th>Last active</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.recent.map((s) => (
            <tr key={s.id}>
              <td>{s.title || s.id}</td>
              <td>{s.model || "—"}</td>
              <td>{s.source || "—"}</td>
              <td>{s.messageCount}</td>
              <td>{s.lastActiveAt || s.startedAt || "—"}</td>
              <td>{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="telemetry-summary-hint">
        Read-only view. Message bodies live on the server. Use Chat to
        resume a session through the gateway.
      </p>
    </div>
  );
}

function SessionsTelemetryView(): React.JSX.Element {
  const state = useTelemetryQuery<SessionsTelemetry>(
    "sessions",
    () => window.hermesAPI.telemetry.sessions(20),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Sessions">
      {(data) => <SessionsView data={data} />}
    </TelemetryCard>
  );
}

export default SessionsTelemetryView;
