/**
 * Profiles tab in remote mode — multi-instance profile list driven
 * by GET /v1/telemetry/profiles. Names / model / status only.
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { ProfilesTelemetry } from "../../../../shared/telemetry-types";

function ProfilesView({
  data,
}: {
  data: ProfilesTelemetry;
}): React.JSX.Element {
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">
        Profiles — active: <code>{data.active}</code>
      </h2>
      <ul className="telemetry-toolset-list">
        {data.profiles.map((p) => (
          <li key={p.name}>
            <div className="telemetry-toolset-row">
              <span className="telemetry-toolset-label">
                {p.name}
                {p.isDefault ? (
                  <span
                    className="telemetry-toolset-source"
                    style={{ marginLeft: 8 }}
                  >
                    default
                  </span>
                ) : null}
              </span>
              {p.isActive ? (
                <span className="telemetry-toolset-status enabled">
                  active
                </span>
              ) : (
                <span className="telemetry-toolset-status disabled">
                  inactive
                </span>
              )}
              <span className="telemetry-toolset-source">
                {p.gatewayRunning ? "gateway up" : "gateway down"}
              </span>
            </div>
            <p className="telemetry-toolset-desc">
              {p.model || "—"} via {p.provider || "—"} · {p.skillCount}{" "}
              skill{p.skillCount === 1 ? "" : "s"}
              {p.description ? ` · ${p.description}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="telemetry-summary-hint">
        Read-only view. Switch profile with <code>hermes -p &lt;name&gt;</code> server-side.
      </p>
    </div>
  );
}

function ProfilesTelemetryView(): React.JSX.Element {
  const state = useTelemetryQuery<ProfilesTelemetry>(
    "profiles",
    () => window.hermesAPI.telemetry.profiles(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Profiles">
      {(data) => <ProfilesView data={data} />}
    </TelemetryCard>
  );
}

export default ProfilesTelemetryView;
