// GraphView.tsx — F4: the local [[wikilink]] graph over the SPS page vault.
//
// Nodes are the workspace's pages (from the page tree); edges are the wikilink
// references the note-index derives from the markdown on disk (useVaultGraph).
// Clicking a node opens that page. Dependency-light: a radial SVG layout (no
// graph library), coloured only with the existing design tokens.
import { useMemo } from "react";
import { useStore } from "../store";
import { useVaultGraph } from "../hooks/useNoteIndex";
import { treeWalkIds } from "../lib/tree";
import { Icon } from "../components/Icon";

const SIZE = 640;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 70;

export function GraphView() {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const page = useStore((s) => s.page);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const { edges } = useVaultGraph();

  const nodeIds = useMemo(
    () => Array.from(new Set(tree.flatMap((n) => treeWalkIds(n)))),
    [tree],
  );

  const { nodes, lines } = useMemo(() => {
    const present = new Set(nodeIds);
    const liveEdges = edges.filter(
      (e) => present.has(e.source) && present.has(e.target),
    );
    const degree = new Map<string, number>();
    for (const e of liveEdges) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1);
      degree.set(e.target, (degree.get(e.target) || 0) + 1);
    }
    const pos = new Map<string, { x: number; y: number }>();
    const total = nodeIds.length || 1;
    const placed = nodeIds.map((id, i) => {
      const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
      const x = CENTER + RADIUS * Math.cos(angle);
      const y = CENTER + RADIUS * Math.sin(angle);
      pos.set(id, { x, y });
      const r = 6 + Math.min(degree.get(id) || 0, 6) * 1.5;
      return { id, x, y, r };
    });
    const drawn = liveEdges.flatMap((e) => {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      return a && b ? [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }] : [];
    });
    return { nodes: placed, lines: drawn };
  }, [nodeIds, edges]);

  const open = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };

  if (nodeIds.length === 0) {
    return (
      <div
        className="graph-empty"
        style={{ padding: 40, color: "var(--tx-3)", textAlign: "center" }}
      >
        <Icon name="pageGraph" size={28} />
        <div style={{ marginTop: 8 }}>No pages to graph yet.</div>
      </div>
    );
  }

  return (
    <div className="graph-view" style={{ padding: "8px 24px 32px" }}>
      <div
        className="graph-head"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--tx-2)",
          fontWeight: 600,
          margin: "8px 0 4px",
        }}
      >
        <Icon name="pageGraph" size={16} />
        <span>Graph</span>
        <span style={{ color: "var(--tx-3)", fontWeight: 400, fontSize: 12 }}>
          {nodes.length} page{nodes.length === 1 ? "" : "s"} · {lines.length}{" "}
          link{lines.length === 1 ? "" : "s"}
        </span>
      </div>
      <svg
        className="graph-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Page link graph"
        style={{
          width: "100%",
          maxWidth: 720,
          display: "block",
          margin: "0 auto",
        }}
      >
        <g stroke="var(--hair-strong)" strokeWidth={1}>
          {lines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
          ))}
        </g>
        {nodes.map((node) => {
          const active = node.id === page;
          const title = meta[node.id]?.title || node.id;
          return (
            <g
              key={node.id}
              className="graph-node"
              role="button"
              aria-label={title}
              transform={`translate(${node.x},${node.y})`}
              style={{ cursor: "pointer" }}
              onClick={() => open(node.id)}
            >
              <circle
                r={node.r}
                fill={active ? "var(--accent)" : "var(--accent-soft)"}
                stroke={active ? "var(--accent)" : "var(--hair-strong)"}
                strokeWidth={active ? 2 : 1}
              />
              <text
                x={0}
                y={node.r + 13}
                textAnchor="middle"
                fill="var(--tx-2)"
                fontSize={12}
              >
                {title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
