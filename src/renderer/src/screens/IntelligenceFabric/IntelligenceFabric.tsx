import { useCallback, useEffect, useState } from "react";

type FabricTab = "briefing" | "retrieval" | "policy" | "flow";
type JsonRecord = Record<string, any>;

function IntelligenceFabric(): React.JSX.Element {
  const [data, setData] = useState<JsonRecord | null>(null);
  const [tab, setTab] = useState<FabricTab>("briefing");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await window.hermesAPI.getHccIntelligence("hcc-os", 1200)) as JsonRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load intelligence fabric");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (action: () => Promise<unknown>, id: string): Promise<void> => {
    setActionBusy(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Governance action failed");
    } finally {
      setActionBusy(null);
    }
  };

  if (loading && !data) return <div className="fabric-state">Loading grounded intelligence…</div>;
  if (error && !data) return <div className="fabric-state error">{error}</div>;
  if (!data) return <div className="fabric-state">No intelligence snapshot recorded.</div>;

  const brief = data.operatorBrief || {};
  const summary = brief.summary || {};
  const retrieval = data.retrieval || {};
  const topology = data.executionTopology || {};
  const governance = data.governance || {};

  return (
    <main className="fabric-screen">
      <header className="fabric-header">
        <div>
          <div className="fabric-kicker">HCC OS / INTELLIGENCE FABRIC</div>
          <h1>Operator Intelligence</h1>
          <p>Grounded retrieval, governed policy, daily attention, and execution topology in one surface.</p>
        </div>
        <button className="fabric-refresh" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </header>

      <nav className="fabric-tabs" aria-label="Intelligence sections">
        {(["briefing", "retrieval", "policy", "flow"] as FabricTab[]).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
        ))}
      </nav>

      {error && <div className="fabric-inline-error">{error}</div>}
      {tab === "briefing" && <Briefing brief={brief} summary={summary} />}
      {tab === "retrieval" && <Retrieval retrieval={retrieval} />}
      {tab === "policy" && <Policy governance={governance} actionBusy={actionBusy} runAction={runAction} />}
      {tab === "flow" && <Flow topology={topology} cognitiveMap={data.cognitiveMap || {}} />}

      <footer className="fabric-provenance">
        <span>Schema {data.schemaVersion}</span>
        <span>Sources: {(data.provenance?.sources || []).join(" · ")}</span>
        <span>{data.provenance?.mutationPolicy}</span>
      </footer>
    </main>
  );
}

function Briefing({ brief, summary }: { brief: JsonRecord; summary: JsonRecord }): React.JSX.Element {
  return (
    <section className="fabric-panel">
      <div className="fabric-brief-hero">
        <div>
          <div className="fabric-kicker">DAILY BRIEFING / LIVE RUNTIME</div>
          <h2>{brief.statusLine || "Operator status unavailable"}</h2>
          {brief.topBlocker && <p className="fabric-blocker">{brief.topBlocker}</p>}
        </div>
        <span className={`fabric-severity ${brief.severity || "stable"}`}>{brief.severity || "unknown"}</span>
      </div>
      <div className="fabric-stat-grid">
        <Stat value={summary.openCommandCount || 0} label="open commands" />
        <Stat value={summary.degradedRetrievalCount || 0} label="degraded retrievals" alert={summary.degradedRetrievalCount > 0} />
        <Stat value={summary.cognitiveMapNodeCount || 0} label="graph nodes" />
        <Stat value={summary.cognitiveMapEdgeCount || 0} label="graph edges" />
        <Stat value={summary.contextPressureCount || 0} label="context pressure" alert={summary.contextPressureCount > 0} />
      </div>
      <div className="fabric-section-title">Recommended operator attention</div>
      <div className="fabric-recommendations">
        {(brief.recommendations || []).map((item: JsonRecord) => <article key={`${item.label}-${item.priority}`}><strong>{item.label}</strong><span>{item.why}</span><small>Priority {item.priority}</small></article>)}
        {!brief.recommendations?.length && <div className="fabric-empty">No recommendation recorded.</div>}
      </div>
    </section>
  );
}

