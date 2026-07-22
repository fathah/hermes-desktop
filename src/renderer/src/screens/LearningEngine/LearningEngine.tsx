import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HccLearningDashboard,
  HccLearningRecommendation,
  HccLearningStage,
  HccLearningTopic,
} from "../../types/hcc";

const NEXT_STAGE: Partial<Record<HccLearningStage, HccLearningStage>> = {
  discovered: "studying",
  studying: "applying",
  applying: "demonstrated",
};

interface LearningPattern { id: string; signature: string; category: string; projectIds: string[]; projectCount: number; evidenceCount: number; lessons: string[]; eligibleForPromotion: boolean }
interface LearningPromotion { id: string; patternId: string; targetType: string; targetId: string; lesson: string; status: string; appliedArtifact?: { type: string; id: string } | null }
interface LearningIntelligence { patterns: LearningPattern[]; promotions: LearningPromotion[]; summary: { patterns: number; crossProject: number; pendingPromotions: number; appliedPromotions: number } }

function LearningEngine(): React.JSX.Element {
  const [dashboard, setDashboard] = useState<HccLearningDashboard | null>(null);
  const [intelligence, setIntelligence] = useState<LearningIntelligence | null>(null);
  const [promotionDrafts, setPromotionDrafts] = useState<Record<string, { targetType: string; targetId: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [projectIds, setProjectIds] = useState("");
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<Record<string, string>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [base, deep] = await Promise.all([window.hermesAPI.getHccLearning(), window.hermesAPI.getHccLearningIntelligence()]);
      setDashboard(base as HccLearningDashboard);
      setIntelligence(deep as LearningIntelligence);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Learning Engine.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const recommendations = useMemo(
    () => new Map((dashboard?.recommendations || []).map((item) => [item.topicId, item])),
    [dashboard],
  );

  const createTopic = async (): Promise<void> => {
    if (!title.trim() || !outcome.trim()) return;
    setBusy("create");
    try {
      await window.hermesAPI.createHccLearningTopic({
        title: title.trim(),
        targetOutcome: outcome.trim(),
        projectIds: projectIds.split(",").map((item) => item.trim()).filter(Boolean),
      });
      setTitle(""); setOutcome(""); setProjectIds("");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create learning topic.");
    } finally { setBusy(null); }
  };

  const appendEvent = async (
    topic: HccLearningTopic,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    setBusy(`${topic.id}:${eventType}`);
    try {
      await window.hermesAPI.appendHccLearningEvent(topic.id, eventType, payload);
      if (eventType === "synthesis_recorded") {
        setSyntheses((current) => ({ ...current, [topic.id]: "" }));
      }
      if (eventType === "outcome_evidence_recorded") {
        setEvidence((current) => ({ ...current, [topic.id]: "" }));
      }
      await load();
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : "Learning event rejected.");
    } finally { setBusy(null); }
  };

  const promote = async (recommendation: HccLearningRecommendation): Promise<void> => {
    setBusy(recommendation.id);
    try {
      await window.hermesAPI.promoteHccLearningRecommendation(recommendation.id);
      await load();
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : "Recommendation promotion failed.");
    } finally { setBusy(null); }
  };

  const stageDeepPromotion = async (pattern: LearningPattern): Promise<void> => {
    const draft = promotionDrafts[pattern.id] || { targetType: "skill_spec", targetId: pattern.signature };
    setBusy(`deep:${pattern.id}`);
    try { await window.hermesAPI.stageHccLearningPromotion({ patternId: pattern.id, targetType: draft.targetType, targetId: draft.targetId, lesson: pattern.lessons[0] }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Learning promotion staging failed."); }
    finally { setBusy(null); }
  };

  const decideDeepPromotion = async (promotion: LearningPromotion, decision: "approve" | "reject"): Promise<void> => {
    setBusy(`decide:${promotion.id}`);
    try { await window.hermesAPI.decideHccLearningPromotion(promotion.id, decision, `${decision} from native Learning Engine`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Learning promotion decision failed."); }
    finally { setBusy(null); }
  };

  if (loading && !dashboard) return <div className="war-room-loading">Replaying the learning event log…</div>;

  return (
    <div className="hcc-learning-screen">
      <section className="war-room-hero-card learning-hero">
        <div><div className="war-room-card-kicker">Deep Advantage · M10</div><h1 className="war-room-title">{dashboard?.hero.title || "Learning Engine"}</h1><p className="war-room-subtitle">{dashboard?.hero.subtitle || "Turn captured material into demonstrated capability."}</p></div>
        <button className="war-room-refresh-btn" onClick={() => void load()} disabled={loading}>{loading ? "Replaying…" : "Refresh"}</button>
      </section>

      {error && <div className="war-room-error-card"><div className="war-room-item-title">Learning Engine error</div><div className="war-room-error-copy">{error}</div></div>}

      <section className="war-room-hero-grid">
        {[["Topics", dashboard?.summary.topics || 0], ["Synthesis debt", dashboard?.summary.synthesisDebt || 0], ["Applying", dashboard?.summary.applying || 0], ["Demonstrated", dashboard?.summary.demonstrated || 0]].map(([label, value]) => <article className="war-room-stat-card" key={label}><div className="war-room-stat-label">{label}</div><div className="war-room-stat-value">{value}</div></article>)}
      </section>

      <section className="war-room-panel learning-create-panel">
        <div><div className="war-room-card-kicker">Outcome-first capture</div><div className="war-room-panel-title">Create learning topic</div></div>
        <input className="war-room-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Topic title" />
        <input className="war-room-input" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Demonstrable target outcome" />
        <input className="war-room-input" value={projectIds} onChange={(event) => setProjectIds(event.target.value)} placeholder="Project IDs, comma separated" />
        <button className="war-room-refresh-btn learning-primary" onClick={() => void createTopic()} disabled={busy === "create" || !title.trim() || !outcome.trim()}>Capture topic</button>
      </section>

      <section className="learning-topic-grid">
        {(dashboard?.items || []).map((topic) => {
          const recommendation = recommendations.get(topic.id);
          const nextStage = NEXT_STAGE[topic.stage];
          return <article className="war-room-panel learning-topic-card" key={topic.id}>
            <div className="learning-topic-head"><div><div className="war-room-card-kicker">{topic.stage}</div><h2>{topic.title}</h2></div><div className="learning-progress-score">{topic.progressScore}</div></div>
            <p className="war-room-subtitle">{topic.summary || topic.targetOutcome}</p>
            <div className="learning-outcome"><span>Target outcome</span><strong>{topic.targetOutcome}</strong></div>
            <div className="learning-metrics">{[["Sources", topic.sourceCount], ["Syntheses", topic.synthesisCount], ["Mission", topic.missionLearningCount || 0], ["Debt", topic.synthesisDebt]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            {topic.missionLearnings?.length > 0 && <div className="learning-mission-provenance">
              <div className="war-room-card-kicker">Mission provenance</div>
              {topic.missionLearnings.slice(-3).map((learning, index) => <div className="learning-mission-row" key={`${learning.missionRef?.id || topic.id}:${index}`}>
                <span className={`learning-category ${learning.category}`}>{learning.category}</span>
                <div><strong>{learning.missionRef?.title || learning.projectId || "Learning event"}</strong><p>{learning.text}</p>{learning.runRef?.id && <small>Run {learning.runRef.id}</small>}</div>
              </div>)}
            </div>}
            <div className="learning-inline-action"><input className="war-room-input" value={syntheses[topic.id] || ""} onChange={(event) => setSyntheses((current) => ({ ...current, [topic.id]: event.target.value }))} placeholder="Synthesis title / artifact" /><button className="war-room-refresh-btn" disabled={!syntheses[topic.id]?.trim() || Boolean(busy)} onClick={() => void appendEvent(topic, "synthesis_recorded", { title: syntheses[topic.id].trim(), artifactRef: { type: "note", id: `note.${Date.now()}` } })}>Record</button></div>
            <div className="learning-inline-action"><input className="war-room-input" value={evidence[topic.id] || ""} onChange={(event) => setEvidence((current) => ({ ...current, [topic.id]: event.target.value }))} placeholder="Outcome evidence artifact ID" /><button className="war-room-refresh-btn" disabled={!evidence[topic.id]?.trim() || Boolean(busy)} onClick={() => void appendEvent(topic, "outcome_evidence_recorded", { artifactRef: { type: "artifact", id: evidence[topic.id].trim() } })}>Evidence</button></div>
            <div className="war-room-action-row">{nextStage && <button className="war-room-refresh-btn" disabled={Boolean(busy)} onClick={() => void appendEvent(topic, "progressed", { toStage: nextStage })}>Advance to {nextStage}</button>}{recommendation && <button className="war-room-refresh-btn learning-primary" disabled={Boolean(busy)} onClick={() => void promote(recommendation)}>Promote for approval</button>}</div>
            {recommendation && <div className="learning-recommendation"><strong>{recommendation.title}</strong><span>{recommendation.rationale}</span></div>}
          </article>;
        })}
        {!dashboard?.items.length && <div className="war-room-panel"><div className="war-room-panel-title">No learning topics</div><div className="war-room-subtitle">Capture an outcome-driven topic to start the append-only learning loop.</div></div>}
      </section>

      <section className="war-room-panel learning-intelligence-panel">
        <div><div className="war-room-card-kicker">Cross-project intelligence</div><div className="war-room-panel-title">Verified patterns and governed promotion</div></div>
        <div className="learning-metrics">{[["Patterns", intelligence?.summary.patterns || 0], ["Cross-project", intelligence?.summary.crossProject || 0], ["Pending", intelligence?.summary.pendingPromotions || 0], ["Applied", intelligence?.summary.appliedPromotions || 0]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <div className="learning-pattern-grid">{(intelligence?.patterns || []).map((pattern) => { const draft=promotionDrafts[pattern.id] || { targetType:"skill_spec",targetId:pattern.signature }; return <article key={pattern.id} className="learning-pattern-card"><div><strong>{pattern.signature}</strong><span>{pattern.projectCount} projects · {pattern.evidenceCount} evidence</span></div><p>{pattern.lessons[0]}</p><div className="learning-inline-action"><select className="war-room-input" value={draft.targetType} onChange={(e)=>setPromotionDrafts({...promotionDrafts,[pattern.id]:{...draft,targetType:e.target.value}})}><option value="skill_spec">Skill spec</option><option value="execution_policy">Execution policy</option><option value="memory_capsule">Memory capsule</option><option value="project_genome">Project genome proposal</option></select><input className="war-room-input" aria-label={`Promotion target ${pattern.signature}`} value={draft.targetId} onChange={(e)=>setPromotionDrafts({...promotionDrafts,[pattern.id]:{...draft,targetId:e.target.value}})}/><button className="war-room-refresh-btn learning-primary" disabled={!pattern.eligibleForPromotion || Boolean(busy)} onClick={()=>void stageDeepPromotion(pattern)}>Stage promotion</button></div></article>; })}</div>
        <div className="learning-promotion-list">{(intelligence?.promotions || []).map((promotion)=><div key={promotion.id} className="learning-promotion-row"><div><strong>{promotion.targetType} · {promotion.targetId}</strong><span>{promotion.status} · {promotion.lesson}</span>{promotion.appliedArtifact && <code>{promotion.appliedArtifact.type}:{promotion.appliedArtifact.id}</code>}</div>{promotion.status==="pending_approval" && <div className="war-room-action-row"><button onClick={()=>void decideDeepPromotion(promotion,"approve")}>Approve and apply</button><button onClick={()=>void decideDeepPromotion(promotion,"reject")}>Reject</button></div>}</div>)}</div>
      </section>

      <section className="war-room-panel learning-policy"><div><div className="war-room-card-kicker">Governed progression</div><div className="war-room-panel-title">Every state is replayed from evidence</div></div><span className="war-room-pill tone-healthy">{dashboard?.methodology.mutationPolicy || "append-only"}</span></section>
    </div>
  );
}

export default LearningEngine;
