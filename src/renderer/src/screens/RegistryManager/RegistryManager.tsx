import { useCallback, useEffect, useMemo, useState } from "react";

type RegistryResource = "domains" | "tools" | "references";
type RegistryEntity = Record<string, unknown> & { id: string };

const RESOURCE_META: Record<RegistryResource, { label: string; prefix: string }> = {
  domains: { label: "Domains", prefix: "domain." },
  tools: { label: "Tools", prefix: "tool." },
  references: { label: "References", prefix: "ref." },
};

function RegistryManager(): React.JSX.Element {
  const [resource, setResource] = useState<RegistryResource>("domains");
  const [items, setItems] = useState<RegistryEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccRegistryResource(resource)) as { items: RegistryEntity[] };
      setItems(payload.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load registry");
    } finally {
      setLoading(false);
    }
  }, [resource]);

  useEffect(() => {
    setSelectedId(null);
    setDraft({});
    setIsCreating(false);
    setDeleteArmed(false);
    void load();
  }, [load]);

  const selectEntity = (entity: RegistryEntity): void => {
    setSelectedId(entity.id);
    setDraft(entity);
    setIsCreating(false);
    setDeleteArmed(false);
  };

  const beginCreate = (): void => {
    const meta = RESOURCE_META[resource];
    setSelectedId(null);
    setIsCreating(true);
    setDeleteArmed(false);
    setDraft({ id: meta.prefix, name: "", title: "", status: "active", type: "" });
  };

  const setField = (field: string, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async (): Promise<void> => {
    const id = String(draft.id || "").trim();
    if (!id || !id.startsWith(RESOURCE_META[resource].prefix)) {
      setError(`ID must start with ${RESOURCE_META[resource].prefix}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isCreating) await window.hermesAPI.createHccRegistryEntity(resource, draft);
      else await window.hermesAPI.updateHccRegistryEntity(resource, id, draft);
      await load();
      setSelectedId(id);
      setIsCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entity");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!selectedId) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await window.hermesAPI.deleteHccRegistryEntity(resource, selectedId);
      setSelectedId(null);
      setDraft({});
      setDeleteArmed(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entity");
    } finally {
      setSaving(false);
    }
  };

  const displayName = (item: RegistryEntity): string => String(item.name || item.title || item.id);

  return (
    <div className="hcc-registry-screen">
      <section className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Canonical Store</div>
          <h1 className="war-room-title">Registry Management</h1>
          <p className="war-room-subtitle">Edit persistent domains, tools, and references without touching backend files.</p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void load()}>Refresh</button>
      </section>

      <div className="hcc-registry-tabs">
        {(Object.keys(RESOURCE_META) as RegistryResource[]).map((key) => (
          <button key={key} className={`hcc-memory-tab ${resource === key ? "active" : ""}`} onClick={() => setResource(key)}>
            {RESOURCE_META[key].label}
          </button>
        ))}
      </div>

      {error && <div className="war-room-error-card"><div className="war-room-error-copy">{error}</div></div>}

      <section className="hcc-registry-layout">
        <div className="war-room-panel hcc-registry-list-panel">
          <div className="hcc-registry-panel-header">
            <div className="war-room-panel-title">{RESOURCE_META[resource].label}</div>
            <button className="war-room-refresh-btn" onClick={beginCreate}>New</button>
          </div>
          {loading ? <div className="war-room-loading">Loading registry…</div> : (
            <div className="war-room-list">
              {items.map((item) => (
                <button key={item.id} className={`war-room-list-item war-room-list-button ${selectedId === item.id ? "active" : ""}`} onClick={() => selectEntity(item)}>
                  <div>
                    <div className="war-room-item-title">{displayName(item)}</div>
                    <div className="war-room-item-meta">{item.id}</div>
                  </div>
                  <div className="war-room-pill tone-healthy">{String(item.status || item.type || "stored")}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="war-room-panel hcc-registry-editor">
          {!selected && !isCreating ? <div className="war-room-item-meta">Select an entity or create a new one.</div> : (
            <>
              <div className="war-room-panel-title">{isCreating ? `New ${resource.slice(0, -1)}` : displayName(draft as RegistryEntity)}</div>
              <label className="hcc-registry-field"><span>ID</span><input value={String(draft.id || "")} disabled={!isCreating} onChange={(event) => setField("id", event.target.value)} /></label>
              {resource === "references" ? (
                <label className="hcc-registry-field"><span>Title</span><input value={String(draft.title || "")} onChange={(event) => setField("title", event.target.value)} /></label>
              ) : (
                <label className="hcc-registry-field"><span>Name</span><input value={String(draft.name || "")} onChange={(event) => setField("name", event.target.value)} /></label>
              )}
              <label className="hcc-registry-field"><span>Type</span><input value={String(draft.type || "")} onChange={(event) => setField("type", event.target.value)} /></label>
              <label className="hcc-registry-field"><span>Status</span><input value={String(draft.status || "")} onChange={(event) => setField("status", event.target.value)} /></label>
              <label className="hcc-registry-field"><span>Description</span><textarea value={String(draft.description || "")} onChange={(event) => setField("description", event.target.value)} /></label>
              <label className="hcc-registry-field"><span>Notes</span><textarea value={String(draft.notes || "")} onChange={(event) => setField("notes", event.target.value)} /></label>
              <div className="hcc-registry-actions">
                <button className="war-room-refresh-btn" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
                {!isCreating && selectedId && (
                  <button className={`hcc-registry-delete ${deleteArmed ? "armed" : ""}`} disabled={saving} onClick={() => void remove()}>
                    {deleteArmed ? "Confirm delete" : "Delete"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default RegistryManager;
