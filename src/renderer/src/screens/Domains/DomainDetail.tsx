import { useCallback, useEffect, useState } from "react";
import type { HccDomain } from "../../types/hcc";

interface DomainDetailProps {
  domainId: string | null;
}

function DomainDetail({ domainId }: DomainDetailProps): React.JSX.Element {
  const [domain, setDomain] = useState<HccDomain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDomain = useCallback(async () => {
    if (!domainId) {
      setDomain(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccDomainDetail(domainId)) as HccDomain;
      setDomain(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load domain detail");
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  useEffect(() => {
    void loadDomain();
  }, [loadDomain]);

  if (!domainId) {
    return (
      <div className="hcc-domain-detail-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Domain detail</div>
          <div className="war-room-error-copy">Select a domain from Domains Dashboard.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="hcc-domain-detail-screen"><div className="war-room-loading">Loading domain…</div></div>;
  }

  if (error || !domain) {
    return (
      <div className="hcc-domain-detail-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Domain detail unavailable</div>
          <div className="war-room-error-copy">{error || "No domain data returned."}</div>
          <button className="war-room-refresh-btn" onClick={() => void loadDomain()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hcc-domain-detail-screen">
      <div className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Domain Detail</div>
          <h1 className="war-room-title">{domain.name}</h1>
          <p className="war-room-subtitle">{domain.description || domain.notes || "No domain notes yet."}</p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void loadDomain()}>
          Refresh
        </button>
      </div>

      <div className="war-room-hero-grid">
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Health</div>
          <div className="war-room-stat-value">{domain.health_score ?? 0}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Momentum</div>
          <div className="war-room-stat-value">{domain.momentum_score ?? 0}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Neglect risk</div>
          <div className="war-room-stat-value">{domain.neglect_risk}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Review cadence</div>
          <div className="war-room-stat-value">{domain.review_cadence || "weekly"}</div>
        </div>
      </div>

      <div className="war-room-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Core metrics</div>
          <div className="war-room-list">
            {(domain.core_metrics || []).map((item) => (
              <div key={item} className="war-room-list-item">
                <div className="war-room-item-title">{item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Obligations</div>
          <div className="war-room-list">
            {(domain.obligations || []).map((item) => (
              <div key={item} className="war-room-list-item">
                <div className="war-room-item-title">{item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Active goals</div>
          <div className="war-room-list">
            {(domain.active_goals || []).map((item) => (
              <div key={item} className="war-room-list-item">
                <div className="war-room-item-title">{item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Open loops</div>
          <div className="war-room-list">
            {(domain.open_loops || []).map((item) => (
              <div key={item} className="war-room-list-item">
                <div className="war-room-item-title">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DomainDetail;
