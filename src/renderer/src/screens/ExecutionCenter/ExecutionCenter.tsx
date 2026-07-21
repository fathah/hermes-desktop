import { useCallback, useEffect, useMemo, useState } from "react";
import type { HccExecution, HccExecutionList, HccExecutionStatus, HccExecutor } from "../../types/hcc";

export const HCC_EXECUTION_FOCUS_EVENT = "hcc:execution-focus";
export const HCC_VIEW_REQUEST_EVENT = "hcc:view-request";

type Filter = "all" | "pending_approval" | "active" | "succeeded" | "failed";

interface ExecutorPayload {
  items: HccExecutor[];
  count: number;
}

const ACTIVE_STATUSES = new Set<HccExecutionStatus>(["approved", "dispatching", "running"]);

function ExecutionCenter(): React.JSX.Element {
  const [data, setData] = useState<HccExecutionList | null>(null);
  const [executors, setExecutors] = useState<HccExecutor[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetGateway, setTargetGateway] = useState("project-builder-gateway");
  const [task, setTask] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [executionPayload, executorPayload] = await Promise.all([
        window.hermesAPI.getHccExecutions(undefined, 100) as Promise<HccExecutionList>,
        window.hermesAPI.getHccExecutors() as Promise<ExecutorPayload>,
      ]);
      setData(executionPayload);
      setExecutors(executorPayload.items.filter((item) => item.available && item.controlActions.includes("gateway.ask")));
      setSelectedId((current) => current && executionPayload.items.some((item) => item.id === current)
        ? current
        : executionPayload.items[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load execution ledger");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const handler = (event: Event): void => {
      const executionId = (event as CustomEvent<{ executionId?: string }>).detail?.executionId;
      if (!executionId) return;
      setFilter("all");
      setSelectedId(executionId);
    };
    window.addEventListener(HCC_EXECUTION_FOCUS_EVENT, handler as EventListener);
    return () => window.removeEventListener(HCC_EXECUTION_FOCUS_EVENT, handler as EventListener);
  }, []);
  useEffect(() => {
    if (!data?.items.some((item) => ACTIVE_STATUSES.has(item.status))) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [data?.items, load]);

  const filtered = useMemo(() => {
    const items = data?.items || [];
    if (filter === "all") return items;
    if (filter === "active") return items.filter((item) => ACTIVE_STATUSES.has(item.status));
    if (filter === "failed") return items.filter((item) => ["failed", "denied", "rolled_back"].includes(item.status));
    return items.filter((item) => item.status === filter);
  }, [data?.items, filter]);

  const selected = data?.items.find((item) => item.id === selectedId) || filtered[0] || null;

  const createProposal = async (): Promise<void> => {
    if (!task.trim() || !targetGateway) return;
    setActing("create");
    setError(null);
    try {
      const item = await window.hermesAPI.createHccExecution({
        kind: "handoff",
        action: "gateway.ask",
        sourceGateway: "coding-gateway",
        targetGateway,
        requestedBy: "desktop-operator",
        payload: { task: task.trim() },
        requireApproval: true,
      }) as HccExecution;
      setTask("");
      await load();
      setSelectedId(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create execution proposal");
    } finally {
      setActing(null);
    }
  };

  const act = async (action: "approve" | "deny" | "refresh" | "retry" | "rollback"): Promise<void> => {
    if (!selected) return;
    setActing(action);
    setError(null);
    try {
      if (action === "approve" || action === "deny") {
        await window.hermesAPI.decideHccExecution(selected.id, action, "desktop-operator", `${action}d in native Execution Center`);
      } else if (action === "refresh") {
        await window.hermesAPI.refreshHccExecution(selected.id, "desktop-operator");
      } else if (action === "retry") {
        await window.hermesAPI.retryHccExecution(selected.id, "desktop-operator");
      } else {
        await window.hermesAPI.rollbackHccExecution(selected.id, "desktop-operator", "Stopped in native Execution Center");
      }
      await load();
      setSelectedId(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} execution`);
    } finally {
      setActing(null);
    }
  };

  if (loading && !data) return <div className="execution-state">Loading durable execution ledger…</div>;
  if (error && !data) return <div className="execution-state error">{error}</div>;

  return (
    <main className="execution-screen">
      <header className="execution-header">
        <div>
          <div className="execution-kicker">HUMAN-GATED RUNTIME</div>
          <h1>Execution Center</h1>
          <p>Propose, approve, dispatch, acknowledge, verify, and stop work across the gateway fleet.</p>
        </div>
        <button className="execution-refresh" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh ledger"}</button>
      </header>

      {error && <div className="execution-error" role="alert">{error}</div>}

      <section className="execution-summary" aria-label="Execution summary">
        <Summary value={data?.count || 0} label="ledger entries" />
        <Summary value={data?.pendingApproval || 0} label="awaiting approval" alert={(data?.pendingApproval || 0) > 0} />
        <Summary value={data?.active || 0} label="active dispatches" />
        <Summary value={data?.failed || 0} label="failed" alert={(data?.failed || 0) > 0} />
        <Summary value={executors.length} label="real executors" />
      </section>

      <section className="execution-composer" aria-label="Create execution proposal">
        <div>
          <span>NEW PROPOSAL</span>
          <strong>Dispatch grounded work</strong>
        </div>
        <select aria-label="Target gateway" value={targetGateway} onChange={(event) => setTargetGateway(event.target.value)}>
          {executors.map((item) => <option key={item.gatewayId} value={item.gatewayId}>{item.displayName}</option>)}
        </select>
        <textarea aria-label="Execution task" value={task} onChange={(event) => setTask(event.target.value)} placeholder="Describe the exact output and verification boundary…" />
        <button onClick={() => void createProposal()} disabled={!task.trim() || acting === "create"}>{acting === "create" ? "Creating…" : "Stage for approval"}</button>
      </section>

      <div className="execution-filters" role="tablist" aria-label="Execution status filter">
        {(["all", "pending_approval", "active", "succeeded", "failed"] as Filter[]).map((item) => (
          <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item.replaceAll("_", " ")}</button>
        ))}
      </div>

      <section className="execution-layout">
        <div className="execution-list" aria-label="Execution ledger">
          {filtered.map((item) => (
            <button key={item.id} className={`execution-row ${selected?.id === item.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}>
              <span className={`execution-status-dot ${item.status}`} />
              <span className="execution-row-copy">
                <strong>{item.targetGateway}</strong>
                <span>{item.action} · attempt {item.attemptCount}/{item.maxAttempts}</span>
                <small>{describeExecutionTask(item)}</small>
              </span>
              <span className={`execution-status ${item.status}`}>{item.status.replaceAll("_", " ")}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="execution-empty">No executions match this view.</div>}
        </div>
        {selected && <ExecutionDetail item={selected} acting={acting} onAction={act} />}
      </section>
    </main>
  );
}

function Summary({ value, label, alert = false }: { value: number; label: string; alert?: boolean }): React.JSX.Element {
  return <div className={alert ? "alert" : ""}><strong>{value}</strong><span>{label}</span></div>;
}

function ExecutionDetail({ item, acting, onAction }: { item: HccExecution; acting: string | null; onAction: (action: "approve" | "deny" | "refresh" | "retry" | "rollback") => Promise<void> }): React.JSX.Element {
  const output = item.result?.output;
  return (
    <article className="execution-detail">
      <header>
        <div><span>{item.id}</span><h2>{item.targetGateway}</h2></div>
        <span className={`execution-status ${item.status}`}>{item.status.replaceAll("_", " ")}</span>
      </header>
      <div className="execution-meta">
        <Meta label="Risk" value={item.riskLevel} />
        <Meta label="Transport" value={item.transport} />
        <Meta label="Remote run" value={item.remoteRunId || "not dispatched"} />
        <Meta label="Requested by" value={item.requestedBy} />
      </div>
      <section className="execution-task"><span>TASK CONTRACT</span><p>{describeExecutionTask(item)}</p></section>
      {getRecommendationProvenance(item) && <section className="execution-task"><span>RECOMMENDATION PROVENANCE</span><p>{getRecommendationProvenance(item)}</p></section>}
      <div className="execution-actions">
        {item.status === "pending_approval" && <><button className="primary" onClick={() => void onAction("approve")} disabled={Boolean(acting)}>Approve & dispatch</button><button onClick={() => void onAction("deny")} disabled={Boolean(acting)}>Deny</button></>}
        {ACTIVE_STATUSES.has(item.status) && <><button className="primary" onClick={() => void onAction("refresh")} disabled={Boolean(acting)}>Check status</button><button className="danger" onClick={() => void onAction("rollback")} disabled={Boolean(acting)}>Stop execution</button></>}
        {item.status === "failed" && item.attemptCount < item.maxAttempts && <button className="primary" onClick={() => void onAction("retry")} disabled={Boolean(acting)}>Retry safely</button>}
      </div>
      {item.error && <div className="execution-error">{item.error}</div>}
      {output !== undefined && output !== null && <section className="execution-output"><span>VERIFIED OUTPUT</span><pre>{typeof output === "string" ? output : JSON.stringify(output, null, 2)}</pre></section>}
      <section className="execution-lineage">
        <h3>Execution lineage</h3>
        {item.audit.map((event) => <div key={event.id}><span className="lineage-node" /><div><strong>{event.event_type.replaceAll("_", " ")}</strong><span>{event.actor} · {new Date(event.created_at * 1000).toLocaleString()}</span>{event.note && <small>{event.note}</small>}</div></div>)}
      </section>
      <section className="execution-artifacts"><h3>Artifacts</h3>{item.artifacts.map((artifact) => <div key={artifact.id}><strong>{artifact.name}</strong><span>{artifact.kind}</span></div>)}{item.artifacts.length === 0 && <p>No artifacts returned yet.</p>}</section>
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function describeExecutionTask(item: HccExecution): string {
  const payload = (item.payload || {}) as Record<string, unknown>;
  return String(
    payload.task
    || payload.operatorIntent
    || payload.input
    || payload.recommendationLabel
    || "No task recorded",
  );
}

function getRecommendationProvenance(item: HccExecution): string | null {
  const payload = (item.payload || {}) as Record<string, unknown>;
  const label = payload.recommendationLabel;
  const actionType = payload.recommendationActionType;
  if (!label && !actionType) return null;
  return [
    label ? `Source recommendation: ${String(label)}` : null,
    actionType ? `Original action: ${String(actionType)}` : null,
  ].filter(Boolean).join(" · ");
}

export default ExecutionCenter;
