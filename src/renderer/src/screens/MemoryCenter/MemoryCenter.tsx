import { useCallback, useEffect, useMemo, useState } from "react";
import type { HccMemoryCapsule, HccMemoryPacket } from "../../types/hcc";

const PACKET_TYPES = ["tiny", "context", "review", "deep"] as const;
type PacketType = (typeof PACKET_TYPES)[number];

function capsuleLinkLabels(capsule: HccMemoryCapsule): string[] {
  const labels = [
    ...(capsule.linked_projects || []).map((item) => item.name),
    ...(capsule.linked_domains || []).map((item) => item.name),
    ...(capsule.linked_gateways || []).map((item) => item.displayName || item.display_name || item.name || item.id),
    ...(capsule.linked_tools || []).map((item) => item.label || item.name || item.id),
  ];
  if (labels.length > 0) return labels;
  return [...capsule.project_ids, ...capsule.domain_ids, ...capsule.gateway_ids, ...capsule.tool_ids];
}

function MemoryCenter(): React.JSX.Element {
  const [capsules, setCapsules] = useState<HccMemoryCapsule[]>([]);
  const [packet, setPacket] = useState<HccMemoryPacket | null>(null);
  const [packetType, setPacketType] = useState<PacketType>("tiny");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMemory = useCallback(async (nextPacketType: PacketType = packetType) => {
    setLoading(true);
    setError(null);
    try {
      const [capsulePayload, packetPayload] = await Promise.all([
        window.hermesAPI.getHccMemoryCapsules(),
        window.hermesAPI.getHccMemoryPacket(nextPacketType),
      ]);
      const capsuleData = capsulePayload as { items?: HccMemoryCapsule[] };
      setCapsules(Array.isArray(capsuleData.items) ? capsuleData.items : []);
      setPacket(packetPayload as HccMemoryPacket);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load HCC memory");
    } finally {
      setLoading(false);
    }
  }, [packetType]);

  useEffect(() => {
    void loadMemory(packetType);
  }, [loadMemory, packetType]);

  const stats = useMemo(() => {
    const promoted = capsules.filter((item) => item.promotion_state === "promoted").length;
    const sensitive = capsules.filter((item) => item.sensitivity !== "local").length;
    const contradictions = capsules.filter((item) => item.contradiction_state !== "none").length;
    const scopes = capsules.reduce<Record<string, number>>((counts, item) => {
      const key = item.scope_type || "global";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    return { total: capsules.length, promoted, sensitive, contradictions, scopes };
  }, [capsules]);

  const selectPacket = (next: PacketType): void => {
    setPacketType(next);
  };

  if (loading && capsules.length === 0) {
    return <div className="hcc-memory-screen"><div className="war-room-loading">Loading memory backbone…</div></div>;
  }

  if (error && capsules.length === 0) {
    return (
      <div className="hcc-memory-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Memory Center unavailable</div>
          <div className="war-room-error-copy">{error}</div>
          <button className="war-room-refresh-btn" onClick={() => void loadMemory()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hcc-memory-screen">
      <section className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Memory Backbone</div>
          <h1 className="war-room-title">Memory Center</h1>
          <p className="war-room-subtitle">
            Inspect normalized capsules, promotion state, scope, confidence, and retrieval packets.
          </p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void loadMemory()}>
          Refresh
        </button>
      </section>

      <section className="war-room-hero-grid">
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Capsules</div>
          <div className="war-room-stat-value">{stats.total}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Promoted</div>
          <div className="war-room-stat-value">{stats.promoted}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Elevated sensitivity</div>
          <div className="war-room-stat-value">{stats.sensitive}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Contradictions</div>
          <div className="war-room-stat-value">{stats.contradictions}</div>
        </div>
      </section>

      <section className="war-room-panel">
        <div className="war-room-panel-title">Logical scope distribution</div>
        <div className="hcc-project-card-row">
          {Object.entries(stats.scopes).map(([scope, count]) => (
            <span key={scope} className="war-room-pill">{scope} {count}</span>
          ))}
          {Object.keys(stats.scopes).length === 0 && <span className="war-room-item-meta">No logical partitions populated.</span>}
        </div>
      </section>

      <section className="war-room-panel">
        <div className="hcc-memory-toolbar">
          <div>
            <div className="war-room-panel-title">Retrieval packet</div>
            <div className="war-room-item-meta">
              {packet?.summary.count ?? 0} selected of {packet?.summary.availableMatches ?? 0} matches
            </div>
          </div>
          <div className="hcc-memory-packet-tabs">
            {PACKET_TYPES.map((type) => (
              <button
                key={type}
                className={`content-widget-toggle ${packetType === type ? "active" : ""}`}
                onClick={() => selectPacket(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        <div className="hcc-memory-packet-grid">
          {(packet?.items || []).map((item) => (
            <article key={item.id} className="hcc-memory-capsule compact">
              <div className="war-room-card-kicker">{item.kind}</div>
              <div className="war-room-item-title">{item.summary}</div>
              <div className="hcc-project-card-row">
                <span className="war-room-pill">{item.importance}</span>
                <span className="war-room-pill">{item.promotion_state}</span>
              </div>
            </article>
          ))}
          {packet?.items.length === 0 && (
            <div className="war-room-item-meta">No capsules matched this packet policy.</div>
          )}
        </div>
      </section>

      <section className="war-room-panel">
        <div className="war-room-panel-title">All capsules</div>
        <div className="hcc-memory-capsule-grid">
          {capsules.map((capsule) => (
            <article key={capsule.id} className="hcc-memory-capsule">
              <div className="war-room-card-kicker">
                {capsule.scope_type} / {capsule.kind}
              </div>
              <div className="war-room-item-title">{capsule.summary || "Untitled capsule"}</div>
              <div className="war-room-item-meta">{capsule.body}</div>
              <div className="hcc-project-card-row">
                <span className="war-room-pill">{capsule.importance}</span>
                <span className="war-room-pill">{capsule.confidence} confidence</span>
                <span className="war-room-pill">{capsule.freshness}</span>
                <span className="war-room-pill">{capsule.promotion_state}</span>
              </div>
              <div className="hcc-memory-links">
                {capsuleLinkLabels(capsule).slice(0, 6).map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </article>
          ))}
          {capsules.length === 0 && (
            <div className="war-room-item-meta">No memory capsules stored yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}

export default MemoryCenter;
