import { useCallback, useEffect, useMemo, useState } from "react";

interface GraphNode { id: string; type: string; label: string; status: string }
interface GraphEdge { id: string; source_id: string; target_id: string; relationship: string; weight: number; metadata: { derived?: boolean; manual?: boolean; source?: string } }
interface RiskNode { id: string; type: string; label: string; baseRisk: number; propagatedRisk: number }
interface GraphPolicyPair { sourceType: string; targetType: string }
interface GraphPolicyPayload { relationships: string[]; policy: Record<string, GraphPolicyPair[]> }
interface RelationshipSemantics { label: string; direction: string; description: string }
interface GraphFilterState { nodeType: string; relationship: string; edgeKind: string; query: string }
interface GraphPreset extends GraphFilterState { id: string; label: string; description: string }
interface CanvasPoint { x: number; y: number }
interface CanvasViewport { x: number; y: number; zoom: number }
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 560;
const FILTER_STORAGE_KEY = "hcc.graph-center.filters.v1";
const GRAPH_PRESETS: GraphPreset[] = [
  { id: "all", label: "All graph", description: "Full graph without filters", nodeType: "all", relationship: "all", edgeKind: "all", query: "" },
  { id: "manual", label: "Manual edges", description: "Operator-authored relationships", nodeType: "all", relationship: "all", edgeKind: "manual", query: "" },
  { id: "gateway-routes", label: "Gateway routes", description: "Traffic routed through gateways", nodeType: "gateway", relationship: "routes-through", edgeKind: "all", query: "" },
  { id: "memory-work", label: "Memory-informed", description: "Work informed by memory capsules", nodeType: "memory", relationship: "informed-by", edgeKind: "all", query: "" },
  { id: "risk-hotspots", label: "Risk hotspots", description: "Projects with propagated risk", nodeType: "project", relationship: "all", edgeKind: "all", query: "" },
];

function readStoredFilters(): GraphFilterState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) || "null") as Partial<GraphFilterState> | null;
    return {
      nodeType: parsed?.nodeType || "all",
      relationship: parsed?.relationship || "all",
      edgeKind: parsed?.edgeKind || "all",
      query: parsed?.query || "",
    };
  } catch {
    return { nodeType: "all", relationship: "all", edgeKind: "all", query: "" };
  }
}

const RELATIONSHIP_SEMANTICS: Record<string, RelationshipSemantics> = {
  "belongs-to": { label: "Belongs to", direction: "source belongs to target", description: "Use when a project is part of a domain." },
  "depends-on": { label: "Depends on", direction: "source depends on target", description: "Use when work or systems are blocked without the target." },
  "uses": { label: "Uses", direction: "source uses target", description: "Use for active tool or gateway consumption." },
  references: { label: "References", direction: "source references target", description: "Use for documents, specs, or source material." },
  "informed-by": { label: "Informed by", direction: "source informed by target", description: "Use when memory or prior findings shape current work." },
  "routes-through": { label: "Routes through", direction: "source routes through target", description: "Use for gateway or path mediation." },
  supports: { label: "Supports", direction: "source supports target", description: "Use when a memory, tool, or gateway materially helps a project/domain." },
  blocks: { label: "Blocks", direction: "source blocks target", description: "Use when the source prevents target progress." },
};

interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  riskNodes: RiskNode[];
  sync: {
    latest: { trigger: string; added: number; updated: number; removed: number; derivedCount: number; syncedAt: number } | null;
    events: Array<{ id: number; trigger: string; added: number; updated: number; removed: number; derivedCount: number; syncedAt: number }>;
  };
  integrity: {
    health: "healthy" | "warning" | "critical";
    summary: { issueCount: number; orphanEdgeCount: number; invalidRelationshipCount: number; invalidNodeTypeCount: number; invalidRelationshipPairCount: number; semanticDuplicateCount: number };
    orphanEdges: Array<{ edgeId: string; missingNodeIds: string[]; derived: boolean }>;
    invalidRelationships: Array<{ edgeId: string; relationship: string }>;
    invalidNodeTypes: Array<{ edgeId: string; sourceType?: string; targetType?: string }>;
    invalidRelationshipPairs: Array<{ edgeId: string; relationship: string; sourceType?: string; targetType?: string }>;
    semanticDuplicates: Array<{ sourceId: string; targetId: string; relationship: string; canonicalEdgeId: string; duplicateEdgeIds: string[] }>;
  };
  policy: GraphPolicyPayload;
  summary: { nodeCount: number; edgeCount: number; nodeTypes: Record<string, number>; elevatedRiskCount: number };
}

