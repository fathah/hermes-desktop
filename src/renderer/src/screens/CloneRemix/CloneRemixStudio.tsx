import { useCallback, useEffect, useMemo, useState } from "react";

interface Fingerprint {
  title?: string;
  contentHash?: string;
  structure?: Record<string, number>;
  visualTokens?: { colors?: string[]; fonts?: string[] };
  tasteSignals?: Record<string, string>;
}

interface TasteItem {
  signal: string;
  sentiment: "liked" | "disliked";
  dimension: string;
}

interface CloneIntelligence {
  mode?: "clone" | "remix";
  intent?: string;
  sourceAnalysis?: Fingerprint;
  blueprint?: { preserve?: string[]; adapt?: string[]; avoid?: string[] };
  latestComparison?: { parity?: number; scores?: Record<string, number> };
  tasteProfile?: { liked?: TasteItem[]; disliked?: TasteItem[]; total?: number };
  projectId?: string;
  referenceId?: string;
  derivedTaskIds?: string[];
  materializedArtifact?: { directory?: string; files?: string[] };
  projectGenome?: { heuristics?: string[]; skillGrowth?: Record<string, unknown> };
  caseStudy?: { title?: string; outcome?: string };
}

interface ClonedApp {
  id: string;
  app_name: string;
  source_url: string;
  source_name: string;
  parity_pct: number;
  status: string;
  category?: string | null;
  intelligence?: CloneIntelligence;
}

interface CloneForm {
  app_name: string;
  source_url: string;
  source_name: string;
  mode: "clone" | "remix";
  category: string;
  target_url: string;
  intent: string;
}

const EMPTY_FORM: CloneForm = { app_name: "", source_url: "", source_name: "", mode: "remix", category: "productivity", target_url: "", intent: "" };

