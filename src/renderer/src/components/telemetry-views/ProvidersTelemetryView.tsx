/**
 * Providers tab in remote mode — known LLM provider keys + a
 * "configured" boolean per provider. The actual API keys NEVER
 * leave the server.
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { ProvidersTelemetry } from "../../../../shared/telemetry-types";

function ProvidersView({
  data,
}: {
  data: ProvidersTelemetry;
}): React.JSX.Element {
  const configuredCount = data.providers.filter((p) => p.configured).length;
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">
        Providers — {configuredCount} of {data.providers.length} configured
      </h2>
      <ul className="telemetry-toolset-list">
        {data.providers.map((p) => (
          <li key={p.key}>
            <div className="telemetry-toolset-row">
              <span className="telemetry-toolset-label">{p.label}</span>
              <span
                className={`telemetry-toolset-status ${
                  p.configured ? "enabled" : "disabled"
                }`}
              >
                {p.configured ? "configured" : "unset"}
              </span>
              <span className="telemetry-toolset-source">{p.key}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="telemetry-summary-hint">
        Read-only view. API keys live in <code>~/.hermes/.env</code> on
        the server and never leave it.
      </p>
    </div>
  );
}

function ProvidersTelemetryView(): React.JSX.Element {
  const state = useTelemetryQuery<ProvidersTelemetry>(
    "providers",
    () => window.hermesAPI.telemetry.providers(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Providers">
      {(data) => <ProvidersView data={data} />}
    </TelemetryCard>
  );
}

export default ProvidersTelemetryView;
