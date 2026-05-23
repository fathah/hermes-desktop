/**
 * Skills tab in remote mode — installed skills inventory driven
 * by GET /v1/telemetry/skills. No skill body content; only the
 * frontmatter (name, version, description, enabled flag).
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { SkillsTelemetry } from "../../../../shared/telemetry-types";

function SkillsView({ data }: { data: SkillsTelemetry }): React.JSX.Element {
  if (data.installed.length === 0) {
    return (
      <div className="telemetry-summary">
        <h2 className="telemetry-summary-title">Skills</h2>
        <p className="telemetry-summary-hint">
          No skills installed on this Hermes instance.
        </p>
      </div>
    );
  }
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">
        Skills — {data.total} installed · {data.enabledCount} enabled
      </h2>
      <ul className="telemetry-toolset-list">
        {data.installed.map((s) => (
          <li key={s.id}>
            <div className="telemetry-toolset-row">
              <span className="telemetry-toolset-label">
                {s.name}
                {s.version ? (
                  <span
                    style={{
                      color: "var(--text-muted)",
                      marginLeft: 8,
                      fontWeight: 400,
                    }}
                  >
                    v{s.version}
                  </span>
                ) : null}
              </span>
              <span
                className={`telemetry-toolset-status ${
                  s.enabled ? "enabled" : "disabled"
                }`}
              >
                {s.enabled ? "enabled" : "disabled"}
              </span>
              <span className="telemetry-toolset-source">{s.status}</span>
            </div>
            {s.description && (
              <p className="telemetry-toolset-desc">{s.description}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="telemetry-summary-hint">
        Read-only view. Install / uninstall via{" "}
        <code>hermes skills</code> server-side.
      </p>
    </div>
  );
}

function SkillsTelemetryView(): React.JSX.Element {
  const state = useTelemetryQuery<SkillsTelemetry>(
    "skills",
    () => window.hermesAPI.telemetry.skills(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Skills">
      {(data) => <SkillsView data={data} />}
    </TelemetryCard>
  );
}

export default SkillsTelemetryView;