function CloneRemixStudio(): React.JSX.Element {
  const [items, setItems] = useState<ClonedApp[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<CloneForm>(EMPTY_FORM);
  const [likedSignal, setLikedSignal] = useState("");
  const [dislikedSignal, setDislikedSignal] = useState("");
  const [tasteDimension, setTasteDimension] = useState("layout");
  const [projectName, setProjectName] = useState("");
  const [projectPurpose, setProjectPurpose] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccClonedApps()) as { items?: ClonedApp[] };
      const next = payload.items || [];
      setItems(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clone registry");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);
  const intelligence = selected?.intelligence || {};
  const averageParity = items.length ? Math.round(items.reduce((sum, item) => sum + Number(item.parity_pct || 0), 0) / items.length) : 0;
  const completedStages = selected ? [
    Boolean(intelligence.sourceAnalysis),
    Boolean(intelligence.tasteProfile?.total),
    Boolean(intelligence.projectId),
    Boolean(intelligence.materializedArtifact),
    Boolean(intelligence.latestComparison),
    Boolean(intelligence.caseStudy),
  ].filter(Boolean).length : 0;

  const run = async (key: string, action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone/Remix action failed");
    } finally {
      setBusy(null);
    }
  };

  const create = async (): Promise<void> => {
    if (!form.app_name.trim() || !form.source_url.trim() || !form.source_name.trim()) {
      setError("Name, source URL, and source name are required.");
      return;
    }
    await run("create", () => window.hermesAPI.createHccClonedApp({ ...form, status: "planning", parity_pct: 0, notes: `${form.mode} registered from native HCC OS` }), "Reference registered. Analyze evidence next.");
    setForm(EMPTY_FORM);
  };

  const analyze = async (): Promise<void> => {
    if (!selected) return;
    await run(`analyze:${selected.id}`, () => window.hermesAPI.compareHccClonedApp(selected.id, { intent: form.intent.trim() || intelligence.intent || undefined }), "Reference fingerprint and remix blueprint captured.");
  };

  const saveTaste = async (): Promise<void> => {
    if (!selected) return;
    const signals = [
      ...(likedSignal.trim() ? [{ dimension: tasteDimension, sentiment: "liked", signal: likedSignal.trim(), rationale: "Selected in native Taste Studio", evidence: intelligence.sourceAnalysis || {} }] : []),
      ...(dislikedSignal.trim() ? [{ dimension: tasteDimension, sentiment: "disliked", signal: dislikedSignal.trim(), rationale: "Rejected in native Taste Studio", evidence: intelligence.sourceAnalysis || {} }] : []),
    ];
    if (!signals.length) {
      setError("Add at least one liked or disliked signal.");
      return;
    }
    await run(`taste:${selected.id}`, () => window.hermesAPI.recordHccCloneTaste(selected.id, signals), "Taste decisions saved with evidence.");
    setLikedSignal("");
    setDislikedSignal("");
  };

  const linkProject = async (): Promise<void> => {
    if (!selected) return;
    await run(`project:${selected.id}`, () => window.hermesAPI.linkHccCloneProject(selected.id, { projectName: projectName.trim() || selected.app_name, purpose: projectPurpose.trim() || form.intent.trim() || intelligence.intent || "Evidence-driven original remix" }), "Project shell, reference graph, and derived tasks created.");
  };

  const materialize = async (): Promise<void> => {
    if (!selected) return;
    await run(`materialize:${selected.id}`, () => window.hermesAPI.materializeHccClonedApp(selected.id), "Original scaffold materialized without source code copying.");
  };

  const compare = async (): Promise<void> => {
    if (!selected || (!form.target_url.trim() && !intelligence.materializedArtifact?.directory)) {
      setError("Materialize artifact or provide public target URL for measured comparison.");
      return;
    }
    await run(`compare:${selected.id}`, () => window.hermesAPI.compareHccClonedApp(selected.id, { target_url: form.target_url.trim(), intent: form.intent.trim() || intelligence.intent }), "Measured comparison saved.");
  };

  const finalize = async (): Promise<void> => {
    if (!selected) return;
    await run(`finalize:${selected.id}`, () => window.hermesAPI.finalizeHccCloneLearning(selected.id), "Lessons saved into taste, memory, project genome, and case study.");
  };

  return (
    <div className="hcc-project-detail-screen clone-studio-screen">
      <section className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Creative Intelligence</div>
          <h1 className="war-room-title">Clone & Remix Studio</h1>
          <p className="war-room-subtitle">Capture evidence. Make taste explicit. Build an original variation. Compound lessons into project genome.</p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void load()}>Refresh</button>
      </section>

      <section className="war-room-hero-grid">
        <div className="war-room-stat-card"><div className="war-room-stat-label">References</div><div className="war-room-stat-value">{items.length}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Average parity</div><div className="war-room-stat-value">{averageParity}%</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Workflow stage</div><div className="war-room-stat-value">{completedStages}/6</div></div>
      </section>

      {error && <div className="war-room-error-card"><div className="war-room-error-copy">{error}</div></div>}
      {message && <div className="war-room-panel clone-success-panel">{message}</div>}

      <section className="war-room-grid clone-studio-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">1. Reference intake</div>
          <div className="war-room-list">
            <input aria-label="Clone app name" className="war-room-input" placeholder="App name" value={form.app_name} onChange={(event) => setForm({ ...form, app_name: event.target.value })} />
            <input aria-label="Clone source URL" className="war-room-input" placeholder="Public source URL" value={form.source_url} onChange={(event) => setForm({ ...form, source_url: event.target.value })} />
            <input aria-label="Clone source name" className="war-room-input" placeholder="Source name" value={form.source_name} onChange={(event) => setForm({ ...form, source_name: event.target.value })} />
            <select aria-label="Clone mode" className="war-room-input" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as CloneForm["mode"] })}><option value="clone">Exact workflow clone</option><option value="remix">Intentional remix</option></select>
            <input className="war-room-input" placeholder="Remix intent" value={form.intent} onChange={(event) => setForm({ ...form, intent: event.target.value })} />
            <button className="war-room-refresh-btn" disabled={busy === "create"} onClick={() => void create()}>{busy === "create" ? "Registering…" : "Register reference"}</button>
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Reference registry</div>
          {loading ? <div className="war-room-loading">Loading references…</div> : <div className="war-room-list">
            {items.map((item) => <button key={item.id} className={`war-room-list-item war-room-list-button ${selectedId === item.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}><div><div className="war-room-item-title">{item.app_name}</div><div className="war-room-item-meta">{item.source_name} · {item.status} · {item.parity_pct}% parity</div></div><div className="war-room-pill">{item.intelligence?.mode || "remix"}</div></button>)}
            {!items.length && <div className="war-room-item-meta">No references registered.</div>}
          </div>}
        </div>
      </section>

      {selected && <>
        <section className="war-room-panel clone-workflow-panel">
          <div className="war-room-panel-title">Evidence workflow · {selected.app_name}</div>
          <div className="clone-stage-row">
            <button onClick={() => void analyze()} disabled={busy !== null}>2. Analyze reference</button>
            <button onClick={() => void saveTaste()} disabled={busy !== null}>3. Save taste</button>
            <button onClick={() => void linkProject()} disabled={busy !== null}>4. Create project + tasks</button>
            <button onClick={() => void materialize()} disabled={busy !== null}>5. Materialize variation</button>
            <button onClick={() => void compare()} disabled={busy !== null}>6. Compare</button>
            <button onClick={() => void finalize()} disabled={busy !== null}>7. Compound lessons</button>
          </div>
        </section>

        <section className="war-room-grid clone-studio-grid">
          <div className="war-room-panel">
            <div className="war-room-panel-title">Reference evidence</div>
            {intelligence.sourceAnalysis ? <div className="clone-evidence-grid">
              <div><span>Hash</span><strong>{intelligence.sourceAnalysis.contentHash?.slice(0, 12)}</strong></div>
              {Object.entries(intelligence.sourceAnalysis.structure || {}).map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}</strong></div>)}
            </div> : <div className="war-room-item-meta">Analyze source to capture structure, visual tokens, and interaction model.</div>}
            <div className="clone-token-row">{(intelligence.sourceAnalysis?.visualTokens?.colors || []).map((color) => <span key={color} style={{ background: color }} title={color} />)}</div>
          </div>

          <div className="war-room-panel">
            <div className="war-room-panel-title">Taste decisions</div>
            <select className="war-room-input" value={tasteDimension} onChange={(event) => setTasteDimension(event.target.value)}><option value="layout">Layout</option><option value="visual">Visual</option><option value="interaction">Interaction</option><option value="copy">Copy</option><option value="brand">Brand</option></select>
            <input aria-label="Liked taste signal" className="war-room-input" placeholder="What should be preserved?" value={likedSignal} onChange={(event) => setLikedSignal(event.target.value)} />
            <input aria-label="Disliked taste signal" className="war-room-input" placeholder="What must be rejected?" value={dislikedSignal} onChange={(event) => setDislikedSignal(event.target.value)} />
            <div className="clone-taste-columns"><div><strong>Liked</strong>{(intelligence.tasteProfile?.liked || []).map((item) => <span key={item.signal}>{item.signal}</span>)}</div><div><strong>Disliked</strong>{(intelligence.tasteProfile?.disliked || []).map((item) => <span key={item.signal}>{item.signal}</span>)}</div></div>
          </div>

          <div className="war-room-panel">
            <div className="war-room-panel-title">Project and output</div>
            <input className="war-room-input" placeholder="Project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            <textarea className="war-room-input" placeholder="Project purpose" value={projectPurpose} onChange={(event) => setProjectPurpose(event.target.value)} />
            <div className="war-room-item-meta">Project: {intelligence.projectId || "not linked"}</div>
            <div className="war-room-item-meta">Reference: {intelligence.referenceId || "not registered"}</div>
            <div className="war-room-item-meta">Derived tasks: {intelligence.derivedTaskIds?.length || 0}</div>
            <div className="war-room-item-meta">Artifact: {intelligence.materializedArtifact?.directory || "not materialized"}</div>
          </div>

          <div className="war-room-panel">
            <div className="war-room-panel-title">Comparison and learning</div>
            <input aria-label="Comparison target URL" className="war-room-input" placeholder="Public target URL" value={form.target_url} onChange={(event) => setForm({ ...form, target_url: event.target.value })} />
            <div className="clone-score-grid">{Object.entries(intelligence.latestComparison?.scores || {}).map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}%</strong></div>)}</div>
            <div className="war-room-item-title">{intelligence.caseStudy?.title || "Case study pending"}</div>
            <div className="war-room-item-meta">{intelligence.caseStudy?.outcome || "Compound after analysis, taste, project linkage, and materialization."}</div>
            <div className="war-room-list">{(intelligence.projectGenome?.heuristics || []).slice(0, 8).map((item) => <div className="war-room-item-meta" key={item}>• {item}</div>)}</div>
          </div>
        </section>
      </>}
    </div>
  );
}

export default CloneRemixStudio;
