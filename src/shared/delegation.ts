/**
 * Subagent delegation tree (idea B3) — pure reducer.
 *
 * Builds a parent→children tree from `hermes.delegate.progress` events. Tolerant
 * of out-of-order events (a child seen before its parent is attached when the
 * parent arrives), enforces the upstream limits (MAX_DEPTH=2, ≤3 concurrent
 * children) defensively, and tracks running/done/error status.
 *
 * Pure + testable; the live event source + view live elsewhere.
 */

export const MAX_DEPTH = 2;
export const MAX_CONCURRENT_CHILDREN = 3;

export type DelegateStatus = "running" | "done" | "error";

export interface DelegateEvent {
  id: string;
  parentId?: string;
  goal?: string;
  status: string; // raw from gateway; normalized below
  depth?: number;
  tool?: string;
  label?: string;
}

export interface DelegateNode {
  id: string;
  parentId?: string;
  goal?: string;
  status: DelegateStatus;
  depth: number;
  tool?: string;
  label?: string;
  children: DelegateNode[];
}

export interface DelegationState {
  /** Flat map for O(1) updates. */
  nodes: Record<string, DelegateNode>;
  /** Root node ids (no/unknown parent), insertion-ordered. */
  roots: string[];
}

export function initDelegationState(): DelegationState {
  return { nodes: {}, roots: [] };
}

function normalizeStatus(s: string): DelegateStatus {
  const v = (s || "").toLowerCase();
  if (v === "done" || v === "completed" || v === "complete") return "done";
  if (v === "error" || v === "failed" || v === "failure") return "error";
  return "running";
}

/**
 * Apply one delegation event. Creates or updates the node and (re)links it to
 * its parent. Returns a new state (no mutation of the input).
 */
export function applyDelegateEvent(
  state: DelegationState,
  event: DelegateEvent,
): DelegationState {
  const nodes: Record<string, DelegateNode> = { ...state.nodes };
  const roots = [...state.roots];

  const existing = nodes[event.id];
  const node: DelegateNode = {
    id: event.id,
    parentId: event.parentId ?? existing?.parentId,
    goal: event.goal ?? existing?.goal,
    status: normalizeStatus(event.status),
    depth: event.depth ?? existing?.depth ?? 0,
    tool: event.tool ?? existing?.tool,
    label: event.label ?? existing?.label,
    children: existing?.children ?? [],
  };
  nodes[event.id] = node;

  const parentId = node.parentId;
  if (parentId && nodes[parentId]) {
    // Attach to parent if not already a child and capacity allows.
    const parent = nodes[parentId];
    const already = parent.children.some((c) => c.id === node.id);
    if (!already && parent.children.length < MAX_CONCURRENT_CHILDREN) {
      nodes[parentId] = { ...parent, children: [...parent.children, node] };
    } else if (already) {
      nodes[parentId] = {
        ...parent,
        children: parent.children.map((c) => (c.id === node.id ? node : c)),
      };
    }
  } else if (!roots.includes(node.id)) {
    roots.push(node.id);
  }

  return { nodes, roots };
}

/**
 * Materialize the nested tree from the flat map. Roots are computed dynamically
 * — a node is a root iff it has no parentId or its parent isn't known yet — so
 * out-of-order events (child before parent) resolve correctly once the parent
 * arrives. Insertion order is preserved via the `roots` list, with any other
 * orphan roots appended.
 */
export function buildTree(state: DelegationState): DelegateNode[] {
  const isRoot = (id: string): boolean => {
    const n = state.nodes[id];
    return !!n && (!n.parentId || !state.nodes[n.parentId]);
  };

  const build = (id: string, depth: number): DelegateNode | null => {
    const n = state.nodes[id];
    if (!n || depth > MAX_DEPTH) return null;
    const childIds = Object.values(state.nodes)
      .filter((c) => c.parentId === id)
      .map((c) => c.id);
    const children = childIds
      .slice(0, MAX_CONCURRENT_CHILDREN)
      .map((cid) => build(cid, depth + 1))
      .filter((c): c is DelegateNode => c !== null);
    return { ...n, children };
  };

  const ordered = [
    ...state.roots.filter(isRoot),
    ...Object.keys(state.nodes).filter(
      (id) => isRoot(id) && !state.roots.includes(id),
    ),
  ];
  return ordered
    .map((id) => build(id, 0))
    .filter((n): n is DelegateNode => n !== null);
}

/** Count nodes by status — handy for a summary badge. */
export function countByStatus(
  state: DelegationState,
): Record<DelegateStatus, number> {
  const counts: Record<DelegateStatus, number> = {
    running: 0,
    done: 0,
    error: 0,
  };
  for (const n of Object.values(state.nodes)) counts[n.status] += 1;
  return counts;
}
