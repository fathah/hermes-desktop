import { useCallback, useEffect, useMemo, useState } from "react";
import type { HccGatewayCapability, HccGatewayCapabilityMap as GatewayMapPayload } from "../../types/hcc";

type HealthFilter = "all" | "active" | "degraded" | "unavailable";

function GatewayCapabilityMap(): React.JSX.Element {
  const [data, setData] = useState<GatewayMapPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<HealthFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccGatewayCapabilityMap()) as GatewayMapPayload;
      setData(payload);
      setSelectedId((current) => current && payload.gateways.some((item) => item.id === current)
        ? current
        : payload.gateways[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gateway capability map");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return filter === "all" ? data.gateways : data.gateways.filter((item) => item.health === filter);
  }, [data, filter]);

  const selected = data?.gateways.find((item) => item.id === selectedId) || filtered[0] || null;

  if (loading && !data) return <div className="gateway-map-state">Reading live gateway evidence…</div>;
  if (error && !data) return <div className="gateway-map-state error">{error}</div>;
  if (!data) return <div className="gateway-map-state">No capability map recorded.</div>;

  return (
    <main className="gateway-map-screen">
      <header className="gateway-map-header">
        <div>
          <div className="gateway-map-kicker">OPERATOR FABRIC</div>
          <h1>Gateway Capability Map</h1>
          <p>Live runtime evidence mapped to capabilities, apps, events, and control boundaries.</p>
        </div>
        <button className="gateway-map-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh capability map">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="gateway-map-summary" aria-label="Gateway capability summary">
        <Summary value={data.summary.running} label="running" />
        <Summary value={data.summary.degraded} label="degraded" alert={data.summary.degraded > 0} />
        <Summary value={data.summary.capabilities} label="capabilities" />
        <Summary value={data.summary.linkedApps} label="app links" />
        <Summary value={data.summary.staleDeclarations} label="stale declarations" alert={data.summary.staleDeclarations > 0} />
      </section>

      <div className="gateway-map-filters" role="tablist" aria-label="Gateway health filter">
        {(["all", "active", "degraded", "unavailable"] as HealthFilter[]).map((item) => (
          <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>

      <section className="gateway-map-layout">
        <div className="gateway-map-list" aria-label="Gateways">
          {filtered.map((gateway) => (
            <button
              key={gateway.id}
              className={`gateway-map-row ${selected?.id === gateway.id ? "selected" : ""}`}
              onClick={() => setSelectedId(gateway.id)}
            >
              <span className={`gateway-health-dot ${gateway.health}`} />
              <span className="gateway-map-row-copy">
                <strong>{gateway.displayName}</strong>
                <span>{gateway.platform || "platform not recorded"} · {gateway.runtimeStatus}</span>
                {gateway.degradedReason && <small>{gateway.degradedReason}</small>}
              </span>
              <span className={`gateway-health-label ${gateway.health}`}>{gateway.health}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="gateway-map-empty">No gateways match this health filter.</div>}
        </div>

        {selected && <GatewayDetail gateway={selected} />}
      </section>

      <footer className="gateway-map-provenance">
        <span>{data.provenance.healthPolicy.replaceAll("_", " ")}</span>
        <span>{data.provenance.mutationPolicy.replaceAll("_", " ")}</span>
        <span>Generated {new Date(data.generatedAt * 1000).toLocaleString()}</span>
      </footer>
    </main>
  );
}

function Summary({ value, label, alert = false }: { value: number; label: string; alert?: boolean }): React.JSX.Element {
  return <div className={alert ? "gateway-summary-item alert" : "gateway-summary-item"}><strong>{value}</strong><span>{label}</span></div>;
}

function GatewayDetail({ gateway }: { gateway: HccGatewayCapability }): React.JSX.Element {
  return (
    <article className="gateway-map-detail">
      <header>
        <div>
          <div className="gateway-map-kicker">{gateway.id}</div>
          <h2>{gateway.displayName}</h2>
        </div>
        <span className={`gateway-health-label ${gateway.health}`}>{gateway.health}</span>
      </header>

      {gateway.degradedReason && <div className="gateway-map-warning"><strong>Runtime evidence conflict</strong><span>{gateway.degradedReason}</span></div>}

      <div className="gateway-evidence-grid">
        <Evidence label="Process" value={gateway.evidence.pidAlive ? `PID ${gateway.evidence.pid}` : "not observed"} ok={gateway.evidence.pidAlive} />
        <Evidence label="Profile" value={gateway.evidence.profileExists ? "present" : "missing"} ok={gateway.evidence.profileExists} />
        <Evidence label="Config" value={gateway.evidence.configExists ? "present" : "missing"} ok={gateway.evidence.configExists} />
        <Evidence label="Manifest" value={gateway.missingManifest ? "missing" : gateway.confidence} ok={!gateway.missingManifest} />
      </div>

      <RelationGroup title="Capabilities" items={gateway.capabilities} empty="No capabilities declared" />
      <RelationGroup title="Linked apps" items={gateway.linkedApps} empty="No app links declared" />
      <RelationGroup title="Event types" items={gateway.eventTypes} empty="No event contract declared" />
      <RelationGroup title="Control boundary" items={gateway.controlActions} empty="Inspection only" />
    </article>
  );
}

function Evidence({ label, value, ok }: { label: string; value: string; ok: boolean }): React.JSX.Element {
  return <div className="gateway-evidence"><span>{label}</span><strong className={ok ? "ok" : "missing"}>{value}</strong></div>;
}

function RelationGroup({ title, items, empty }: { title: string; items: string[]; empty: string }): React.JSX.Element {
  return <section className="gateway-relation-group"><h3>{title}</h3><div>{items.length > 0 ? items.map((item) => <span key={item}>{item}</span>) : <small>{empty}</small>}</div></section>;
}

export default GatewayCapabilityMap;