function policyAllows(policy: GraphPolicyPayload, sourceType: string, relationship: string, targetType: string): boolean {
  return (policy.policy[relationship] || []).some((pair) => pair.sourceType === sourceType && pair.targetType === targetType);
}

function buildCanvasLayout(nodes: GraphNode[]): Record<string, CanvasPoint> {
  const byType = nodes.reduce<Record<string, GraphNode[]>>((groups, node) => {
    (groups[node.type] ||= []).push(node);
    return groups;
  }, {});
  const types = Object.keys(byType).sort();
  const center = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
  const positions: Record<string, CanvasPoint> = {};
  types.forEach((type, typeIndex) => {
    const group = [...byType[type]].sort((a, b) => a.label.localeCompare(b.label));
    const typeAngle = (typeIndex / Math.max(types.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const clusterCenter = {
      x: center.x + Math.cos(typeAngle) * 200,
      y: center.y + Math.sin(typeAngle) * 150,
    };
    group.forEach((node, nodeIndex) => {
      const nodeAngle = (nodeIndex / Math.max(group.length, 1)) * Math.PI * 2 + typeAngle;
      const radius = group.length === 1 ? 0 : Math.min(86, 36 + group.length * 5);
      positions[node.id] = {
        x: clusterCenter.x + Math.cos(nodeAngle) * radius,
        y: clusterCenter.y + Math.sin(nodeAngle) * radius,
      };
    });
  });
  return positions;
}

function explainInvalidPair(policy: GraphPolicyPayload, sourceType?: string, relationship?: string, targetType?: string): string {
  if (!sourceType || !targetType) return "Pick source and target node types to see valid relationships.";
  if (!relationship) return `Allowed relationships for ${sourceType} → ${targetType} will appear here.`;
  const allowed = Object.entries(policy.policy)
    .filter(([, pairs]) => pairs.some((pair) => pair.sourceType === sourceType && pair.targetType === targetType))
    .map(([name]) => name);
  if (allowed.includes(relationship)) return "Relationship matches policy.";
  if (!allowed.length) return `No graph policy allows ${sourceType} → ${targetType}. Choose a different node pair.`;
  return `${relationship} is invalid for ${sourceType} → ${targetType}. Allowed: ${allowed.join(", ")}.`;
}

function GraphCenter(): React.JSX.Element {
  const storedFilters = useMemo(() => readStoredFilters(), []);
  const [data, setData] = useState<GraphPayload | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [relationship, setRelationship] = useState("depends-on");
  const [nodeTypeFilter, setNodeTypeFilter] = useState(storedFilters.nodeType);
  const [relationshipFilter, setRelationshipFilter] = useState(storedFilters.relationship);
  const [edgeKindFilter, setEdgeKindFilter] = useState(storedFilters.edgeKind);
  const [searchQuery, setSearchQuery] = useState(storedFilters.query);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [edgeWeight, setEdgeWeight] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const [dragOrigin, setDragOrigin] = useState<CanvasPoint | null>(null);
  const [focusSelectedNode, setFocusSelectedNode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await window.hermesAPI.getHccGraph()) as GraphPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ nodeType: nodeTypeFilter, relationship: relationshipFilter, edgeKind: edgeKindFilter, query: searchQuery }));
    } catch {
      // Persistence is optional; filters still work in-memory.
    }
  }, [edgeKindFilter, nodeTypeFilter, relationshipFilter, searchQuery]);

  const applyPreset = (preset: GraphPreset): void => {
    setNodeTypeFilter(preset.nodeType);
    setRelationshipFilter(preset.relationship);
    setEdgeKindFilter(preset.edgeKind);
    setSearchQuery(preset.query);
    setSelectedEdgeId(null);
  };

  const syncGraph = async (): Promise<void> => {
    setSyncing(true);
    setError(null);
    try {
      await window.hermesAPI.syncHccGraph();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to synchronize graph");
    } finally {
      setSyncing(false);
    }
  };

  const repairIntegrity = async (): Promise<void> => {
    setRepairing(true);
    setError(null);
    try {
      await window.hermesAPI.repairHccGraphIntegrity();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to repair graph integrity");
    } finally {
      setRepairing(false);
    }
  };

  const connectedEdges = useMemo(() => {
    if (!data || !selectedNode) return [];
    return data.edges.filter((edge) => edge.source_id === selectedNode || edge.target_id === selectedNode);
  }, [data, selectedNode]);
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const nodesById = useMemo(() => Object.fromEntries((data?.nodes || []).map((node) => [node.id, node])), [data]);
  const allowedRelationships = useMemo(() => {
    const sourceType = sourceId ? nodesById[sourceId]?.type : null;
    const targetType = targetId ? nodesById[targetId]?.type : null;
    if (!data || !sourceType || !targetType) return data?.policy.relationships || [];
    return data.policy.relationships.filter((item) => policyAllows(data.policy, sourceType, item, targetType));
  }, [data, nodesById, sourceId, targetId]);
  const selectedSourceNode = sourceId ? nodesById[sourceId] : null;
  const selectedTargetNode = targetId ? nodesById[targetId] : null;
  const filteredNodes = (data?.nodes || []).filter((node) => {
    const matchesType = nodeTypeFilter === "all" || node.type === nodeTypeFilter;
    const matchesQuery = !normalizedQuery || `${node.id} ${node.label} ${node.type}`.toLowerCase().includes(normalizedQuery);
    return matchesType && matchesQuery;
  });
  const filteredEdges = (data?.edges || []).filter((edge) => {
    const source = nodesById[edge.source_id];
    const target = nodesById[edge.target_id];
    const matchesRelationship = relationshipFilter === "all" || edge.relationship === relationshipFilter;
    const matchesKind = edgeKindFilter === "all" || (edgeKindFilter === "derived" ? !!edge.metadata.derived : !edge.metadata.derived);
    const matchesNodeType = nodeTypeFilter === "all" || source?.type === nodeTypeFilter || target?.type === nodeTypeFilter;
    const matchesQuery = !normalizedQuery || `${edge.id} ${edge.relationship} ${edge.source_id} ${edge.target_id} ${source?.label || ""} ${target?.label || ""}`.toLowerCase().includes(normalizedQuery);
    return matchesRelationship && matchesKind && matchesNodeType && matchesQuery;
  });
  const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
  const visibleEdgeIds = new Set(filteredEdges.map((edge) => edge.id));
  const visibleConnectedEdges = connectedEdges.filter((edge) => visibleEdgeIds.has(edge.id));
  const filteredRiskNodes = (data?.riskNodes || []).filter((node) => visibleNodeIds.has(node.id) || !normalizedQuery && nodeTypeFilter === "all");
  const relationshipMetrics = Object.entries(filteredEdges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.relationship] = (counts[edge.relationship] || 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]);
  const nodeTypeMetrics = Object.entries(filteredNodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.type] = (counts[node.type] || 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]);
  const manualEdgeCount = filteredEdges.filter((edge) => !edge.metadata.derived).length;
  const derivedEdgeCount = filteredEdges.length - manualEdgeCount;
  const canvasNodes = (() => {
    const edgeNodeIds = new Set(filteredEdges.flatMap((edge) => [edge.source_id, edge.target_id]));
    return (data?.nodes || []).filter((node) => visibleNodeIds.has(node.id) || edgeNodeIds.has(node.id));
  })();
  const canvasNodeIds = new Set(canvasNodes.map((node) => node.id));
  const unscopedCanvasEdges = filteredEdges.filter((edge) => canvasNodeIds.has(edge.source_id) && canvasNodeIds.has(edge.target_id));
  const focusedNodeIds = selectedNode && focusSelectedNode
    ? new Set([selectedNode, ...unscopedCanvasEdges.filter((edge) => edge.source_id === selectedNode || edge.target_id === selectedNode).flatMap((edge) => [edge.source_id, edge.target_id])])
    : canvasNodeIds;
  const displayedCanvasNodes = canvasNodes.filter((node) => focusedNodeIds.has(node.id));
  const canvasEdges = unscopedCanvasEdges.filter((edge) => focusedNodeIds.has(edge.source_id) && focusedNodeIds.has(edge.target_id));
  const canvasPositions = buildCanvasLayout(displayedCanvasNodes);
  const selectedEdge = selectedEdgeId ? filteredEdges.find((edge) => edge.id === selectedEdgeId) || null : null;
  const relationshipSemantics = RELATIONSHIP_SEMANTICS[relationship] || { label: relationship, direction: "source → target", description: "Custom graph relationship." };
  const selectedEdgeSemantics = selectedEdge ? (RELATIONSHIP_SEMANTICS[selectedEdge.relationship] || { label: selectedEdge.relationship, direction: "source → target", description: "Custom graph relationship." }) : null;
  const pairGuidance = data ? explainInvalidPair(data.policy, selectedSourceNode?.type, relationship, selectedTargetNode?.type) : "";
  const preferredRelationship = selectedSourceNode ? ((data?.policy.relationships || []).find((item) => (data?.policy.policy[item] || []).some((pair) => pair.sourceType === selectedSourceNode.type)) || null) : null;

  const createEdge = async (): Promise<void> => {
    if (!sourceId || !targetId || sourceId === targetId) {
      setError("Select two different graph nodes.");
      return;
    }
    if (!allowedRelationships.includes(relationship)) {
      setError("Relationship not allowed for selected node types.");
      return;
    }
    setError(null);
    try {
      const payload = { source_id: sourceId, target_id: targetId, relationship, weight: edgeWeight, metadata: { manual: true, source: "graph-center" } };
      if (editingEdgeId) {
        await window.hermesAPI.updateHccGraphEdge(editingEdgeId, payload);
      } else {
        await window.hermesAPI.createHccGraphEdge(payload);
      }
      setEditingEdgeId(null);
      setEdgeWeight(1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : editingEdgeId ? "Failed to update edge" : "Failed to create edge");
    }
  };

  const removeEdge = async (edge: GraphEdge): Promise<void> => {
    if (edge.metadata.derived) return;
    try {
      await window.hermesAPI.deleteHccGraphEdge(edge.id);
      if (editingEdgeId === edge.id) {
        setEditingEdgeId(null);
      }
      if (selectedEdgeId === edge.id) {
        setSelectedEdgeId(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete edge");
    }
  };

  const beginEditEdge = (edge: GraphEdge): void => {
    setSelectedEdgeId(edge.id);
    setEditingEdgeId(edge.id);
    setSourceId(edge.source_id);
    setTargetId(edge.target_id);
    setRelationship(edge.relationship);
    setEdgeWeight(edge.weight);
    setError(null);
  };

  const zoomCanvas = (delta: number): void => {
    setViewport((current) => ({ ...current, zoom: Math.min(2.4, Math.max(0.55, current.zoom + delta)) }));
  };

  const resetCanvas = (): void => setViewport({ x: 0, y: 0, zoom: 1 });

  const focusCanvasNode = (nodeId: string): void => {
    setSelectedNode(nodeId);
    setSelectedEdgeId(null);
    const position = canvasPositions[nodeId];
    if (position) {
      setViewport({ x: CANVAS_WIDTH / 2 - position.x * 1.35, y: CANVAS_HEIGHT / 2 - position.y * 1.35, zoom: 1.35 });
    }
  };

  const resetComposer = (): void => {
    setSelectedEdgeId(null);
    setEditingEdgeId(null);
    setSourceId("");
    setTargetId("");
    setRelationship(preferredRelationship || data?.policy.relationships[0] || "depends-on");
    setEdgeWeight(1);
    setError(null);
  };

  useEffect(() => {
    if (!sourceId && preferredRelationship && !editingEdgeId) {
      setRelationship(preferredRelationship);
    }
  }, [editingEdgeId, preferredRelationship, sourceId]);

  useEffect(() => {
    if (!allowedRelationships.length) return;
    if (!allowedRelationships.includes(relationship)) {
      setRelationship(allowedRelationships[0]);
    }
  }, [allowedRelationships, relationship]);

  if (loading) return <div className="hcc-graph-screen"><div className="war-room-loading">Building relationship graph…</div></div>;
  if (!data) return <div className="hcc-graph-screen"><div className="war-room-error-card">{error || "Graph unavailable"}</div></div>;

  return (
    <div className="hcc-graph-screen">
      <section className="war-room-hero-card">
        <div><div className="war-room-card-kicker">HCC OS / Relationship Layer</div><h1 className="war-room-title">Knowledge Graph</h1><p className="war-room-subtitle">Queryable dependencies across projects, domains, tools, references, memory, and gateways.</p></div>
        <div className="hcc-registry-actions">
          <button className="war-room-refresh-btn" disabled={syncing} onClick={() => void syncGraph()}>{syncing ? "Syncing…" : "Reconcile"}</button>
          <button className="war-room-refresh-btn" disabled={repairing || data.integrity.summary.issueCount === 0} onClick={() => void repairIntegrity()}>{repairing ? "Repairing…" : "Repair issues"}</button>
          <button className="war-room-refresh-btn" onClick={() => void load()}>Refresh</button>
        </div>
      </section>

      <section className="war-room-hero-grid">
        <div className="war-room-stat-card"><div className="war-room-stat-label">Nodes</div><div className="war-room-stat-value">{data.summary.nodeCount}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Edges</div><div className="war-room-stat-value">{data.summary.edgeCount}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Node types</div><div className="war-room-stat-value">{Object.keys(data.summary.nodeTypes).length}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Elevated risk</div><div className="war-room-stat-value">{data.summary.elevatedRiskCount}</div></div>
        <div className="war-room-stat-card"><div className="war-room-stat-label">Integrity</div><div className={`war-room-stat-value integrity-${data.integrity.health}`}>{data.integrity.summary.issueCount}</div></div>
      </section>

      {data.sync.latest && (
        <section className="war-room-panel hcc-graph-sync-panel">
          <div>
            <div className="war-room-panel-title">Synchronization health</div>
            <div className="war-room-item-meta">
              Last trigger: {data.sync.latest.trigger} · {new Date(data.sync.latest.syncedAt * 1000).toLocaleString()} · {data.sync.latest.derivedCount} derived edges
            </div>
          </div>
          <div className="hcc-registry-actions">
            <span className="war-room-pill tone-healthy">+{data.sync.latest.added}</span>
            <span className="war-room-pill tone-watch">~{data.sync.latest.updated}</span>
            <span className="war-room-pill tone-risk">−{data.sync.latest.removed}</span>
          </div>
        </section>
      )}

      <section className="war-room-panel hcc-graph-integrity-panel">
        <div>
          <div className="war-room-panel-title">Integrity diagnostics</div>
          <div className="war-room-item-meta">
            {data.integrity.health} · {data.integrity.summary.issueCount} issue(s) · orphan {data.integrity.summary.orphanEdgeCount} · invalid rel {data.integrity.summary.invalidRelationshipCount} · invalid pairs {data.integrity.summary.invalidRelationshipPairCount} · duplicates {data.integrity.summary.semanticDuplicateCount}
          </div>
        </div>
        {data.integrity.summary.issueCount > 0 && (
          <div className="war-room-list compact-list">
            {data.integrity.orphanEdges.slice(0, 2).map((item) => <div key={item.edgeId} className="war-room-item-meta">orphan: {item.edgeId} → {item.missingNodeIds.join(", ")}</div>)}
            {data.integrity.invalidRelationships.slice(0, 2).map((item) => <div key={item.edgeId} className="war-room-item-meta">invalid relationship: {item.edgeId} / {item.relationship}</div>)}
            {data.integrity.invalidRelationshipPairs.slice(0, 2).map((item) => <div key={item.edgeId} className="war-room-item-meta">invalid pair: {item.relationship} / {item.sourceType} → {item.targetType}</div>)}
            {data.integrity.semanticDuplicates.slice(0, 2).map((item) => <div key={item.canonicalEdgeId} className="war-room-item-meta">duplicate: {item.relationship} {item.sourceId} ↔ {item.targetId}</div>)}
          </div>
        )}
      </section>

      <section className="war-room-panel hcc-graph-presets">
        <div><div className="war-room-panel-title">Operator views</div><div className="war-room-item-meta">Saved presets. Current filter state persists across restarts.</div></div>
        <div className="hcc-graph-preset-list">
          {GRAPH_PRESETS.map((preset) => {
            const active = nodeTypeFilter === preset.nodeType && relationshipFilter === preset.relationship && edgeKindFilter === preset.edgeKind && searchQuery === preset.query;
            return <button key={preset.id} className={`hcc-graph-preset ${active ? "active" : ""}`} title={preset.description} onClick={() => applyPreset(preset)}>{preset.label}</button>;
          })}
        </div>
      </section>

      <section className="war-room-panel hcc-graph-filter-bar">
        <input className="hcc-graph-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search nodes, edges, ids, labels" />
        <select value={nodeTypeFilter} onChange={(event) => setNodeTypeFilter(event.target.value)}>
          <option value="all">All node types</option>
          {Object.keys(data.summary.nodeTypes).sort().map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={relationshipFilter} onChange={(event) => setRelationshipFilter(event.target.value)}>
          <option value="all">All relationships</option>
          {data.policy.relationships.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={edgeKindFilter} onChange={(event) => setEdgeKindFilter(event.target.value)}>
          <option value="all">Manual + derived</option>
          <option value="manual">Manual only</option>
          <option value="derived">Derived only</option>
        </select>
        {(searchQuery || nodeTypeFilter !== "all" || relationshipFilter !== "all" || edgeKindFilter !== "all") && <button className="war-room-refresh-btn" onClick={() => { setSearchQuery(""); setNodeTypeFilter("all"); setRelationshipFilter("all"); setEdgeKindFilter("all"); }}>Clear filters</button>}
      </section>

      <section className="hcc-graph-metrics-grid">
        <div className="war-room-panel hcc-graph-metric-panel"><div className="war-room-panel-title">Visible topology</div><div className="hcc-graph-metric-value">{filteredNodes.length} / {filteredEdges.length}</div><div className="war-room-item-meta">nodes / edges</div></div>
        <div className="war-room-panel hcc-graph-metric-panel"><div className="war-room-panel-title">Edge authorship</div><div className="hcc-graph-edge-chips"><span className="war-room-pill tone-healthy">manual {manualEdgeCount}</span><span className="war-room-pill tone-watch">derived {derivedEdgeCount}</span></div></div>
        <div className="war-room-panel hcc-graph-metric-panel"><div className="war-room-panel-title">Relationships</div><div className="hcc-graph-metric-list">{relationshipMetrics.slice(0, 5).map(([name, count]) => <span key={name}>{name} <strong>{count}</strong></span>)}{relationshipMetrics.length === 0 && <span>none</span>}</div></div>
        <div className="war-room-panel hcc-graph-metric-panel"><div className="war-room-panel-title">Node types</div><div className="hcc-graph-metric-list">{nodeTypeMetrics.map(([name, count]) => <span key={name}>{name} <strong>{count}</strong></span>)}{nodeTypeMetrics.length === 0 && <span>none</span>}</div></div>
      </section>

      <section className="war-room-panel hcc-graph-canvas-panel">
        <div className="hcc-registry-panel-header">
          <div><div className="war-room-panel-title">Topology canvas</div><div className="war-room-item-meta">{displayedCanvasNodes.length} nodes · {canvasEdges.length} edges · drag background to pan</div></div>
          <div className="hcc-registry-actions">
            <button className="war-room-refresh-btn" aria-label="Zoom out" onClick={() => zoomCanvas(-0.15)}>−</button>
            <span className="war-room-pill tone-watch">{Math.round(viewport.zoom * 100)}%</span>
            <button className="war-room-refresh-btn" aria-label="Zoom in" onClick={() => zoomCanvas(0.15)}>+</button>
            <button className={`war-room-refresh-btn ${focusSelectedNode ? "active" : ""}`} disabled={!selectedNode} onClick={() => { setFocusSelectedNode((current) => !current); resetCanvas(); }}>{focusSelectedNode ? "Show all" : "Focus neighbors"}</button>
            <button className="war-room-refresh-btn" onClick={() => resetCanvas()}>Fit view</button>
          </div>
        </div>
        <div
          className={`hcc-graph-canvas ${dragOrigin ? "dragging" : ""}`}
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget && (event.target as Element).closest("[data-graph-interactive]")) return;
            setDragOrigin({ x: event.clientX - viewport.x, y: event.clientY - viewport.y });
          }}
          onMouseMove={(event) => {
            if (!dragOrigin) return;
            setViewport((current) => ({ ...current, x: event.clientX - dragOrigin.x, y: event.clientY - dragOrigin.y }));
          }}
          onMouseUp={() => setDragOrigin(null)}
          onMouseLeave={() => setDragOrigin(null)}
          tabIndex={0}
          aria-label="Interactive graph canvas. Arrow keys pan, plus and minus zoom, zero fits view."
          onKeyDown={(event) => {
            const panStep = 28;
            if (event.key === "ArrowLeft") setViewport((current) => ({ ...current, x: current.x + panStep }));
            else if (event.key === "ArrowRight") setViewport((current) => ({ ...current, x: current.x - panStep }));
            else if (event.key === "ArrowUp") setViewport((current) => ({ ...current, y: current.y + panStep }));
            else if (event.key === "ArrowDown") setViewport((current) => ({ ...current, y: current.y - panStep }));
            else if (event.key === "+" || event.key === "=") zoomCanvas(0.15);
            else if (event.key === "-") zoomCanvas(-0.15);
            else if (event.key === "0") resetCanvas();
            else return;
            event.preventDefault();
          }}
          onWheel={(event) => { event.preventDefault(); zoomCanvas(event.deltaY > 0 ? -0.1 : 0.1); }}
        >
          <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} role="img" aria-label="Filtered knowledge graph topology">
            <defs>
              <marker id="hcc-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker>
            </defs>
            <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
              {canvasEdges.map((edge) => {
                const source = canvasPositions[edge.source_id];
                const target = canvasPositions[edge.target_id];
                if (!source || !target) return null;
                const active = selectedEdgeId === edge.id || selectedNode === edge.source_id || selectedNode === edge.target_id;
                const midX = (source.x + target.x) / 2;
                const midY = (source.y + target.y) / 2;
                return <g key={edge.id} data-graph-interactive className={`hcc-canvas-edge ${active ? "active" : ""}`} onClick={() => { setSelectedEdgeId(edge.id); setSelectedNode(edge.source_id); }}>
                  <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} markerEnd="url(#hcc-graph-arrow)" />
                  {active && <text x={midX} y={midY - 7}>{edge.relationship}</text>}
                </g>;
              })}
              {displayedCanvasNodes.map((node) => {
                const position = canvasPositions[node.id];
                const active = selectedNode === node.id;
                return <g key={node.id} data-graph-interactive tabIndex={0} role="button" aria-label={`${node.label}, ${node.type}`} className={`hcc-canvas-node type-${node.type} ${active ? "active" : ""}`} transform={`translate(${position.x} ${position.y})`} onClick={() => focusCanvasNode(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusCanvasNode(node.id); } }}>
                  <circle r={active ? 20 : 16} />
                  <text className="hcc-canvas-node-label" y={30}>{node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label}</text>
                  <text className="hcc-canvas-node-type" y={42}>{node.type}</text>
                </g>;
              })}
            </g>
          </svg>
          {canvasNodes.length === 0 && <div className="hcc-graph-canvas-empty">No topology matches current filters.</div>}
        </div>
      </section>

      <section className="hcc-graph-layout">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Nodes</div>
          <div className="war-room-item-meta">{filteredNodes.length} visible / {data.nodes.length} total</div>
          <div className="hcc-graph-node-grid">
            {filteredNodes.map((node) => (
              <button key={node.id} className={`hcc-graph-node type-${node.type} ${selectedNode === node.id ? "active" : ""}`} onClick={() => setSelectedNode(node.id)}>
                <span>{node.label}</span><small>{node.type}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="war-room-panel hcc-graph-inspector">
          <div className="war-room-panel-title">Relationship inspector</div>
          {!selectedNode ? <div className="war-room-item-meta">Select a node to inspect connected edges.</div> : (
            <div className="war-room-list">
              <div className="war-room-item-title">{selectedNode}</div>
              <div className="war-room-item-meta">{visibleConnectedEdges.length} matching edge(s)</div>
              {visibleConnectedEdges.map((edge) => (
                <div key={edge.id} className={`war-room-list-item hcc-graph-edge-row ${selectedEdgeId === edge.id ? "active" : ""}`} onClick={() => setSelectedEdgeId(edge.id)}>
                  <div><div className="war-room-item-title">{edge.relationship}</div><div className="war-room-item-meta">{edge.source_id} → {edge.target_id}</div><div className="hcc-graph-edge-chips"><span className={`war-room-pill ${edge.metadata.derived ? "tone-watch" : "tone-healthy"}`}>{edge.metadata.derived ? "derived" : "manual"}</span>{edge.metadata.source && <span className="war-room-pill tone-watch">{edge.metadata.source}</span>}</div></div>
                  {!edge.metadata.derived && <div className="hcc-registry-actions"><button className="war-room-refresh-btn" onClick={(event) => { event.stopPropagation(); beginEditEdge(edge); }}>Edit</button><button className="hcc-registry-delete" onClick={(event) => { event.stopPropagation(); void removeEdge(edge); }}>Delete</button></div>}
                </div>
              ))}
              {visibleConnectedEdges.length === 0 && <div className="war-room-item-meta">No connected edges match current filters.</div>}
              {selectedEdge && (
                <div className="hcc-graph-edge-detail">
                  <div className="war-room-item-title">Edge detail</div>
                  <div className="war-room-item-meta">{selectedEdgeSemantics?.label} · {selectedEdgeSemantics?.direction}</div>
                  <div className="war-room-item-meta">{selectedEdgeSemantics?.description}</div>
                  <div className="hcc-graph-edge-chips">
                    <span className="war-room-pill tone-watch">weight {selectedEdge.weight.toFixed(1)}</span>
                    <span className={`war-room-pill ${selectedEdge.metadata.derived ? "tone-watch" : "tone-healthy"}`}>{selectedEdge.metadata.derived ? "derived" : "manual"}</span>
                    {selectedEdge.metadata.source && <span className="war-room-pill tone-watch">source {selectedEdge.metadata.source}</span>}
                  </div>
                  <div className="war-room-item-meta">from {nodesById[selectedEdge.source_id]?.label || selectedEdge.source_id} → {nodesById[selectedEdge.target_id]?.label || selectedEdge.target_id}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="war-room-grid">
        <div className="war-room-panel hcc-graph-edge-form">
          <div className="hcc-registry-panel-header">
            <div>
              <div className="war-room-panel-title">{editingEdgeId ? "Edit relationship" : "Create relationship"}</div>
              <div className="war-room-item-meta">{editingEdgeId ? `Editing ${editingEdgeId}` : `Suggested default: ${preferredRelationship || "pick nodes first"}`}</div>
            </div>
            {(editingEdgeId || sourceId || targetId) && <button className="war-room-refresh-btn" onClick={() => resetComposer()}>Reset</button>}
          </div>
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Source node</option>{data.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.type}</option>)}</select>
          <div className="hcc-graph-type-badges">
            <span className="war-room-pill tone-watch">source: {selectedSourceNode?.type || "none"}</span>
            <span className="war-room-pill tone-watch">target: {selectedTargetNode?.type || "none"}</span>
            <span className="war-room-pill tone-healthy">direction: {relationshipSemantics.direction}</span>
          </div>
          <select value={relationship} onChange={(event) => setRelationship(event.target.value)}>{allowedRelationships.map((item) => <option key={item}>{item}</option>)}</select>
          <div className="hcc-graph-guidance-panel">
            <div className="war-room-item-title">{relationshipSemantics.label}</div>
            <div className="war-room-item-meta">{relationshipSemantics.description}</div>
            <div className={`war-room-item-meta ${allowedRelationships.includes(relationship) ? "integrity-healthy" : "integrity-warning"}`}>{pairGuidance}</div>
          </div>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Target node</option>{data.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.type}</option>)}</select>
          <label className="hcc-graph-weight-field">Weight <input type="range" min="0" max="1" step="0.1" value={edgeWeight} onChange={(event) => setEdgeWeight(Number(event.target.value))} /><span>{edgeWeight.toFixed(1)}</span></label>
          <div className="war-room-item-meta">Allowed for pair: {allowedRelationships.length ? allowedRelationships.join(", ") : "none"}</div>
          <button className="war-room-refresh-btn" disabled={!allowedRelationships.length} onClick={() => void createEdge()}>{editingEdgeId ? "Save edge" : "Connect"}</button>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Risk propagation</div>
          <div className="war-room-item-meta">{filteredRiskNodes.length} visible risk nodes</div>
          <div className="war-room-list">
            {filteredRiskNodes.slice(0, 8).map((node) => <div key={node.id} className="war-room-list-item"><div><div className="war-room-item-title">{node.label}</div><div className="war-room-item-meta">{node.type} · base {node.baseRisk}</div></div><div className={`war-room-pill ${node.propagatedRisk >= 50 ? "tone-risk" : "tone-healthy"}`}>{node.propagatedRisk}</div></div>)}
          </div>
        </div>
      </section>
    </div>
  );
}

export default GraphCenter;
