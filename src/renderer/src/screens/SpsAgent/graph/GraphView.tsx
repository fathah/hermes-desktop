// GraphView.tsx — F4: the local [[wikilink]] graph over the SPS page vault.
//
// Nodes are the workspace's pages (from the page tree); edges are the wikilink
// references the note-index derives from the markdown on disk (useVaultGraph).
// Renders an interactive force-directed graph on HTML5 Canvas. Supports drag-and-drop
// node positioning, zoom and pan, and automatically resolves active theme CSS tokens.
import { useEffect, useRef, useMemo } from "react";
import { useStore } from "../store";
import { useVaultGraph } from "../hooks/useNoteIndex";
import { treeWalkIds } from "../lib/tree";
import { Icon } from "../components/Icon";
import { ForceSimulation, type SimNode } from "./ForceSimulation";

export function GraphView() {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const activePageId = useStore((s) => s.page);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const { edges, refetch } = useVaultGraph();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<ForceSimulation | null>(null);

  // Viewport transforms (refs prevent excessive React re-renders during 60FPS animation)
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const mouseRef = useRef({ x: 0, y: 0, rawX: 0, rawY: 0, down: false });
  const dragNodeRef = useRef<SimNode | null>(null);
  const hoverNodeRef = useRef<SimNode | null>(null);

  const nodeIds = useMemo(
    () => Array.from(new Set(tree.flatMap((n) => treeWalkIds(n)))),
    [tree]
  );

  // Re-sync simulation graph when nodes/edges change
  const { simNodes, simEdges } = useMemo(() => {
    const present = new Set(nodeIds);
    const liveEdges = edges.filter(
      (e) => present.has(e.source) && present.has(e.target)
    );

    // Calculate node degree (number of connected edges)
    const degree = new Map<string, number>();
    for (const e of liveEdges) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1);
      degree.set(e.target, (degree.get(e.target) || 0) + 1);
    }

    const builtNodes: SimNode[] = nodeIds.map((id) => {
      const deg = degree.get(id) || 0;
      return {
        id,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        r: 6 + Math.min(deg, 8) * 1.5, // dynamic radius based on connection degree
        label: meta[id]?.title || id,
        active: id === activePageId,
      };
    });

    return { simNodes: builtNodes, simEdges: liveEdges };
  }, [nodeIds, edges, meta, activePageId]);

  // Handle graph click/open note
  const openNote = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };

  // Run the force layout and canvas draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Instantiation or sync of simulation
    if (!simRef.current) {
      simRef.current = new ForceSimulation(simNodes, simEdges, canvas.width, canvas.height);
    } else {
      simRef.current.setGraph(simNodes, simEdges);
    }

    let animationFrameId: number;

    const render = () => {
      const sim = simRef.current;
      if (!sim) return;

      // Update physics simulation
      sim.tick();

      // Read theme colors dynamically from CSS variables on the canvas element
      const styles = getComputedStyle(canvas);
      const txNormal = styles.getPropertyValue("--tx-1") || "#333333";
      const txMuted = styles.getPropertyValue("--tx-3") || "#888888";
      const accent = styles.getPropertyValue("--accent") || "#0066cc";
      const accentSoft = styles.getPropertyValue("--accent-soft") || "rgba(0, 102, 204, 0.15)";
      const border = styles.getPropertyValue("--hair-strong") || "#e5e5e5";

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Apply pan & zoom transforms
      ctx.translate(panRef.current.x, panRef.current.y);
      ctx.scale(zoomRef.current, zoomRef.current);

      // 1. Draw link lines
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.2;
      for (const edge of sim.edges) {
        const u = sim.nodes.find((n) => n.id === edge.source);
        const v = sim.nodes.find((n) => n.id === edge.target);
        if (!u || !v) continue;
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(v.x, v.y);
        ctx.stroke();
      }

      // 2. Draw nodes & labels
      for (const node of sim.nodes) {
        const isActive = node.active;
        const isHovered = hoverNodeRef.current?.id === node.id;

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + (isHovered ? 2 : 0), 0, Math.PI * 2);
        
        ctx.fillStyle = isActive ? accent : accentSoft;
        ctx.fill();

        ctx.strokeStyle = isActive ? accent : border;
        ctx.lineWidth = isActive ? 2.5 : 1.2;
        ctx.stroke();

        // Pulsing halo for active note
        if (isActive) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = accentSoft;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Text labels
        ctx.fillStyle = isActive || isHovered ? txNormal : txMuted;
        ctx.font = `${isHovered ? "bold " : ""}11px var(--font-sans, system-ui)`;
        ctx.textAlign = "center";
        ctx.fillText(node.label, node.x, node.y + node.r + 14);
      }

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [simNodes, simEdges]);

  // Convert screen coordinates to canvas world coordinates
  const screenToWorld = (screenX: number, screenY: number) => {
    return {
      x: (screenX - panRef.current.x) / zoomRef.current,
      y: (screenY - panRef.current.y) / zoomRef.current,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !simRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const rawY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    mouseRef.current = { x: rawX, y: rawY, rawX: e.clientX, rawY: e.clientY, down: true };

    const world = screenToWorld(rawX, rawY);

    // Check if clicked on any node
    let hitNode: SimNode | null = null;
    for (const node of simRef.current.nodes) {
      const dx = world.x - node.x;
      const dy = world.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= node.r + 6) {
        hitNode = node;
        break;
      }
    }

    if (hitNode) {
      dragNodeRef.current = hitNode;
      hitNode.fx = hitNode.x;
      hitNode.fy = hitNode.y;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !simRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const rawY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const mouse = mouseRef.current;
    const world = screenToWorld(rawX, rawY);

    // Update hover node detection
    let hitNode: SimNode | null = null;
    for (const node of simRef.current.nodes) {
      const dx = world.x - node.x;
      const dy = world.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= node.r + 6) {
        hitNode = node;
        break;
      }
    }
    hoverNodeRef.current = hitNode;

    if (mouse.down) {
      if (dragNodeRef.current) {
        // Dragging a node: update fixed target positions
        dragNodeRef.current.fx = world.x;
        dragNodeRef.current.fy = world.y;
      } else {
        // Panning: adjust pan translations
        panRef.current.x += rawX - mouse.x;
        panRef.current.y += rawY - mouse.y;
      }
    }

    mouseRef.current = { x: rawX, y: rawY, rawX: e.clientX, rawY: e.clientY, down: mouse.down };
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragNodeRef.current) {
      dragNodeRef.current.fx = null;
      dragNodeRef.current.fy = null;
      
      // If drag distance is small, count as a click and open the note
      const mouse = mouseRef.current;
      const dist = Math.sqrt(Math.pow(e.clientX - mouse.rawX, 2) + Math.pow(e.clientY - mouse.rawY, 2));
      if (dist < 4) {
        openNote(dragNodeRef.current.id);
      }
      dragNodeRef.current = null;
    }
    mouseRef.current.down = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const rawY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const zoomIntensity = 0.05;
    const world = screenToWorld(rawX, rawY);

    const prevZoom = zoomRef.current;
    let nextZoom = prevZoom - e.deltaY * zoomIntensity * 0.01;
    nextZoom = Math.max(0.15, Math.min(nextZoom, 6.0)); // Zoom boundaries

    zoomRef.current = nextZoom;

    // Adjust pan offsets to zoom relative to the mouse cursor position
    panRef.current.x = rawX - world.x * nextZoom;
    panRef.current.y = rawY - world.y * nextZoom;
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
          margin: "8px 0 16px",
        }}
      >
        <Icon name="pageGraph" size={16} />
        <span>Graph</span>
        <span style={{ color: "var(--tx-3)", fontWeight: 400, fontSize: 12 }}>
          {simNodes.length} page{simNodes.length === 1 ? "" : "s"} · {simEdges.length}{" "}
          link{simEdges.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => {
            panRef.current = { x: 0, y: 0 };
            zoomRef.current = 1;
            refetch();
          }}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "1px solid var(--hair-strong)",
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 10,
            color: "var(--tx-2)",
            cursor: "pointer",
          }}
        >
          Reset View
        </button>
      </div>
      <div
        style={{
          border: "1px solid var(--hair-strong)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--bg-primary)",
          position: "relative",
          cursor: hoverNodeRef.current ? "pointer" : "grab",
        }}
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            maxHeight: 520,
          }}
        />
        {/* Screen-reader accessible alternative list of nodes for keyboard navigation & testing */}
        <ul
          aria-label="Graph nodes"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            border: 0,
          }}
        >
          {simNodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                onClick={() => openNote(node.id)}
                aria-label={node.label}
              >
                {node.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
