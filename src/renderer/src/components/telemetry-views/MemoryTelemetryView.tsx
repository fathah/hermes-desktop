/**
 * Memory tab in remote mode — read-only summary card driven
 * by GET /api/memory (adapted in subsystems.ts).
 *
 * Renders the provider name + configured flag + (optionally)
 * itemCount / sizeBytes / lastUpdatedAt. Never the memory
 * contents — those stay on the server.
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { MemoryTelemetry } from "../../../../shared/telemetry-types";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function MemoryView({ data }: { data: MemoryTelemetry }): React.JSX.Element {
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">Memory provider</h2>
      <dl className="telemetry-summary-list">
        <div>
          <dt>Provider</dt>
          <dd>{data.provider}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{data.configured ? "Configured" : "Not configured"}</dd>
        </div>
        {data.itemCount !== undefined && (
          <div>
            <dt>Items</dt>
            <dd>{data.itemCount.toLocaleString()}</dd>
          </div>
        )}
        {data.sizeBytes !== undefined && (
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(data.sizeBytes)}</dd>
          </div>
        )}
        {data.lastUpdatedAt && (
          <div>
            <dt>Updated</dt>
            <dd>{data.lastUpdatedAt}</dd>
          </div>
        )}
      </dl>
      <p className="telemetry-summary-hint">
        Memory contents stay on the Hermes server. The desktop app shows status
        only.
      </p>
    </div>
  );
}

function MemoryTelemetryView(): React.JSX.Element {
  const state = useTelemetryQuery<MemoryTelemetry>(
    "memory",
    () => window.hermesAPI.telemetry.memory(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Memory">
      {(data) => <MemoryView data={data} />}
    </TelemetryCard>
  );
}

export default MemoryTelemetryView;
