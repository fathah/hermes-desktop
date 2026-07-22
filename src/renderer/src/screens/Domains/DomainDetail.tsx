import { useCallback, useEffect, useState } from "react";
import type { HccDomain } from "../../types/hcc";

interface DomainDetailProps {
  domainId: string | null;
}
interface DomainIntervention { id:string; domain:string; kind:string; rationale:string; status:string; externalActionAllowed:boolean; evidence:Array<Record<string,unknown>> }
interface SpecialistCockpit { domain:"health"|"finance"; dataState:string; metrics?:Array<{metric:string;latestValue:number;unit:string;delta:number|null;trend:string;referenceFlag:string;evidenceCount:number}>; records?:Record<string,number>; cashflow?:{income:number;expenses:number;net:number}; liquidBalance?:number; runwayMonths?:number|null; accounts?:Array<{accountId:string;balance:number;currency:string;asOf:string}>; evidence:{recordCount:number;sourceCount:number}; safety:Record<string,boolean> }

function DomainDetail({ domainId }: DomainDetailProps): React.JSX.Element {
  const [domain, setDomain] = useState<HccDomain | null>(null);
  const [cockpit, setCockpit] = useState<SpecialistCockpit | null>(null);
  const [interventions, setInterventions] = useState<DomainIntervention[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
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
      const specialist = domainId.endsWith("health") ? "health" : domainId.endsWith("finance") ? "finance" : null;
      const [payload, cockpitPayload, interventionPayload] = await Promise.all([
        window.hermesAPI.getHccDomainDetail(domainId),
        specialist ? window.hermesAPI.getHccDomainCockpit(specialist) : Promise.resolve(null),
        specialist ? window.hermesAPI.getHccDomainInterventions(specialist) : Promise.resolve({ items: [] }),
      ]);
      setDomain(payload as HccDomain);
      setCockpit(cockpitPayload as SpecialistCockpit | null);
      setInterventions(((interventionPayload as {items?:DomainIntervention[]}).items)||[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load domain detail");
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  useEffect(() => {
    void loadDomain();
  }, [loadDomain]);

  const decideIntervention = async (item: DomainIntervention, decision: "approve"|"reject"): Promise<void> => {
    setBusy(item.id);setError(null);
    try { await window.hermesAPI.decideHccDomainIntervention(item.id,decision,`${decision} from native domain cockpit`); await loadDomain(); }
    catch(reason){ setError(reason instanceof Error ? reason.message : "Domain intervention decision failed"); }
    finally{setBusy(null);}
  };

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

      {cockpit && <section className="war-room-panel specialist-cockpit">
        <div><div className="war-room-card-kicker">Evidence-backed specialist cockpit</div><div className="war-room-panel-title">{cockpit.domain === "health" ? "Health observability" : "Financial operating picture"}</div><p className="war-room-item-meta">{cockpit.dataState} · {cockpit.evidence.recordCount} records · {cockpit.evidence.sourceCount} sources</p></div>
        {cockpit.domain==="health"?<div className="specialist-metric-grid">{(cockpit.metrics||[]).map(m=><article key={m.metric}><span>{m.metric.replaceAll("_"," ")}</span><strong>{m.latestValue} {m.unit}</strong><code>{m.delta===null?"no baseline":`Δ ${m.delta}`} · {m.referenceFlag} · {m.evidenceCount} evidence</code></article>)}</div>:<div className="specialist-metric-grid"><article><span>Income</span><strong>{cockpit.cashflow?.income||0}</strong></article><article><span>Expenses</span><strong>{cockpit.cashflow?.expenses||0}</strong></article><article><span>Net</span><strong>{cockpit.cashflow?.net||0}</strong></article><article><span>Liquid</span><strong>{cockpit.liquidBalance||0}</strong></article><article><span>Runway</span><strong>{cockpit.runwayMonths ?? "insufficient data"}</strong><code>months at observed expense baseline</code></article></div>}
        <div className="specialist-safety">{Object.entries(cockpit.safety).map(([key,value])=><span key={key} className={`war-room-pill ${value?"tone-watch":"tone-healthy"}`}>{key.replaceAll(/([A-Z])/g," $1")}: {String(value)}</span>)}</div>
        <div className="memory-governance-list">{interventions.map(item=><article className="memory-governance-row" key={item.id}><div><strong>{item.kind}</strong><span>{item.status} · {item.rationale}</span><code>{item.evidence.length} evidence · external action {String(item.externalActionAllowed)}</code></div>{item.status==="pending_approval"&&<div className="war-room-action-row"><button disabled={busy===item.id} onClick={()=>void decideIntervention(item,"approve")}>Approve review</button><button disabled={busy===item.id} onClick={()=>void decideIntervention(item,"reject")}>Reject</button></div>}</article>)}</div>
      </section>}

      <div className="war-room-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Core metrics</div>
          <div className="war-room-list">
            {(domain.core_metrics || []).map((item) => <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div></div>)}
            {(domain.core_metrics || []).length === 0 && <div className="war-room-item-meta">No metrics configured.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Obligations</div>
          <div className="war-room-list">
            {(domain.obligations || []).map((item) => <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div></div>)}
            {(domain.obligations || []).length === 0 && <div className="war-room-item-meta">No active obligations.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Active goals</div>
          <div className="war-room-list">
            {(domain.active_goals || []).map((item) => <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div></div>)}
            {(domain.active_goals || []).length === 0 && <div className="war-room-item-meta">No active goals.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Open loops</div>
          <div className="war-room-list">
            {(domain.open_loops || []).map((item) => <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div><span className="war-room-pill tone-watch">open</span></div>)}
            {(domain.open_loops || []).length === 0 && <div className="war-room-item-meta">No open loops.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Alert thresholds</div>
          <div className="war-room-list">
            {Object.entries(domain.alert_thresholds || {}).map(([label, value]) => (
              <div key={label} className="war-room-list-item"><span className="war-room-item-title">{label.replaceAll("_", " ")}</span><strong>{value}</strong></div>
            ))}
            {Object.keys(domain.alert_thresholds || {}).length === 0 && <div className="war-room-item-meta">No domain alerts configured.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Linked projects</div>
          <div className="war-room-list">
            {(domain.linked_projects || []).map((project) => (
              <div key={project.id} className="war-room-list-item">
                <div><div className="war-room-item-title">{project.name}</div><div className="war-room-item-meta">{project.status} · momentum {project.momentum_score ?? 0}</div></div>
                <span className="war-room-pill">risk {project.risk_score ?? 0}</span>
              </div>
            ))}
            {(domain.linked_projects || []).length === 0 && <div className="war-room-item-meta">No projects linked to this life domain.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Operational gateways</div>
          <div className="war-room-list">
            {(domain.linked_gateways || []).map((gateway) => (
              <div key={gateway.id} className="war-room-list-item"><div className="war-room-item-title">{gateway.displayName || gateway.display_name || gateway.name || gateway.id}</div><span className="war-room-pill">gateway</span></div>
            ))}
            {(domain.linked_gateways || []).length === 0 && <div className="war-room-item-meta">No gateway lanes linked.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Domain memory</div>
          <div className="war-room-list">
            {(domain.memory_capsules || []).map((capsule) => (
              <div key={capsule.id} className="war-room-list-item war-room-list-item-stack">
                <div className="war-room-item-title">{capsule.summary}</div>
                <div className="war-room-item-meta">{capsule.kind} · {capsule.importance} · {capsule.promotion_state}</div>
              </div>
            ))}
            {(domain.memory_capsules || []).length === 0 && <div className="war-room-item-meta">No scoped memory capsules linked.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DomainDetail;
