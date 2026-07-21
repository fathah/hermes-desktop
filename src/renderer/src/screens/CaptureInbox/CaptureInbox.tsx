import { useCallback, useEffect, useState } from "react";

type TargetType = "project_task" | "project_research" | "memory_capsule" | "learning_topic" | "project_create";
interface CaptureRoute { id: string; targetType: TargetType; targetId?: string; status: string; appliedEntityId?: string; appliedEntityType?: string; routePayload: Record<string, unknown> }
interface CaptureItem {
  id: string; title: string; content: string; status: string; tags: string[]; domainIds: string[];
  classification: { targetType: TargetType; targetId?: string; confidence: number; method: string; evidence: Array<{ signal: string; value: unknown }>; requiresTargetConfirmation?: boolean };
  provenance: { sourceType: string; sourceUri?: string; capturedBy: string; capturedAt: number };
  route?: CaptureRoute | null; events: Array<{ id: string; eventType: string; actor: string; createdAt: number }>;
}
interface CaptureCenter { items: CaptureItem[]; total: number; summary: { classified: number; pendingApproval: number; applied: number; rejected: number; ambiguous: number } }

const TARGETS: Array<{ id: TargetType; label: string }> = [
  { id: "project_task", label: "Project task" }, { id: "project_research", label: "Project research" },
  { id: "memory_capsule", label: "Memory capsule" }, { id: "learning_topic", label: "Learning topic" },
  { id: "project_create", label: "New project" },
];

function CaptureInbox(): React.JSX.Element {
  const [center, setCenter] = useState<CaptureCenter | null>(null);
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState("text");
  const [projectId, setProjectId] = useState("");
  const [intendedTarget, setIntendedTarget] = useState<TargetType | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCenter(await window.hermesAPI.getHccCaptures() as CaptureCenter); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Capture Inbox unavailable"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const capture = async (): Promise<void> => {
    if (!content.trim()) return;
    setBusy("capture"); setError(null);
    try {
      await window.hermesAPI.createHccCapture({ content: content.trim(), sourceType, projectId: projectId.trim() || undefined, intendedTarget: intendedTarget || undefined });
      setContent(""); setIntendedTarget(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Capture failed"); }
    finally { setBusy(null); }
  };

  const stage = async (item: CaptureItem): Promise<void> => {
    setBusy(`stage:${item.id}`); setError(null);
    try { await window.hermesAPI.stageHccCapture(item.id); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Route staging failed"); }
    finally { setBusy(null); }
  };

  const decide = async (item: CaptureItem, decision: "approve" | "reject"): Promise<void> => {
    if (!item.route) return;
    setBusy(`${decision}:${item.id}`); setError(null);
    try { await window.hermesAPI.decideHccCaptureRoute(item.route.id, decision, `${decision} from native Capture Inbox`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : `Capture ${decision} failed`); }
    finally { setBusy(null); }
  };

  return <div className="hcc-project-detail-screen capture-inbox-screen">
    <section className="war-room-hero-card"><div><div className="war-room-card-kicker">HCC OS / Universal ingress</div><h1 className="war-room-title">Capture Inbox</h1><p className="war-room-subtitle">Capture once. Classify with explicit evidence. Route only after approval.</p></div><button className="war-room-refresh-btn" onClick={() => void load()}>Refresh</button></section>
    {error && <div className="war-room-error-card"><div className="war-room-error-copy">{error}</div></div>}
    <section className="war-room-hero-grid">
      <article className="war-room-stat-card"><div className="war-room-stat-label">Captured</div><div className="war-room-stat-value">{center?.total || 0}</div></article>
      <article className="war-room-stat-card"><div className="war-room-stat-label">Pending approval</div><div className="war-room-stat-value">{center?.summary.pendingApproval || 0}</div></article>
      <article className="war-room-stat-card"><div className="war-room-stat-label">Applied</div><div className="war-room-stat-value">{center?.summary.applied || 0}</div></article>
      <article className="war-room-stat-card"><div className="war-room-stat-label">Needs clarification</div><div className="war-room-stat-value">{center?.summary.ambiguous || 0}</div></article>
    </section>
    <section className="war-room-panel capture-composer">
      <div><div className="war-room-card-kicker">Quick capture</div><div className="war-room-panel-title">Raw input stays immutable in provenance</div></div>
      <textarea aria-label="Capture content" className="war-room-input" placeholder="Task, URL, decision, lesson, idea…" value={content} onChange={(event) => setContent(event.target.value)} />
      <div className="capture-controls">
        <select aria-label="Capture source type" className="war-room-input" value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="text">Text</option><option value="url">URL</option><option value="file">File</option><option value="voice">Voice transcript</option></select>
        <input aria-label="Capture project ID" className="war-room-input" placeholder="Optional project ID" value={projectId} onChange={(event) => setProjectId(event.target.value)} />
        <select aria-label="Capture explicit target" className="war-room-input" value={intendedTarget} onChange={(event) => setIntendedTarget(event.target.value as TargetType | "")}><option value="">Auto-classify with rules</option>{TARGETS.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select>
      </div>
      <button className="war-room-refresh-btn capture-primary" disabled={!content.trim() || Boolean(busy)} onClick={() => void capture()}>Capture and classify</button>
    </section>
    <section className="capture-list">
      {(center?.items || []).map((item) => <article className={`war-room-panel capture-card status-${item.status}`} key={item.id}>
        <div className="capture-card-head"><div><div className="war-room-item-title">{item.title}</div><div className="war-room-item-meta">{item.provenance.sourceType} · {item.provenance.capturedBy} · {item.status}</div></div><span className={`war-room-pill ${item.classification.requiresTargetConfirmation ? "tone-risk" : "tone-healthy"}`}>{Math.round(item.classification.confidence * 100)}% · {item.classification.method}</span></div>
        <div className="capture-content">{item.content}</div>
        <div className="capture-route-preview"><strong>{item.classification.targetType.replaceAll("_", " ")}</strong><span>{item.classification.targetId || "No bound entity"}</span>{item.classification.evidence.map((evidence) => <code key={evidence.signal}>{evidence.signal}: {JSON.stringify(evidence.value)}</code>)}</div>
        {item.classification.requiresTargetConfirmation && <div className="capture-warning">Low-confidence fallback. Set an explicit target before staging.</div>}
        {!item.route && <button className="war-room-refresh-btn" disabled={Boolean(busy) || Boolean(item.classification.requiresTargetConfirmation)} onClick={() => void stage(item)}>Stage route · no apply</button>}
        {item.route && <div className="capture-governance"><div><strong>{item.route.targetType.replaceAll("_", " ")}</strong><span>{item.route.status} · {item.route.appliedEntityId || "no mutation yet"}</span></div>{item.route.status === "pending_approval" && <div className="war-room-action-row"><button className="war-room-refresh-btn capture-primary" disabled={Boolean(busy)} onClick={() => void decide(item, "approve")}>Approve and apply</button><button className="war-room-refresh-btn" disabled={Boolean(busy)} onClick={() => void decide(item, "reject")}>Reject</button></div>}</div>}
        <details><summary>Audit trail · {item.events.length}</summary>{item.events.map((event) => <div className="war-room-item-meta" key={event.id}>{event.eventType} · {event.actor}</div>)}</details>
      </article>)}
      {!center?.items.length && <div className="war-room-panel"><div className="war-room-panel-title">Inbox clear</div><div className="war-room-subtitle">Capture a task, reference, decision, lesson, or project idea.</div></div>}
    </section>
  </div>;
}

export default CaptureInbox;
