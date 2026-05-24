/**
 * Profiles tab in remote mode — multi-instance profile list driven
 * by `/api/profiles`.
 *
 * Plan v10 / PR-4 — adds an "Use in app" button per row that
 * switches the App's local `activeProfile` state (NOT the backend
 * active profile). This is the missing bridge for the Live-Tour:
 * Memory + Persona tabs gate their write surface on
 * `activeProfile === "mira-uitest"`, so without this button the
 * user has no UI path to flip from `default` to `mira-uitest` in
 * remote mode. Tools tab still has its own backend-active gate
 * (which needs a separate SSH `hermes profile use` for now —
 * captured as Open Question #7 / PR-4a).
 *
 * The "Use in app" button never touches the backend. It scopes
 * Memory + Persona reads + writes to the chosen profile via the
 * `?profile=` IPC parameter the adapter now supports. Refresh /
 * restart resets the selection to the Layout default ("default").
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { ProfilesTelemetry } from "../../../../shared/telemetry-types";

interface Props {
  /** Currently-selected App profile (Layout state). */
  activeProfile?: string;
  /** Set the App's activeProfile (Layout setter). */
  onSelectProfile?: (name: string) => void;
}

function ProfilesView({
  data,
  activeProfile,
  onSelectProfile,
}: Props & {
  data: ProfilesTelemetry;
}): React.JSX.Element {
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">
        Profiles — backend active: <code>{data.active}</code>
      </h2>
      {activeProfile && (
        <p className="telemetry-summary-hint">
          App-selected profile: <code>{activeProfile}</code>
          {activeProfile !== data.active &&
            " (Memory + Persona tabs use the App-selected profile; Tools uses the backend-active profile.)"}
        </p>
      )}
      <ul className="telemetry-toolset-list">
        {data.profiles.map((p) => {
          const isAppActive = activeProfile === p.name;
          return (
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
                    backend-active
                  </span>
                ) : (
                  <span className="telemetry-toolset-status disabled">
                    backend-inactive
                  </span>
                )}
                <span className="telemetry-toolset-source">
                  {p.gatewayRunning ? "gateway up" : "gateway down"}
                </span>
                {onSelectProfile && (
                  <button
                    onClick={() => onSelectProfile(p.name)}
                    disabled={isAppActive}
                    style={{ marginLeft: 12 }}
                    data-testid={`profile-select-${p.name}`}
                  >
                    {isAppActive ? "App-selected ✓" : "Use in App"}
                  </button>
                )}
              </div>
              <p className="telemetry-toolset-desc">
                {p.model || "—"} via {p.provider || "—"} · {p.skillCount}{" "}
                skill{p.skillCount === 1 ? "" : "s"}
                {p.description ? ` · ${p.description}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="telemetry-summary-hint">
        "Use in App" only changes which profile the App reads / writes
        from (Memory + Persona tabs). To switch the BACKEND active
        profile (which Tools toggles against), run{" "}
        <code>hermes -p &lt;name&gt;</code> server-side. PR-4a
        (planned) will add a desktop button for that too.
      </p>
    </div>
  );
}

function ProfilesTelemetryView({
  activeProfile,
  onSelectProfile,
}: Props): React.JSX.Element {
  const state = useTelemetryQuery<ProfilesTelemetry>(
    "profiles",
    () => window.hermesAPI.telemetry.profiles(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Profiles">
      {(data) => (
        <ProfilesView
          data={data}
          activeProfile={activeProfile}
          onSelectProfile={onSelectProfile}
        />
      )}
    </TelemetryCard>
  );
}

export default ProfilesTelemetryView;
