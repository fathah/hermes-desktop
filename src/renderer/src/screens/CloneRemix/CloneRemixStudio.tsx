import { useCallback, useEffect, useMemo, useState } from "react";

interface ClonedApp {
  id: string;
  app_name: string;
  source_url: string;
  source_name: string;
  source_version?: string | null;
  last_compared_at?: number | null;
  parity_pct: number;
  status: string;
  category?: string | null;
  hcc_route?: string | null;
  notes?: string;
  changelog?: Array<Record<string, unknown>>;
}

interface CloneForm {
  app_name: string;
  source_url: string;
  source_name: string;
  mode: "clone" | "remix";
  category: string;
  hcc_route: string;
  target_url: string;
  intent: string;
}

const EMPTY_FORM: CloneForm = {
  app_name: "",
  source_url: "",
  source_name: "",
  mode: "remix",
  category: "productivity",
  hcc_route: "",
  target_url: "",
  intent: "",
};

function CloneRemixStudio(): React.JSX.Element {
  const [items, setItems] = useState<ClonedApp[]>([]);
  const [form, setForm] = useState<CloneForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccClonedApps()) as { items?: ClonedApp[] };
      setItems(payload.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clone registry");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const averageParity = useMemo(() => {
    if (!items.length) return 0;
    return Math.round(items.reduce((sum, item) => sum + Number(item.parity_pct || 0), 0) / items.length);
  }, [items]);

  const create = async (): Promise<void> => {
    if (!form.app_name.trim() || !form.source_url.trim() || !form.source_name.trim()) {
      setError("Name, source URL, and source name are required.");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      await window.hermesAPI.createHccClonedApp({
        ...form,
        status: "planning",
        parity_pct: 0,
        notes: `${form.mode} registered from native HCC OS`,
      });
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register clone");
    } finally {
      setBusy(null);
    }
  };

  const compare = async (appId: string): Promise<void> => {
    setBusy(appId);
    setError(null);
    try {
      await window.hermesAPI.compareHccClonedApp(appId, {
        target_url: form.target_url.trim() || undefined,
        intent: form.intent.trim() || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setBusy(null);
    }
  };

  const materialize = async (appId: string): Promise<void> => {
    setBusy(`materialize:${appId}`);
    setError(null);
    try {
      await window.hermesAPI.materializeHccClonedApp(appId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Style transfer materialization failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="hcc-project-detail-screen">
      <div className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Build Intelligence</div>
          <h1 className="war-room-title">Clone & Remix Studio</h1>
          <p className="war-room-subtitle">Capture references, choose exact clone or intentional remix, track parity, and preserve upstream changes.</p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void load()}>Refresh</button>
      </div>

      <div className="war-room-hero-grid">
        <div className="war-room-stat-card"><div className="war-room-stat-label">Registered</div><div className="war-room-stat-value">{items.length}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Average parity</div><div className="war-room-stat-value">{averageParity}%</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Active audits</div><div className="war-room-stat-value">{items.filter(item => item.status !== "archived").length}</div></div>
      </div>

      {error && <div className="war-room-error-card"><div className="war-room-error-copy">{error}</div></div>}

      <div className="war-room-grid">
        <section className="war-room-panel">
          <div className="war-room-panel-title">Register reference</div>
          <div className="war-room-list">
            <input className="war-room-input" placeholder="App name" value={form.app_name} onChange={event => setForm({...form, app_name: event.target.value})} />
            <input className="war-room-input" placeholder="Source URL" value={form.source_url} onChange={event => setForm({...form, source_url: event.target.value})} />
            <input className="war-room-input" placeholder="Source name" value={form.source_name} onChange={event => setForm({...form, source_name: event.target.value})} />
            <select className="war-room-input" value={form.mode} onChange={event => setForm({...form, mode: event.target.value as CloneForm["mode"]})}>
              <option value="clone">Exact clone</option><option value="remix">Intentional remix</option>
            </select>
            <input className="war-room-input" placeholder="Category" value={form.category} onChange={event => setForm({...form, category: event.target.value})} />
            <input className="war-room-input" placeholder="HCC route" value={form.hcc_route} onChange={event => setForm({...form, hcc_route: event.target.value})} />
            <input className="war-room-input" placeholder="Optional target URL for measured parity" value={form.target_url} onChange={event => setForm({...form, target_url: event.target.value})} />
            <input className="war-room-input" placeholder="Remix intent / taste direction" value={form.intent} onChange={event => setForm({...form, intent: event.target.value})} />
            <button className="war-room-refresh-btn" disabled={busy === "create"} onClick={() => void create()}>{busy === "create" ? "Registering…" : "Register clone/remix"}</button>
          </div>
        </section>

        <section className="war-room-panel">
          <div className="war-room-panel-title">Reference registry</div>
          {loading ? <div className="war-room-loading">Loading references…</div> : (
            <div className="war-room-list">
              {items.map(item => (
                <div key={item.id} className="war-room-list-item">
                  <div className="war-room-item-title">{item.app_name}</div>
                  <div className="war-room-item-meta">{item.source_name} · {item.category || "uncategorized"} · {item.parity_pct}% parity</div>
                  <div className="war-room-item-meta">{item.source_url}</div>
                  <button className="war-room-refresh-btn" disabled={busy === item.id} onClick={() => void compare(item.id)}>{busy === item.id ? "Recording…" : "Compare now"}</button>
                  <button className="war-room-refresh-btn" disabled={busy === `materialize:${item.id}`} onClick={() => void materialize(item.id)}>{busy === `materialize:${item.id}` ? "Generating…" : "Materialize scaffold"}</button>
                </div>
              ))}
              {!items.length && <div className="war-room-item-meta">No references registered.</div>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default CloneRemixStudio;
