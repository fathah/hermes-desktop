import { useCallback, useEffect, useState } from "react";
import type { HccProject, HccProjectGenomeCenter } from "../../types/hcc";

interface ProjectDetailProps {
  projectId: string | null;
}

const PROJECT_TRANSITIONS: Record<string, string[]> = {
  idea: ["planned", "archived"],
  planned: ["active", "paused", "archived"],
  active: ["blocked", "paused", "review", "archived"],
  blocked: ["active", "paused", "archived"],
  paused: ["active", "archived"],
  review: ["active", "completed"],
  completed: ["archived"],
  archived: [],
};

function ProjectDetail({ projectId }: ProjectDetailProps): React.JSX.Element {
  const [project, setProject] = useState<HccProject | null>(null);
  const [genome, setGenome] = useState<HccProjectGenomeCenter | null>(null);
  const [genomeDraft, setGenomeDraft] = useState({ strategicThesis: "", definitionOfDone: "", principles: "", nonNegotiables: "", constraints: "", rationale: "" });
  const [genomeBusy, setGenomeBusy] = useState<string | null>(null);
  const [genomeMessage, setGenomeMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [projectPayload, genomePayload] = await Promise.all([
        window.hermesAPI.getHccProjectDetail(projectId),
        window.hermesAPI.getHccProjectGenome(projectId),
      ]);
      setProject(projectPayload as HccProject);
      setGenome(genomePayload as HccProjectGenomeCenter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project detail");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const transitionProject = async (toStatus: string): Promise<void> => {
    if (!projectId) return;
    setTransitioning(toStatus);
    setError(null);
    try {
      const payload = (await window.hermesAPI.transitionHccProject(
        projectId,
        toStatus,
        `Transitioned from native HCC Project Detail to ${toStatus}`,
      )) as { project?: HccProject };
      if (payload.project) setProject(payload.project);
      else await loadProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project transition failed");
    } finally {
      setTransitioning(null);
    }
  };

  const stageGenomeMutation = async (): Promise<void> => {
    if (!projectId || !genome) return;
    const split = (value: string): string[] => value.split("\n").map((item) => item.trim()).filter(Boolean);
    const patch: Record<string, unknown> = {};
    if (genomeDraft.strategicThesis.trim()) patch.strategicThesis = genomeDraft.strategicThesis.trim();
    if (genomeDraft.definitionOfDone.trim()) patch.definitionOfDone = genomeDraft.definitionOfDone.trim();
    if (genomeDraft.principles.trim()) patch.principles = split(genomeDraft.principles);
    if (genomeDraft.nonNegotiables.trim()) patch.nonNegotiables = split(genomeDraft.nonNegotiables);
    if (genomeDraft.constraints.trim()) patch.constraints = split(genomeDraft.constraints);
    if (!Object.keys(patch).length || !genomeDraft.rationale.trim()) {
      setError("Genome mutation needs at least one changed field and an evidence rationale.");
      return;
    }
    setGenomeBusy("stage"); setError(null); setGenomeMessage(null);
    try {
      await window.hermesAPI.stageHccProjectGenomeProposal(projectId, { baseVersion: genome.currentVersion, patch, rationale: genomeDraft.rationale.trim(), evidence: { source: "native-project-detail", projectStatus: project?.status } });
      setGenomeMessage("Genome mutation staged. Current version remains unchanged until approval.");
      setGenomeDraft({ strategicThesis: "", definitionOfDone: "", principles: "", nonNegotiables: "", constraints: "", rationale: "" });
      await loadProject();
    } catch (err) { setError(err instanceof Error ? err.message : "Genome staging failed"); }
    finally { setGenomeBusy(null); }
  };

  const decideGenome = async (proposalId: string, decision: "approve" | "reject"): Promise<void> => {
    if (!projectId) return;
    setGenomeBusy(`${decision}:${proposalId}`); setError(null);
    try {
      await window.hermesAPI.decideHccProjectGenomeProposal(projectId, proposalId, decision, `${decision} from native Project Genome Center`);
      setGenomeMessage(decision === "approve" ? "Genome mutation approved as a new immutable version." : "Genome mutation rejected; current genome unchanged.");
      await loadProject();
    } catch (err) { setError(err instanceof Error ? err.message : `Genome ${decision} failed`); }
    finally { setGenomeBusy(null); }
  };

  const rollbackGenome = async (targetVersion: number): Promise<void> => {
    if (!projectId) return;
    setGenomeBusy(`rollback:${targetVersion}`); setError(null);
    try {
      await window.hermesAPI.rollbackHccProjectGenome(projectId, targetVersion, `Restore verified genome v${targetVersion}`);
      setGenomeMessage(`Rollback to v${targetVersion} staged for explicit approval. History remains immutable.`);
      await loadProject();
    } catch (err) { setError(err instanceof Error ? err.message : "Genome rollback staging failed"); }
    finally { setGenomeBusy(null); }
  };

  if (!projectId) {
    return (
      <div className="hcc-project-detail-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Project detail</div>
          <div className="war-room-error-copy">Select a project from Projects Index or War Room priorities.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="hcc-project-detail-screen"><div className="war-room-loading">Loading project…</div></div>;
  }

  if (error || !project) {
    return (
      <div className="hcc-project-detail-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Project detail unavailable</div>
          <div className="war-room-error-copy">{error || "No project data returned."}</div>
          <button className="war-room-refresh-btn" onClick={() => void loadProject()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hcc-project-detail-screen">
      <div className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Project Detail</div>
          <h1 className="war-room-title">{project.name}</h1>
          <p className="war-room-subtitle">{project.purpose || project.description || "No purpose yet."}</p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void loadProject()}>
          Refresh
        </button>
      </div>

      <div className="war-room-panel">
        <div className="war-room-panel-title">Lifecycle control</div>
        <div className="war-room-item-meta">Only valid transitions are exposed. Completion requires at least one recorded output.</div>
        <div className="war-room-action-row">
          {(PROJECT_TRANSITIONS[project.status] || []).map((status) => (
            <button
              key={status}
              className="war-room-refresh-btn"
              disabled={transitioning !== null}
              onClick={() => void transitionProject(status)}
            >
              {transitioning === status ? "Transitioning…" : `Move to ${status}`}
            </button>
          ))}
          {(PROJECT_TRANSITIONS[project.status] || []).length === 0 && (
            <span className="war-room-item-meta">No forward transitions available.</span>
          )}
        </div>
      </div>

      <div className="war-room-hero-grid">
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Status</div>
          <div className="war-room-stat-value">{project.status}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Momentum</div>
          <div className="war-room-stat-value">{project.momentum_score ?? 0}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Clarity</div>
          <div className="war-room-stat-value">{project.clarity_score ?? 0}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Risk</div>
          <div className="war-room-stat-value">{project.risk_score ?? 0}</div>
        </div>
      </div>

      <div className="war-room-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Execution context</div>
          <div className="war-room-list">
            <div className="war-room-list-item"><span className="war-room-item-meta">Dependency health</span><strong>{project.dependency_health || "unknown"}</strong></div>
            <div className="war-room-list-item"><span className="war-room-item-meta">Strategic relevance</span><strong>{project.strategic_relevance || "unset"}</strong></div>
            <div className="war-room-list-item"><span className="war-room-item-meta">Review cadence</span><strong>{project.review_cadence || "unset"}</strong></div>
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Milestones</div>
          <div className="war-room-list">
            {(project.milestones || []).map((item) => (
              <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div></div>
            ))}
            {(project.milestones || []).length === 0 && <div className="war-room-item-meta">No milestones recorded.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Blockers</div>
          <div className="war-room-list">
            {(project.blockers || []).map((item) => (
              <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div><span className="war-room-pill tone-risk">blocked</span></div>
            ))}
            {(project.blockers || []).length === 0 && <div className="war-room-item-meta">No active blockers.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Linked domains</div>
          <div className="war-room-list">
            {(project.linked_domains || []).map((domain) => (
              <div key={domain.id} className="war-room-list-item">
                <div><div className="war-room-item-title">{domain.name}</div><div className="war-room-item-meta">{domain.neglect_risk} neglect risk</div></div>
                <span className="war-room-pill">health {domain.health_score}</span>
              </div>
            ))}
            {(project.linked_domains || []).length === 0 && <div className="war-room-item-meta">No canonical domains linked.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Operational lanes</div>
          <div className="war-room-list">
            {(project.linked_gateways || []).map((gateway) => (
              <div key={gateway.id} className="war-room-list-item"><div className="war-room-item-title">{gateway.displayName || gateway.display_name || gateway.name || gateway.id}</div><span className="war-room-pill">gateway</span></div>
            ))}
            {(project.linked_tools || []).map((tool) => (
              <div key={tool.id} className="war-room-list-item"><div className="war-room-item-title">{tool.label || tool.name || tool.id}</div><span className="war-room-pill">tool</span></div>
            ))}
            {(project.linked_gateways || []).length + (project.linked_tools || []).length === 0 && <div className="war-room-item-meta">No execution lanes linked.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Outputs</div>
          <div className="war-room-list">
            {(project.outputs || []).map((item) => (
              <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div></div>
            ))}
            {(project.outputs || []).length === 0 && <div className="war-room-item-meta">No outputs recorded. Completion remains gated.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">References</div>
          <div className="war-room-list">
            {(project.references || []).map((reference) => (
              <div key={reference.id} className="war-room-list-item war-room-list-item-stack">
                <div className="war-room-item-title">{reference.title || reference.name || reference.id}</div>
                {reference.summary && <div className="war-room-item-meta">{reference.summary}</div>}
              </div>
            ))}
            {(project.references || []).length === 0 && <div className="war-room-item-meta">No source references linked.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Project memory</div>
          <div className="war-room-list">
            {(project.memory_capsules || []).map((capsule) => (
              <div key={capsule.id} className="war-room-list-item war-room-list-item-stack">
                <div className="war-room-item-title">{capsule.summary}</div>
                <div className="war-room-item-meta">{capsule.kind} · {capsule.importance} · {capsule.promotion_state}</div>
              </div>
            ))}
            {(project.memory_capsules || []).length === 0 && <div className="war-room-item-meta">No scoped memory capsules linked.</div>}
          </div>
        </div>
      </div>

      {genome && (
        <section className="war-room-panel project-genome-center">
          <div className="project-genome-head">
            <div>
              <div className="war-room-card-kicker">Project Genome / Runtime identity</div>
              <div className="war-room-panel-title">Version {genome.currentVersion} · {genome.contentHash.slice(0, 12)}</div>
              <div className="war-room-item-meta">Immutable history · evidence-backed mutations · execution provenance</div>
            </div>
            <div className="war-room-action-row">
              <span className="war-room-pill">{genome.summary.pendingProposals} pending</span>
              <span className="war-room-pill">{genome.summary.alignmentCount} alignments</span>
            </div>
          </div>
          {genomeMessage && <div className="project-genome-message">{genomeMessage}</div>}
          <div className="project-genome-grid">
            <div className="project-genome-contract">
              <div><span>Purpose</span><strong>{genome.genome.purpose || "Not established"}</strong></div>
              <div><span>Strategic thesis</span><strong>{genome.genome.strategicThesis || "Not established"}</strong></div>
              <div><span>Definition of done</span><strong>{genome.genome.definitionOfDone || "Not established"}</strong></div>
              <div><span>Latest alignment</span><strong>{genome.latestAlignment ? `${genome.latestAlignment.overallScore}% · ${genome.latestAlignment.executionId}` : "No explicit alignment evidence"}</strong></div>
            </div>
            <div className="project-genome-lists">
              {([['Principles', genome.genome.principles], ['Non-negotiables', genome.genome.nonNegotiables], ['Constraints', genome.genome.constraints], ['Risk boundaries', genome.genome.riskBoundaries], ['Execution heuristics', genome.genome.executionHeuristics]] as Array<[string, string[]]>).map(([label, items]) => (
                <div key={label}><span>{label}</span>{items.length ? items.map((item) => <strong key={item}>{item}</strong>) : <em>None established</em>}</div>
              ))}
            </div>
          </div>

          <div className="project-genome-editor">
            <div className="war-room-panel-title">Stage evidence-backed mutation</div>
            <input aria-label="Genome strategic thesis" className="war-room-input" placeholder="Strategic thesis" value={genomeDraft.strategicThesis} onChange={(event) => setGenomeDraft({ ...genomeDraft, strategicThesis: event.target.value })} />
            <input aria-label="Genome definition of done" className="war-room-input" placeholder="Definition of done" value={genomeDraft.definitionOfDone} onChange={(event) => setGenomeDraft({ ...genomeDraft, definitionOfDone: event.target.value })} />
            <textarea aria-label="Genome principles" className="war-room-input" placeholder="Principles · one per line" value={genomeDraft.principles} onChange={(event) => setGenomeDraft({ ...genomeDraft, principles: event.target.value })} />
            <textarea aria-label="Genome non-negotiables" className="war-room-input" placeholder="Non-negotiables · one per line" value={genomeDraft.nonNegotiables} onChange={(event) => setGenomeDraft({ ...genomeDraft, nonNegotiables: event.target.value })} />
            <textarea aria-label="Genome constraints" className="war-room-input" placeholder="Constraints · one per line" value={genomeDraft.constraints} onChange={(event) => setGenomeDraft({ ...genomeDraft, constraints: event.target.value })} />
            <textarea aria-label="Genome evidence rationale" className="war-room-input" placeholder="Evidence rationale · required" value={genomeDraft.rationale} onChange={(event) => setGenomeDraft({ ...genomeDraft, rationale: event.target.value })} />
            <button className="war-room-refresh-btn" disabled={Boolean(genomeBusy)} onClick={() => void stageGenomeMutation()}>Stage mutation · no apply</button>
          </div>

          <div className="project-genome-proposals">
            <div className="war-room-panel-title">Mutation governance</div>
            {genome.proposals.map((proposal) => (
              <article key={proposal.id} className={`project-genome-proposal status-${proposal.status}`}>
                <div><strong>{proposal.mode.replaceAll("_", " ")} · {proposal.status}</strong><span>base v{proposal.baseVersion} · {proposal.diff.changedFields.join(", ") || "no changes"}</span></div>
                <div className="project-genome-diff">{proposal.diff.changes.map((change) => <div key={change.field}><span>{change.field}</span><del>{JSON.stringify(change.before)}</del><ins>{JSON.stringify(change.after)}</ins></div>)}</div>
                {proposal.status === "pending_approval" && <div className="war-room-action-row">
                  <button className="war-room-refresh-btn" disabled={Boolean(genomeBusy)} onClick={() => void decideGenome(proposal.id, "approve")}>Approve as v{genome.currentVersion + 1}</button>
                  <button className="war-room-refresh-btn" disabled={Boolean(genomeBusy)} onClick={() => void decideGenome(proposal.id, "reject")}>Reject</button>
                </div>}
              </article>
            ))}
            {!genome.proposals.length && <div className="war-room-item-meta">No mutation proposals.</div>}
          </div>

          <div className="project-genome-history">
            <div className="war-room-panel-title">Immutable version history</div>
            {genome.versions.map((version) => <div key={version.version} className="war-room-list-item"><div><strong>v{version.version}</strong><div className="war-room-item-meta">{version.source} · {version.actor} · {version.contentHash.slice(0, 12)}</div></div>{version.version !== genome.currentVersion && <button className="war-room-refresh-btn" disabled={Boolean(genomeBusy)} onClick={() => void rollbackGenome(version.version)}>Stage rollback</button>}</div>)}
          </div>
        </section>
      )}
    </div>
  );
}

export default ProjectDetail;
