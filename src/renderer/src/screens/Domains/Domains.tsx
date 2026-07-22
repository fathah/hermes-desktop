import { useCallback, useEffect, useMemo, useState } from "react";
import type { HccDomain } from "../../types/hcc";

interface DomainsProps {
  selectedDomainId: string | null;
  onSelectDomain: (domainId: string) => void;
}

interface LifeDomainSummary {
  recordCount: number;
  byType: Record<string, number>;
  cashflow?: { income: number; expenses: number; net: number };
  overdueCount?: number;
  privacy: { sensitivity: string; retention_days: number | null };
}

function Domains({ selectedDomainId, onSelectDomain }: DomainsProps): React.JSX.Element {
  const [domains, setDomains] = useState<HccDomain[]>([]);
  const [lifeSummary, setLifeSummary] = useState<Record<string, LifeDomainSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDomains = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [domainsPayload, summaryPayload] = await Promise.all([
        window.hermesAPI.getHccDomains(),
        window.hermesAPI.getHccLifeDomainSummary(),
      ]);
      const payload = domainsPayload as {
        ok?: boolean;
        items?: HccDomain[];
      };
      const summary = summaryPayload as { domains?: Record<string, LifeDomainSummary> };
      setDomains(Array.isArray(payload.items) ? payload.items : []);
      setLifeSummary(summary.domains || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load HCC domains");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDomains();
  }, [loadDomains]);

  const sortedDomains = useMemo(
    () =>
      [...domains].sort(
        (a, b) => (a.priority_rank ?? 99) - (b.priority_rank ?? 99) || (b.health_score ?? 0) - (a.health_score ?? 0),
      ),
    [domains],
  );

  if (loading) {
    return <div className="hcc-domains-screen"><div className="war-room-loading">Loading domains…</div></div>;
  }

  if (error) {
    return (
      <div className="hcc-domains-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Domains unavailable</div>
          <div className="war-room-error-copy">{error}</div>
          <button className="war-room-refresh-btn" onClick={() => void loadDomains()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hcc-domains-screen">
      <div className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Domains</div>
          <h1 className="war-room-title">Domains Dashboard</h1>
          <p className="war-room-subtitle">
            Life-state lens. Inspect health, momentum, neglect risk, obligations, and active goals per domain.
          </p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void loadDomains()}>
          Refresh
        </button>
      </div>

      <div className="hcc-domains-grid">
        {sortedDomains.map((domain) => {
          const summary = lifeSummary[domain.slug || ""] || lifeSummary[domain.id.split(".").pop() || ""];
          return (
          <button
            key={domain.id}
            className={`hcc-domain-card ${selectedDomainId === domain.id ? "active" : ""}`}
            onClick={() => onSelectDomain(domain.id)}
          >
            <div className="war-room-card-kicker">{domain.slug || "domain"}</div>
            <div className="war-room-item-title hcc-project-title">{domain.name}</div>
            <div className="war-room-item-meta">{domain.description || "No description yet."}</div>
            <div className="hcc-project-card-row">
              <span className="war-room-pill">health {domain.health_score ?? 0}</span>
              <span className="war-room-pill">momentum {domain.momentum_score ?? 0}</span>
              <span className="war-room-pill">{domain.neglect_risk} risk</span>
              {summary && <span className="war-room-pill">records {summary.recordCount}</span>}
              {summary?.overdueCount ? <span className="war-room-pill">overdue {summary.overdueCount}</span> : null}
            </div>
          </button>
          );
        })}
      </div>
    </div>
  );
}

export default Domains;
