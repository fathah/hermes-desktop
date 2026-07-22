import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  File,
  FileCheck2,
  Package,
  ScrollText,
  ShieldCheck,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  HccContextInspector,
  HccInspectorTabName,
} from "../../types/hcc";

interface ContextInspectorRailProps {
  entityType: string;
  entityId: string;
  initialTab?: HccInspectorTabName;
  onClose: () => void;
}

const TABS: Array<{ id: HccInspectorTabName; label: string; icon: LucideIcon }> = [
  { id: "evidence", label: "Evidence", icon: FileCheck2 },
  { id: "artifacts", label: "Artifacts", icon: Package },
  { id: "files", label: "Files", icon: File },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "skills", label: "Skills", icon: Wrench },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
];

function firstText(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function itemTitle(item: Record<string, unknown>, tab: HccInspectorTabName): string {
  const keys: Record<HccInspectorTabName, string[]> = {
    evidence: ["kind", "title", "status"],
    artifacts: ["title", "id", "path", "type"],
    files: ["title", "path", "name", "id"],
    memory: ["text", "title", "category", "id"],
    skills: ["name", "title", "id"],
    logs: ["title", "type", "eventType", "id"],
    approvals: ["title", "actionType", "proposalId", "status"],
  };
  return firstText(item, keys[tab]) ?? "Recorded item";
}

function itemDescription(item: Record<string, unknown>): string | null {
  return firstText(item, ["description", "goal", "summary", "rationale", "status"]);
}

function itemMeta(item: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const key of ["type", "category", "status", "at", "createdAt"]) {
    const value = item[key];
    if (typeof value === "string" || typeof value === "number") result.push(`${key}: ${value}`);
  }
  return result.slice(0, 3);
}

function ContextInspectorRail({
  entityType,
  entityId,
  initialTab = "evidence",
  onClose,
}: ContextInspectorRailProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<HccInspectorTabName>(initialTab);
  const [inspector, setInspector] = useState<HccContextInspector | null>(null);
  const [readerScope, setReaderScope] = useState("owner");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInspector(null);
    setError(null);
    void window.hermesAPI.getHccContextInspector(entityType, entityId, readerScope)
      .then((payload) => {
        if (!cancelled) setInspector(payload as HccContextInspector);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Inspector unavailable");
      });
    return () => { cancelled = true; };
  }, [entityId, entityType, readerScope]);

  const active = inspector?.tabs[activeTab] ?? null;
  const sourceLabel = useMemo(
    () => inspector?.provenance.sourceRefs.map((ref) => `${ref.type}:${ref.id}`).join(" · ") ?? "",
    [inspector],
  );

  return (
    <aside className="context-inspector" aria-label="Contextual Inspector">
      <header className="context-inspector-header">
        <div>
          <span>Context Inspector</span>
          <strong>{inspector?.context.title ?? entityId}</strong>
          <code>{inspector?.schemaVersion ?? "loading"}</code>
        </div>
        <button aria-label="Close Context Inspector" onClick={onClose}><X size={17} /></button>
      </header>

      <div className="context-inspector-reader"><span>Reader policy</span><select aria-label="Inspector reader scope" value={readerScope} onChange={(event)=>setReaderScope(event.target.value)}><option value="owner">Owner</option><option value="operator">Operator</option><option value="tool">Tool</option><option value="delegation">Delegation</option><option value="export">Export</option></select>{inspector?.provenance.omissions?.length ? <em>{inspector.provenance.omissions.length} omitted by policy</em> : <em>No policy omissions</em>}</div>

      <nav className="context-inspector-tabs" aria-label="Inspector sections">
        {TABS.map(({ id, label, icon: Icon }) => {
          const tab = inspector?.tabs[id];
          return (
            <button key={id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)} title={label}>
              <Icon size={15} />
              <span>{label}</span>
              {tab && <em>{tab.count}</em>}
            </button>
          );
        })}
      </nav>

      <section className="context-inspector-body">
        {error && <div className="context-inspector-error">{error}</div>}
        {!error && !inspector && <div className="context-inspector-empty">Loading grounded context…</div>}
        {active && active.items.map((item, index) => (
          <article key={`${activeTab}-${index}`} className="context-inspector-item">
            <strong>{itemTitle(item, activeTab)}</strong>
            {itemDescription(item) && <p>{itemDescription(item)}</p>}
            <div>{itemMeta(item).map((meta) => <code key={meta}>{meta}</code>)}</div>
          </article>
        ))}
        {active && !active.items.length && (
          <div className="context-inspector-empty">
            <strong>Not recorded</strong>
            <span>No source is recorded for this context. Nothing was inferred.</span>
          </div>
        )}
      </section>

      {inspector && (
        <footer className="context-inspector-footer">
          <span>{inspector.provenance.policy}</span>
          <code>{sourceLabel}</code>
        </footer>
      )}
    </aside>
  );
}

export default ContextInspectorRail;
