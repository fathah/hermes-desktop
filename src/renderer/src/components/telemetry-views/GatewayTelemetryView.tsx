/**
 * Gateway tab in remote mode — "About this Hermes" dashboard
 * driven by the gateway-status probe (the same one
 * CapabilitiesProvider already runs), plus a Recent Activity
 * card and a Usage Summary card from the Phase-3 endpoints.
 *
 * Reads gateway-status directly from CapabilitiesContext so it
 * doesn't spawn a duplicate IPC call for data the provider
 * already holds. The two PR-D cards each fire their own IPC.
 */

import { useContext } from "react";
import { CapabilitiesContext } from "../CapabilitiesProvider";
import RemoteNotice from "../RemoteNotice";
import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type {
  RecentEventsTelemetry,
  UsageSummaryTelemetry,
} from "../../../../shared/telemetry-types";

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
          <dd>
            {data.version}
            {data.released ? (
              <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                ({data.released})
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd>{formatUptime(data.uptimeSeconds)}</dd>
        </div>
        {data.pythonVersion && (
          <div>
            <dt>Python</dt>
            <dd>{data.pythonVersion}</dd>
          </div>
        )}
        {data.openaiSdkVersion && (
          <div>
            <dt>OpenAI SDK</dt>
            <dd>{data.openaiSdkVersion}</dd>
          </div>
        )}
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

      <h3 className="telemetry-summary-subtitle">Usage</h3>
      <UsageCard />

      <h3 className="telemetry-summary-subtitle">Recent activity</h3>
      <RecentEventsCard />

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

// ---------------------------------------------------------------------------
// Recent activity card
// ---------------------------------------------------------------------------

function RecentEventsCard(): React.JSX.Element {
  const state = useTelemetryQuery<RecentEventsTelemetry>(
    "events",
    () => window.hermesAPI.telemetry.recentEvents(20),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Recent activity">
      {(data) => {
        if (data.events.length === 0) {
          return (
            <p className="telemetry-summary-hint">No recent activity.</p>
          );
        }
        return (
          <ul className="telemetry-events-list">
            {data.events.map((evt) => (
              <li key={evt.id}>
                <span className="telemetry-event-kind">{evt.kind}</span>
                <span className="telemetry-event-summary">{evt.summary}</span>
                <span className="telemetry-event-at">{evt.at}</span>
              </li>
            ))}
          </ul>
        );
      }}
    </TelemetryCard>
  );
}

// ---------------------------------------------------------------------------
// Usage card
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function UsageCard(): React.JSX.Element {
  const state = useTelemetryQuery<UsageSummaryTelemetry>(
    "usage",
    () => window.hermesAPI.telemetry.usageSummary(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Usage">
      {(data) => {
        const total =
          data.tokens.input +
          data.tokens.output +
          (data.tokens.cacheRead || 0) +
          (data.tokens.cacheWrite || 0);
        if (total === 0) {
          return (
            <p className="telemetry-summary-hint">
              No token usage recorded yet.
            </p>
          );
        }
        return (
          <>
            <dl className="telemetry-summary-list">
              <div>
                <dt>Input</dt>
                <dd>{formatNumber(data.tokens.input)} tokens</dd>
              </div>
              <div>
                <dt>Output</dt>
                <dd>{formatNumber(data.tokens.output)} tokens</dd>
              </div>
              {data.tokens.cacheRead !== undefined && (
                <div>
                  <dt>Cache read</dt>
                  <dd>{formatNumber(data.tokens.cacheRead)} tokens</dd>
                </div>
              )}
              {data.tokens.cacheWrite !== undefined && (
                <div>
                  <dt>Cache write</dt>
                  <dd>{formatNumber(data.tokens.cacheWrite)} tokens</dd>
                </div>
              )}
              {data.estimatedCostUsd != null && (
                <div>
                  <dt>Estimated cost</dt>
                  <dd>${data.estimatedCostUsd.toFixed(4)}</dd>
                </div>
              )}
            </dl>
            {data.byModel.length > 0 && (
              <>
                <h4
                  className="telemetry-summary-subtitle"
                  style={{ marginTop: 14 }}
                >
                  By model
                </h4>
                <table className="telemetry-schedules-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Requests</th>
                      <th>Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((m) => (
                      <tr key={m.modelId}>
                        <td>{m.modelId}</td>
                        <td>{formatNumber(m.requests)}</td>
                        <td>{formatNumber(m.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        );
      }}
    </TelemetryCard>
  );
}

export default GatewayTelemetryView;
