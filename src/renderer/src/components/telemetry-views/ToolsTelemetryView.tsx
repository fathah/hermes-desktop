/**
 * Tools tab in remote mode — read-only list of toolsets driven
 * by GET /api/tools/toolsets. Backend-active profile scope only
 * for Phase A; cross-profile read scoping needs upstream PR
 * NousResearch/hermes-agent #31607 (depends-on of a later phase).
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { ToolsTelemetry } from "../../../../shared/telemetry-types";

interface Props {
  /** Currently unused — upstream `?profile=` scoping arrives in a
   *  later Phase that depends on #31607. The prop is kept for
   *  prop-API symmetry with the other TelemetryView components. */
  profile?: string;
}

function ToolsView({ data }: { data: ToolsTelemetry }): React.JSX.Element {
  if (data.toolsets.length === 0) {
    return (
      <div className="telemetry-summary">
        <h2 className="telemetry-summary-title">Tools</h2>
        <p className="telemetry-summary-hint">
          No toolsets configured on this Hermes instance.
        </p>
      </div>
    );
  }
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">Tools</h2>
      <ul className="telemetry-toolset-list">
        {data.toolsets.map((t) => (
          <li key={t.key}>
            <div className="telemetry-toolset-row">
              <span className="telemetry-toolset-label">{t.label}</span>
              <span
                className={`telemetry-toolset-status ${
                  t.enabled ? "enabled" : "disabled"
                }`}
              >
                {t.enabled ? "enabled" : "disabled"}
              </span>
              <span className="telemetry-toolset-source">{t.source}</span>
            </div>
            <p className="telemetry-toolset-desc">{t.description}</p>
            {t.mcpServer && (
              <p className="telemetry-toolset-mcp">
                MCP server: {t.mcpServer.name} ({t.mcpServer.status})
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="telemetry-summary-hint">
        Read-only view. Toggle toolsets in your Hermes config (server-side).
      </p>
    </div>
  );
}

function ToolsTelemetryView(_props: Props): React.JSX.Element {
  const state = useTelemetryQuery<ToolsTelemetry>(
    "tools",
    () => window.hermesAPI.telemetry.tools(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Tools">
      {(data) => <ToolsView data={data} />}
    </TelemetryCard>
  );
}

export default ToolsTelemetryView;
