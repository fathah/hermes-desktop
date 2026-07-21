import { useCallback, useEffect, useState } from "react";
import { HCC_EXECUTION_FOCUS_EVENT, HCC_VIEW_REQUEST_EVENT } from "../ExecutionCenter/ExecutionCenter";

type FabricTab = "briefing" | "retrieval" | "policy" | "flow";
type JsonRecord = Record<string, any>;

function IntelligenceFabric({ onOpenExecutionCenter }: { onOpenExecutionCenter?: () => void } = {}): React.JSX.Element {
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
      {tab === "briefing" && <Briefing brief={brief} summary={summary} actionBusy={actionBusy} runAction={runAction} onJumpToFlow={() => setTab("flow")} onOpenExecutionCenter={onOpenExecutionCenter} />}
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

function Briefing({
  brief,
  summary,
  actionBusy,
  runAction,
  onJumpToFlow,
  onOpenExecutionCenter,
}: {
  brief: JsonRecord;
  summary: JsonRecord;
  actionBusy: string | null;
  runAction: (action: () => Promise<unknown>, busyId: string) => Promise<void>;
  onJumpToFlow: () => void;
  onOpenExecutionCenter?: () => void;
}): React.JSX.Element {
  const runtime = brief.runtimePosture || {};
  const leadReasoning = brief.leadReasoning || {};
  const autonomousQueue = brief.autonomousQueue || { items: [] };
  const recommendations = brief.recommendations || [];

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
      <div className="fabric-policy-strip">
        <strong>Runtime posture</strong><span>{runtime.mode || "nominal"}</span>
        <strong>Primary signal</strong><span>{runtime.primarySignal || brief.topBlocker || "none"}</span>
        <strong>Queue</strong><span>{autonomousQueue.items?.length || 0} autonomous actions</span>
      </div>
      <div className="fabric-section-title">Reasoning focus</div>
      <div className="fabric-list">
        {leadReasoning.topEdge && <div className="fabric-list-row"><strong>Top edge</strong><span>{leadReasoning.topEdge.gatewayA} ↔ {leadReasoning.topEdge.gatewayB}</span></div>}
        {leadReasoning.topHotspot && <div className="fabric-list-row"><strong>Hotspot</strong><span>{leadReasoning.topHotspot.gateway} · {leadReasoning.topHotspot.scopeCount} scope links</span></div>}
        {leadReasoning.topContextPressure && <div className="fabric-list-row"><strong>Context pressure</strong><span>{leadReasoning.topContextPressure.contextId} · {leadReasoning.topContextPressure.crossGatewayLinks} cross-gateway links</span></div>}
        {!leadReasoning.topEdge && !leadReasoning.topHotspot && !leadReasoning.topContextPressure && <div className="fabric-empty">No reasoning hotspot recorded.</div>}
      </div>
      <div className="fabric-section-title">Recommended operator attention</div>
      <div className="fabric-recommendations">
        {recommendations.map((item: JsonRecord) => {
          const actionType = item.action?.type || "unknown";
          const targetGateway = item.action?.targetGateway || item.action?.toGateway || "project-builder-gateway";
          const busyId = `rec-${item.label}-${actionType}`;
          return <article key={`${item.label}-${item.priority}`}>
            <strong>{item.label}</strong>
            <span>{item.why}</span>
            <small>Priority {item.priority} · action {actionType} · target {targetGateway}</small>
            <div className="fabric-actions">
              <button disabled={actionBusy === busyId} onClick={() => void runAction(async () => {
                const response = await window.hermesAPI.executeHccRecommendation(item.label, { ...item.action, targetGateway });
                const payload = (response && typeof response === "object" && "item" in response ? (response as { item?: JsonRecord }).item : response) as JsonRecord | null;
                const execution = (payload?.execution || payload?.item?.execution || payload) as JsonRecord | null;
                const executionId = typeof execution?.id === "string" ? execution.id : null;
                if (executionId) {
                  window.dispatchEvent(new CustomEvent(HCC_EXECUTION_FOCUS_EVENT, { detail: { executionId } }));
                }
                window.dispatchEvent(new CustomEvent(HCC_VIEW_REQUEST_EVENT, { detail: { view: "execution-center" } }));
                onOpenExecutionCenter?.();
                onJumpToFlow();
              }, busyId)}>Stage in Execution Center</button>
              <button disabled={actionBusy === busyId} onClick={onJumpToFlow}>View flow</button>
            </div>
          </article>;
        })}
        {!recommendations.length && <div className="fabric-empty">No recommendation recorded.</div>}
      </div>
      <div className="fabric-section-title">Autonomous queue</div>
      <div className="fabric-list">
        {(autonomousQueue.items || []).map((item: JsonRecord) => <div key={item.id} className="fabric-policy-row"><div><strong>{item.label}</strong><span>{item.policy?.mode || item.policyMode || "operator review"}</span></div><div className="fabric-actions"><span>{item.status || "pending"}</span></div></div>)}
        {!autonomousQueue.items?.length && <div className="fabric-empty">No autonomous queue item recorded.</div>}
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
