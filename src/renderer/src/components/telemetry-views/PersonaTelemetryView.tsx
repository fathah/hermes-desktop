/**
 * Persona (Soul) tab in remote mode — the SOUL.md markdown body
 * driven by GET /v1/telemetry/persona. Capped at 16 KB by the
 * backend; truncation is signalled explicitly.
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { PersonaTelemetry } from "../../../../shared/telemetry-types";

function PersonaView({
  data,
}: {
  data: PersonaTelemetry;
}): React.JSX.Element {
  if (!data.configured) {
    return (
      <div className="telemetry-summary">
        <h2 className="telemetry-summary-title">Persona</h2>
        <p className="telemetry-summary-hint">
          No <code>SOUL.md</code> configured on this Hermes instance.
        </p>
      </div>
    );
  }
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">Persona (SOUL.md)</h2>
      <pre
        style={{
          background: "rgba(255, 255, 255, 0.03)",
          padding: "12px 16px",
          borderRadius: 6,
          overflowX: "auto",
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          margin: 0,
        }}
      >
        {data.content}
      </pre>
      {data.truncated && (
        <p className="telemetry-summary-hint">
          ⚠ Content truncated at 16 KB. Full file ({data.sizeBytes} bytes)
          lives at <code>~/.hermes/SOUL.md</code> on the server.
        </p>
      )}
      <p className="telemetry-summary-hint">
        Read-only view. Edit <code>SOUL.md</code> server-side to change
        the persona.
      </p>
    </div>
  );
}

function PersonaTelemetryView(): React.JSX.Element {
  const state = useTelemetryQuery<PersonaTelemetry>(
    "persona",
    () => window.hermesAPI.telemetry.persona(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Persona">
      {(data) => <PersonaView data={data} />}
    </TelemetryCard>
  );
}

export default PersonaTelemetryView;
