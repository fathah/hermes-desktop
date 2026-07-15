import { useCallback, useEffect, useState } from "react";
import type { HccReviewCenter } from "../../types/hcc";

interface GovernanceProposal {
  proposalId: string;
  dimension: string;
  actionType: string;
  targetId: string;
  status: "proposed" | "approved" | "applied" | "rejected" | "rolled_back";
  requiresApproval: boolean;
}

interface ReviewCenterProps {
  onOpenProject: (projectId: string) => void;
  onOpenDomain: (domainId: string) => void;
  onOpenMemory: () => void;
}

function ReviewCenter({ onOpenProject, onOpenDomain, onOpenMemory }: ReviewCenterProps): React.JSX.Element {
  const [data, setData] = useState<HccReviewCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [proposals, setProposals] = useState<GovernanceProposal[]>([]);
  const [proposalBusy, setProposalBusy] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reviewData, proposalData] = await Promise.all([
        window.hermesAPI.getHccReviewCenter(),
        window.hermesAPI.getHccGovernanceProposals(""),
      ]);
      setData(reviewData as HccReviewCenter);
      const items = ((proposalData as { items?: GovernanceProposal[] }).items || []);
      setProposals(items.filter((item) => ["review", "reality", "recovery"].includes(item.dimension)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Review Center");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const openScope = (scopeType: string, scopeId: string): void => {
    if (scopeType === "project") onOpenProject(scopeId);
    else onOpenDomain(scopeId);
  };

  const stageIntervention = async (interventionId: string): Promise<void> => {
    setStagingId(interventionId);
    setStageMessage(null);
    try {
      await window.hermesAPI.stageHccReviewIntervention(interventionId, "desktop-operator");
      setStageMessage("Intervention staged. Approval is required before live mutation.");
      await loadReviews();
    } catch (err) {
      setStageMessage(err instanceof Error ? err.message : "Failed to stage intervention");
    } finally {
      setStagingId(null);
    }
  };

  const actOnProposal = async (proposalId: string, action: "approve" | "apply" | "reject" | "rollback"): Promise<void> => {
    setProposalBusy(proposalId);
    setStageMessage(null);
    try {
      await window.hermesAPI.actOnHccGovernanceProposal(proposalId, action, "desktop-operator");
      setStageMessage(`Proposal ${action} completed.`);
      await loadReviews();
    } catch (err) {
      setStageMessage(err instanceof Error ? err.message : `Failed to ${action} proposal`);
    } finally {
      setProposalBusy(null);
    }
  };

  if (loading) return <div className="hcc-review-screen"><div className="war-room-loading">Loading reviews…</div></div>;
  if (error || !data) {
    return (
      <div className="hcc-review-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Review Center unavailable</div>
          <div className="war-room-error-copy">{error || "No review data returned."}</div>
          <button className="war-room-refresh-btn" onClick={() => void loadReviews()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="hcc-review-screen">
      <section className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Review Engine</div>
          <h1 className="war-room-title">{data.hero.title}</h1>
          <p className="war-room-subtitle">{data.hero.subtitle}</p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void loadReviews()}>Refresh</button>
      </section>

      <section className="war-room-hero-grid">
        <div className="war-room-stat-card"><div className="war-room-stat-label">Reviews</div><div className="war-room-stat-value">{data.summary.total}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">High urgency</div><div className="war-room-stat-value">{data.summary.highUrgency}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Projects</div><div className="war-room-stat-value">{data.summary.projectReviews}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Domains</div><div className="war-room-stat-value">{data.summary.domainReviews}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Graph edges</div><div className="war-room-stat-value">{data.summary.graphEdgeCount}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Dependency risk</div><div className="war-room-stat-value">{data.summary.elevatedDependencyRisk}</div></div>
      </section>

      <section className="war-room-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Review queue</div>
          <div className="war-room-list">
            {data.reviewItems.map((item) => (
              <button key={item.id} className="war-room-list-item war-room-list-button" onClick={() => openScope(item.scope_type, item.scope_id)}>
                <div>
                  <div className="war-room-item-title">{item.label}</div>
                  <div className="war-room-item-meta">{item.scope_type} · {item.review_cadence} · {item.dependency_count} links · graph {item.propagated_risk}</div>
                </div>
                <div className={`war-room-pill tone-${item.urgency === "high" ? "risk" : item.urgency === "medium" ? "watch" : "healthy"}`}>{item.urgency}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Interventions</div>
          <div className="war-room-list">
            {data.interventions.map((item) => (
              <div
                key={item.id}
                className="war-room-list-item war-room-list-item-stack"
              >
                <div className="war-room-item-title">{item.label}</div>
                <div className="war-room-item-meta">{item.reason}</div>
                <div className="war-room-action-row">
                  <button className="war-room-refresh-btn" onClick={() => item.action.project_id ? onOpenProject(item.action.project_id) : item.action.domain_id && onOpenDomain(item.action.domain_id)}>
                    Open scope
                  </button>
                  <button className="war-room-refresh-btn" disabled={stagingId === item.id} onClick={() => void stageIntervention(item.id)}>
                    {stagingId === item.id ? "Staging…" : "Stage approval"}
                  </button>
                </div>
              </div>
            ))}
            {data.interventions.length === 0 && <div className="war-room-item-meta">No high-severity interventions.</div>}
          </div>
          {stageMessage && <div className="war-room-item-meta">{stageMessage}</div>}
        </div>
      </section>

      <section className="war-room-panel">
        <div className="war-room-panel-title">Governance execution queue</div>
        <div className="war-room-list">
          {proposals.map((proposal) => (
            <div key={proposal.proposalId} className="war-room-list-item war-room-list-item-stack">
              <div className="war-room-item-title">{proposal.actionType} · {proposal.targetId}</div>
              <div className="war-room-item-meta">{proposal.dimension} · {proposal.status} · {proposal.requiresApproval ? "approval gated" : "direct"}</div>
              <div className="war-room-action-row">
                {proposal.status === "proposed" && <button className="war-room-refresh-btn" disabled={proposalBusy === proposal.proposalId} onClick={() => void actOnProposal(proposal.proposalId, "approve")}>Approve</button>}
                {proposal.status === "proposed" && <button className="war-room-refresh-btn" disabled={proposalBusy === proposal.proposalId} onClick={() => void actOnProposal(proposal.proposalId, "reject")}>Reject</button>}
                {proposal.status === "approved" && <button className="war-room-refresh-btn" disabled={proposalBusy === proposal.proposalId} onClick={() => void actOnProposal(proposal.proposalId, "apply")}>Apply</button>}
                {proposal.status === "applied" && <button className="war-room-refresh-btn" disabled={proposalBusy === proposal.proposalId} onClick={() => void actOnProposal(proposal.proposalId, "rollback")}>Rollback</button>}
              </div>
            </div>
          ))}
          {proposals.length === 0 && <div className="war-room-item-meta">No intervention proposals staged.</div>}
        </div>
      </section>

      <button className="war-room-panel war-room-panel-button" onClick={onOpenMemory}>
        <div className="war-room-panel-title">Review memory packet</div>
        <div className="war-room-memory-meta">{data.memoryPacket.summary.count} selected · {data.memoryPacket.summary.availableMatches} available</div>
        <div className="hcc-memory-packet-grid">
          {data.memoryPacket.items.slice(0, 6).map((item) => (
            <div key={item.id} className="hcc-memory-capsule compact">
              <div className="war-room-card-kicker">{item.kind}</div>
              <div className="war-room-item-title">{item.summary}</div>
            </div>
          ))}
        </div>
      </button>
    </div>
  );
}

export default ReviewCenter;