function Retrieval({ retrieval }: { retrieval: JsonRecord }): React.JSX.Element {
  const policy = retrieval.policy || {};
  const sourceEval = retrieval.sourceEvaluation || retrieval.evaluation || {};
  return (
    <section className="fabric-panel">
      <div className="fabric-panel-head"><div><div className="fabric-kicker">SOURCE-BACKED CONTEXT PACK</div><h2>{retrieval.context?.title || retrieval.contextPackId || "hcc-os"}</h2></div><span className={`fabric-severity ${retrieval.degraded ? "warning" : "stable"}`}>{retrieval.degraded ? "degraded" : "grounded"}</span></div>
      <div className="fabric-stat-grid">
        <Stat value={(retrieval.selectedUnits || []).length} label="selected units" />
        <Stat value={(retrieval.omittedUnits || []).length} label="omitted units" alert={Boolean((retrieval.omittedUnits || []).length)} />
        <Stat value={retrieval.summary?.elapsedMs || retrieval.latencyMs || 0} label="latency ms" />
        <Stat value={retrieval.summary?.tokenCount || retrieval.tokenEstimate || 0} label="estimated tokens" />
      </div>
      <div className="fabric-policy-strip"><strong>Reader</strong><span>{policy.activeReader || "auto"}</span><strong>Policy</strong><span>{policy.policyVersion || "scoped allowlist"}</span><strong>Trust</strong><span>{retrieval.trust?.trustScore ?? retrieval.trustScore ?? "not recorded"}</span></div>
      <div className="fabric-section-title">Routing decisions</div>
      <div className="fabric-list">{(retrieval.routingDecisions || []).map((item: JsonRecord) => <div key={item.scopeId} className="fabric-list-row"><strong>{item.scopeId}</strong><span>{item.selected ? "selected" : "omitted"} · {item.reason || "policy"}</span></div>)}</div>
      {sourceEval && <div className="fabric-footnote">Evaluation: {JSON.stringify(sourceEval).slice(0, 320)}</div>}
    </section>
  );
}

function Policy({ governance, actionBusy, runAction }: { governance: JsonRecord; actionBusy: string | null; runAction: (action: () => Promise<unknown>, id: string) => Promise<void> }): React.JSX.Element {
  const proposals = governance.pendingProposals || [];
  const executions = governance.executions || [];
  return (
    <section className="fabric-panel">
      <div className="fabric-panel-head"><div><div className="fabric-kicker">HUMAN-GOVERNED POLICY</div><h2>Retrieval Policy Control</h2></div><span className="fabric-severity stable">approval gated</span></div>
      <p className="fabric-policy-note">Recommendations may be automated. Staging, apply, verify, and rollback remain explicit operator actions with audit evidence.</p>
      <div className="fabric-section-title">Pending recommendations</div>
      <div className="fabric-list">
        {proposals.map((proposal: JsonRecord) => <div key={proposal.id} className="fabric-policy-row"><div><strong>{proposal.title}</strong><span>{proposal.rationale}</span></div><div className="fabric-actions"><button disabled={actionBusy === proposal.id} onClick={() => void runAction(() => window.hermesAPI.decideHccRetrievalQualityProposal(proposal.id, "approved"), proposal.id)}>Approve</button><button disabled={actionBusy === proposal.id} onClick={() => void runAction(() => window.hermesAPI.decideHccRetrievalQualityProposal(proposal.id, "rejected"), proposal.id)}>Reject</button></div></div>)}
        {!proposals.length && <div className="fabric-empty">No pending policy recommendations.</div>}
      </div>
      <div className="fabric-section-title">Execution ledger</div>
      <div className="fabric-list">
        {executions.map((execution: JsonRecord) => <div key={execution.id} className="fabric-policy-row"><div><strong>{execution.id}</strong><span>Status: {execution.status}</span></div><div className="fabric-actions">{execution.status === "staged" && <button onClick={() => void runAction(() => window.hermesAPI.applyHccRetrievalPolicyExecution(execution.id), execution.id)}>Apply</button>}{execution.status === "applied" && <button onClick={() => void runAction(() => window.hermesAPI.verifyHccRetrievalPolicyExecution(execution.id), execution.id)}>Verify</button>}{["applied", "verified"].includes(execution.status) && <button onClick={() => void runAction(() => window.hermesAPI.rollbackHccRetrievalPolicyExecution(execution.id), execution.id)}>Rollback</button>}</div></div>)}
        {!executions.length && <div className="fabric-empty">No policy execution recorded.</div>}
      </div>
    </section>
  );
}

function Flow({ topology, cognitiveMap }: { topology: JsonRecord; cognitiveMap: JsonRecord }): React.JSX.Element {
  const nodes = topology.nodes || [];
  const edges = topology.edges || [];
  return <section className="fabric-panel"><div className="fabric-panel-head"><div><div className="fabric-kicker">EXECUTION TOPOLOGY</div><h2>Event / Command / Memory Flow</h2></div><span className="fabric-severity stable">observed</span></div><div className="fabric-stat-grid"><Stat value={nodes.length} label="topology nodes" /><Stat value={edges.length} label="topology edges" /><Stat value={cognitiveMap.summary?.nodeCount || 0} label="memory nodes" /><Stat value={cognitiveMap.summary?.edgeCount || 0} label="memory edges" /></div><div className="fabric-flow-grid">{nodes.slice(0, 24).map((node: JsonRecord) => <article key={node.id}><span>{node.kind}</span><strong>{node.label}</strong><small>{node.status || "observed"}</small></article>)}</div>{!nodes.length && <div className="fabric-empty">No execution topology recorded.</div>}</section>;
}

function Stat({ value, label, alert = false }: { value: number | string; label: string; alert?: boolean }): React.JSX.Element { return <div className={alert ? "fabric-stat alert" : "fabric-stat"}><strong>{value}</strong><span>{label}</span></div>; }

export default IntelligenceFabric;
