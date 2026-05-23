/**
 * Gateway tab in remote mode — "About this Hermes" dashboard
 * driven by the gateway-status probe (the same one
 * CapabilitiesProvider already runs).
 *
 * Reads directly from the CapabilitiesContext so it doesn't
 * spawn a duplicate IPC call for data the provider already
 * holds. Stays in sync with the rest of the app's capability
 * decisions.
 */

import { useContext } from "react";
import { CapabilitiesContext } from "../CapabilitiesProvider";
import RemoteNotice from "../RemoteNotice";

function GatewayTelemetryView(): React.JSX.Element {
  const ctx = useContext(CapabilitiesContext);

  if (ctx.status === "loading") {
    return (
      <div className="remote-notice" data-testid="gateway-loading">
        <div className="loading-spinner" aria-label="Loading" />
        <p className="remote-notice-desc">Probing Hermes gateway…</p>
      </div>
    );
  }
  if (ctx.status === "unavailable") {
    return (
      <RemoteNotice
        feature="Gateway"
        reason={ctx.reason}
        {...(ctx.detail ? { detail: ctx.detail } : {})}
      />
    );
  }

  const { data } = ctx;
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">Hermes gateway</h2>
      <dl className="telemetry-summary-list">
        <div>
          <dt>Service</dt>
          <dd>{data.service}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{data.version}</dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd>{formatUptime(data.uptimeSeconds)}</dd>
        </div>
        <div>
          <dt>Capabilities</dt>
          <dd>
            {data.capabilities.length === 0
              ? "none"
              : data.capabilities.join(", ")}
          </dd>
        </div>
      </dl>
      {data.upstreamProviders.length > 0 && (
        <>
          <h3 className="telemetry-summary-subtitle">Upstream providers</h3>
          <ul className="telemetry-provider-list">
            {data.upstreamProviders.map((p) => (
              <li key={p.name}>
                <span className="telemetry-provider-name">{p.name}</span>
                <span className="telemetry-provider-flag">
                  {p.configured ? "configured" : "unset"}
                </span>
                <span className="telemetry-provider-flag">
                  {p.reachable ? "reachable" : "unreachable"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="telemetry-summary-hint">
        Read-only status snapshot. Restart the gateway server-side to refresh.
      </p>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default GatewayTelemetryView;
