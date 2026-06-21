// GraphView.tsx — F4: the local [[wikilink]] graph over the SPS page vault.
//
// Nodes are the workspace's pages (from the page tree); edges are the wikilink
// references the note-index derives from the markdown on disk (useVaultGraph).
// Renders an interactive force-directed graph on HTML5 Canvas. Supports drag-and-drop
// node positioning, zoom and pan, and automatically resolves active theme CSS tokens.
import { useEffect, useRef, useMemo, useState } from "react";
import { useStore } from "../store";
import { useVaultGraph } from "../hooks/useNoteIndex";
import { treeWalkIds } from "../lib/tree";
import { Icon } from "../components/Icon";
import { ForceSimulation, type SimNode } from "./ForceSimulation";

function cssValue(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback;
}

function isLightCanvasColor(color: string): boolean | null {
  const value = color.trim();
  let channels: number[] | null = null;

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    const expanded =
      raw.length === 3
        ? raw
            .split("")
            .map((char) => char + char)
            .join("")
        : raw;
    channels = [0, 2, 4].map((start) =>
      Number.parseInt(expanded.slice(start, start + 2), 16),
    );
  } else {
    const rgb = value.match(/rgba?\(([^)]+)\)/i);
    if (rgb) {
      channels = rgb[1]
        .split(",")
        .slice(0, 3)
        .map((part) => Number.parseFloat(part.trim()));
    }
  }

  if (!channels || channels.some((part) => Number.isNaN(part))) return null;
  const [r, g, b] = channels.map((part) => part / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.58;
}

function truncateCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next.length > 3 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next.trim()}...`;
}

function graphCanvasSize(canvas: HTMLCanvasElement) {
  const parent = canvas.parentElement;
  const rect = parent?.getBoundingClientRect();
  return {
    width: Math.max(480, rect?.width || 640),
    height: Math.max(520, rect?.height || 560),
  };
}

type LabelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function labelRectsOverlap(a: LabelRect, b: LabelRect, padding = 5) {
  return !(
    a.x + a.width + padding < b.x ||
    b.x + b.width + padding < a.x ||
    a.y + a.height + padding < b.y ||
    b.y + b.height + padding < a.y
  );
}

function clampLabelRect(
  rect: LabelRect,
  stageWidth: number,
  stageHeight: number,
): LabelRect {
  const margin = 12;
  return {
    ...rect,
    x: Math.min(
      Math.max(rect.x, margin),
      Math.max(margin, stageWidth - rect.width - margin),
    ),
    y: Math.min(
      Math.max(rect.y, margin),
      Math.max(margin, stageHeight - rect.height - margin),
    ),
  };
}

export function GraphView() {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const activePageId = useStore((s) => s.page);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const { edges, refetch } = useVaultGraph();

  const [localMode, setLocalMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

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
    [tree],
  );

  // Re-sync simulation graph when nodes/edges change
  const { simNodes, simEdges } = useMemo(() => {
    const present = new Set(nodeIds);
    let visibleNodeIds = new Set(nodeIds);
    let visibleEdges = edges;

    // Filter to neighborhood in local mode
    if (localMode && activePageId) {
      const neighbors = new Set<string>([activePageId]);
      const localEdges = edges.filter((e) => {
        const matches = e.source === activePageId || e.target === activePageId;
        if (matches) {
          neighbors.add(e.source);
          neighbors.add(e.target);
        }
        return matches;
      });
      visibleNodeIds = neighbors;
      visibleEdges = localEdges;
    }

    const liveEdges = visibleEdges.filter(
      (e) => present.has(e.source) && present.has(e.target),
    );

    // Calculate node degree (number of connected edges)
    const degree = new Map<string, number>();
    for (const e of liveEdges) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1);
      degree.set(e.target, (degree.get(e.target) || 0) + 1);
    }

    const builtNodes: SimNode[] = Array.from(visibleNodeIds)
      .filter((id) => present.has(id))
      .map((id) => {
        const deg = degree.get(id) || 0;
        const isJournal = !!meta[id]?.journal;
        const label = meta[id]?.title || id;
        const icon = meta[id]?.icon || (isJournal ? "📅" : "📄");
        const isMatched =
          searchTerm.trim() === "" ||
          label.toLowerCase().includes(searchTerm.toLowerCase());

        return {
          id,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          r: 16 + Math.min(deg, 8) * 1.5, // Dynamic radius to fit the emoji beautifully
          label,
          active: id === activePageId,
          icon,
          isJournal,
          isMatched,
        };
      });

    return { simNodes: builtNodes, simEdges: liveEdges };
  }, [nodeIds, edges, meta, activePageId, localMode, searchTerm]);

  // Handle graph click/open note
  const openNote = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };

  // Run the force layout and canvas draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rawCtx = canvas.getContext(
      "2d",
    ) as Partial<CanvasRenderingContext2D> | null;
    if (!rawCtx) return;
    const ctx = rawCtx as CanvasRenderingContext2D;

    // Polyfill canvas context methods for the headless testing environment (JSDOM)
    if (!rawCtx.closePath) rawCtx.closePath = () => {};
    if (!rawCtx.rect) rawCtx.rect = () => {};
    if (!rawCtx.roundRect) rawCtx.roundRect = () => {};
    if (!rawCtx.measureText) {
      rawCtx.measureText = (text: string) => ({
        width: text.length * 6,
        actualBoundingBoxAscent: 0,
        actualBoundingBoxDescent: 0,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 0,
        alphabeticBaseline: 0,
        emHeightAscent: 0,
        emHeightDescent: 0,
        fontBoundingBoxAscent: 0,
        fontBoundingBoxDescent: 0,
        hangingBaseline: 0,
        ideographicBaseline: 0,
      });
    }
    if (!rawCtx.save) rawCtx.save = () => {};
    if (!rawCtx.restore) rawCtx.restore = () => {};
    if (!rawCtx.scale) rawCtx.scale = () => {};
    if (!rawCtx.translate) rawCtx.translate = () => {};
    if (!rawCtx.clearRect) rawCtx.clearRect = () => {};
    if (!rawCtx.moveTo) rawCtx.moveTo = () => {};
    if (!rawCtx.lineTo) rawCtx.lineTo = () => {};
    if (!rawCtx.stroke) rawCtx.stroke = () => {};
    if (!rawCtx.fillText) rawCtx.fillText = () => {};
    if (!rawCtx.beginPath) rawCtx.beginPath = () => {};
    if (!rawCtx.fill) rawCtx.fill = () => {};

    const initialSize = graphCanvasSize(canvas);

    // Instantiation or sync of simulation
    if (!simRef.current) {
      simRef.current = new ForceSimulation(
        simNodes,
        simEdges,
        initialSize.width,
        initialSize.height,
      );
    } else {
      simRef.current.width = initialSize.width;
      simRef.current.height = initialSize.height;
      simRef.current.setGraph(simNodes, simEdges);
    }

    // High-DPI canvas adjustment setup
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const { width, height } = graphCanvasSize(canvas);
      const dpr = window.devicePixelRatio || 1;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = "100%";
      canvas.style.height = "100%";

      if (simRef.current) {
        simRef.current.width = width;
        simRef.current.height = height;
      }
    };

    resizeCanvas();
    let resizeFrameId = 0;
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrameId);
        resizeFrameId = requestAnimationFrame(resizeCanvas);
      });
      resizeObserver.observe(canvas.parentElement || canvas);
    }

    let animationFrameId: number;

    const render = () => {
      const sim = simRef.current;
      if (!sim) return;

      // Update physics simulation
      sim.tick();

      const dpr = window.devicePixelRatio || 1;
      const styles = getComputedStyle(canvas);
      const canvasColor = cssValue(styles, "--canvas", "#10100f");
      const isDark =
        isLightCanvasColor(canvasColor) === false ||
        (isLightCanvasColor(canvasColor) === null &&
          !styles.getPropertyValue("--theme-name")?.includes("light"));
      const txNormal = cssValue(styles, "--tx-1", "#f5f1e7");
      const txMuted = cssValue(styles, "--tx-3", "#8f8a7e");
      const accent = cssValue(styles, "--accent", "#d9a400");
      const accentSoft = cssValue(
        styles,
        "--accent-soft",
        "rgba(217, 164, 0, 0.14)",
      );
      const border = cssValue(styles, "--hair-strong", "#35322b");
      const hair = cssValue(styles, "--hair", "#29261f");

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Apply High-DPI scale transform
      ctx.scale(dpr, dpr);

      const stageWidth = canvas.width / dpr;
      const stageHeight = canvas.height / dpr;
      ctx.save();
      ctx.globalAlpha = isDark ? 0.22 : 0.38;
      ctx.strokeStyle = hair;
      ctx.lineWidth = 1;
      for (let x = 0; x <= stageWidth; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, stageHeight);
        ctx.stroke();
      }
      for (let y = 0; y <= stageHeight; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(stageWidth, y);
        ctx.stroke();
      }
      ctx.restore();

      // Apply pan & zoom transforms
      ctx.translate(panRef.current.x, panRef.current.y);
      ctx.scale(zoomRef.current, zoomRef.current);

      // 1. Draw link lines with direction indicators
      for (const edge of sim.edges) {
        const u = sim.nodes.find((n) => n.id === edge.source);
        const v = sim.nodes.find((n) => n.id === edge.target);
        if (!u || !v) continue;

        const searchActive = searchTerm.trim() !== "";
        const uMatched = u.isMatched !== false;
        const vMatched = v.isMatched !== false;
        const isDimmed = searchActive && (!uMatched || !vMatched);

        const type = edge.type || "link";
        let color = border;
        let dash = [] as number[];
        let width = 1.2;

        if (type !== "link") {
          switch (type.toLowerCase()) {
            case "works_at":
            case "works-at":
              color = "#3b82f6";
              width = 1.8;
              break;
            case "advises":
              color = "#10b981";
              dash = [4, 4];
              width = 1.8;
              break;
            case "depends_on":
            case "depends-on":
              color = "#ef4444";
              dash = [6, 3];
              width = 1.8;
              break;
            default: {
              let hash = 0;
              for (let i = 0; i < type.length; i++) {
                hash = type.charCodeAt(i) + ((hash << 5) - hash);
              }
              const hue = Math.abs(hash) % 360;
              color = `hsl(${hue}, 65%, 50%)`;
              dash = [5, 5];
              width = 1.5;
            }
          }
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.globalAlpha = isDimmed ? 0.04 : 0.32;

        // Draw spring segment
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(v.x, v.y);
        ctx.stroke();

        // Draw arrow head (directed from source to target)
        if (!isDimmed) {
          const arrowLength = 7;
          const dx = v.x - u.x;
          const dy = v.y - u.y;
          const angle = Math.atan2(dy, dx);

          // Align arrowhead at target boundary
          const targetR = v.r;
          const arrowX = v.x - (targetR + 4) * Math.cos(angle);
          const arrowY = v.y - (targetR + 4) * Math.sin(angle);

          ctx.fillStyle = color;
          ctx.globalAlpha = 0.42;
          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY);
          ctx.lineTo(
            arrowX - arrowLength * Math.cos(angle - Math.PI / 6),
            arrowY - arrowLength * Math.sin(angle - Math.PI / 6),
          );
          ctx.lineTo(
            arrowX - arrowLength * Math.cos(angle + Math.PI / 6),
            arrowY - arrowLength * Math.sin(angle + Math.PI / 6),
          );
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;

      const pendingLabels: Array<{
        node: SimNode;
        visibleLabel: string;
        pillWidth: number;
        pillHeight: number;
        nodeStroke: string;
        isActive?: boolean;
        isHovered: boolean;
        isDimmed: boolean;
      }> = [];

      // 2. Draw nodes
      for (const node of sim.nodes) {
        const isActive = node.active;
        const isHovered = hoverNodeRef.current?.id === node.id;

        const searchActive = searchTerm.trim() !== "";
        const isMatched = node.isMatched !== false;
        const isDimmed = searchActive && !isMatched;

        ctx.globalAlpha = isDimmed ? 0.15 : 1.0;

        let nodeFill = accentSoft;
        let nodeStroke = accent;
        let glowColor = accentSoft;

        if (isActive) {
          nodeFill = "rgba(217, 164, 0, 0.24)";
          nodeStroke = "#d9a400";
          glowColor = "rgba(217, 164, 0, 0.2)";
        } else if (node.isJournal) {
          nodeFill = "rgba(74, 144, 226, 0.14)";
          nodeStroke = "#6da7df";
          glowColor = "rgba(74, 144, 226, 0.16)";
        } else if (node.label === "") {
          nodeFill = "rgba(143, 138, 126, 0.1)";
          nodeStroke = txMuted;
          glowColor = "rgba(143, 138, 126, 0.12)";
        }

        // Draw soft outer blur glow ring on hover/active
        if (isActive || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + (isHovered ? 8 : 5), 0, Math.PI * 2);
          ctx.fillStyle = glowColor;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = isDark
          ? "rgba(255, 255, 255, 0.05)"
          : "rgba(0, 0, 0, 0.05)";
        ctx.lineWidth = 5;
        ctx.stroke();

        // Draw background circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = nodeFill;
        ctx.fill();

        ctx.strokeStyle = nodeStroke;
        ctx.lineWidth = isActive ? 2.25 : isHovered ? 1.75 : 1.15;
        ctx.stroke();

        // Draw node icon (emoji)
        if (node.icon) {
          ctx.globalAlpha = isDimmed
            ? 0.18
            : isHovered || isActive
              ? 0.92
              : 0.7;
          ctx.font = `${Math.max(12, node.r * 0.88)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(node.icon, node.x, node.y + 1);
          ctx.globalAlpha = isDimmed ? 0.15 : 1.0;
        }

        const labelText = node.label || "Untitled page";
        ctx.font = `${isHovered || isActive ? "600 " : "500 "}12px var(--font-sans, system-ui)`;
        const visibleLabel = truncateCanvasText(ctx, labelText, 112);
        const textWidth = ctx.measureText(visibleLabel).width;
        const pillHeight = 22;
        const pillWidth = textWidth + 16;
        pendingLabels.push({
          node,
          visibleLabel,
          pillWidth,
          pillHeight,
          nodeStroke,
          isActive,
          isHovered,
          isDimmed,
        });
      }

      // 3. Draw labels after nodes so they can avoid each other.
      const placedLabels: LabelRect[] = [];
      const orderedLabels = pendingLabels.sort((a, b) => {
        const aPriority = (a.isActive ? 2 : 0) + (a.isHovered ? 1 : 0);
        const bPriority = (b.isActive ? 2 : 0) + (b.isHovered ? 1 : 0);
        return bPriority - aPriority;
      });

      for (const label of orderedLabels) {
        const { node, pillWidth, pillHeight } = label;
        const candidates = [
          {
            x: node.x - pillWidth / 2,
            y: node.y + node.r + 9,
            width: pillWidth,
            height: pillHeight,
          },
          {
            x: node.x - pillWidth / 2,
            y: node.y - node.r - pillHeight - 9,
            width: pillWidth,
            height: pillHeight,
          },
          {
            x: node.x + node.r + 12,
            y: node.y - pillHeight / 2,
            width: pillWidth,
            height: pillHeight,
          },
          {
            x: node.x - node.r - pillWidth - 12,
            y: node.y - pillHeight / 2,
            width: pillWidth,
            height: pillHeight,
          },
        ].map((rect) => clampLabelRect(rect, stageWidth, stageHeight));

        const labelRect =
          candidates.find((candidate) =>
            placedLabels.every(
              (placed) => !labelRectsOverlap(candidate, placed),
            ),
          ) || candidates[0];

        placedLabels.push(labelRect);

        ctx.globalAlpha = label.isDimmed ? 0.15 : 1.0;

        ctx.fillStyle = isDark
          ? "rgba(16, 15, 13, 0.76)"
          : "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.roundRect(labelRect.x, labelRect.y, pillWidth, pillHeight, 7);
        ctx.fill();

        ctx.strokeStyle =
          label.isActive || label.isHovered ? label.nodeStroke : border;
        ctx.lineWidth = label.isActive || label.isHovered ? 1.1 : 0.65;
        ctx.stroke();

        ctx.fillStyle = label.isActive
          ? "#f3c640"
          : label.isHovered
            ? txNormal
            : txMuted;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          label.visibleLabel,
          labelRect.x + pillWidth / 2,
          labelRect.y + pillHeight / 2 + 0.5,
        );
      }

      ctx.restore();
      ctx.globalAlpha = 1.0;

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(resizeFrameId);
      resizeObserver?.disconnect();
    };
  }, [simNodes, simEdges, searchTerm]);

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
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    mouseRef.current = {
      x: rawX,
      y: rawY,
      rawX: e.clientX,
      rawY: e.clientY,
      down: true,
    };

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
      // Imperative physics mutation during drag action.
      // eslint-disable-next-line react-hooks/immutability
      hitNode.fx = hitNode.x;
      hitNode.fy = hitNode.y;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !simRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

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
        dragNodeRef.current.fx = world.x;
        dragNodeRef.current.fy = world.y;
      } else {
        panRef.current.x += rawX - mouse.x;
        panRef.current.y += rawY - mouse.y;
      }
    }

    mouseRef.current = {
      x: rawX,
      y: rawY,
      rawX: e.clientX,
      rawY: e.clientY,
      down: mouse.down,
    };
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragNodeRef.current) {
      dragNodeRef.current.fx = null;
      dragNodeRef.current.fy = null;

      // If drag distance is small, treat as a click to navigation
      const mouse = mouseRef.current;
      const dist = Math.sqrt(
        Math.pow(e.clientX - mouse.rawX, 2) +
          Math.pow(e.clientY - mouse.rawY, 2),
      );
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
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    const zoomIntensity = 0.05;
    const world = screenToWorld(rawX, rawY);

    const prevZoom = zoomRef.current;
    let nextZoom = prevZoom - e.deltaY * zoomIntensity * 0.01;
    nextZoom = Math.max(0.15, Math.min(nextZoom, 6.0)); // Zoom boundaries

    zoomRef.current = nextZoom;

    // Adjust pan offsets to zoom relative to cursor position
    panRef.current.x = rawX - world.x * nextZoom;
    panRef.current.y = rawY - world.y * nextZoom;
  };

  if (nodeIds.length === 0) {
    return (
      <div className="graph-empty">
        <Icon name="pageGraph" size={28} />
        <div className="graph-empty-title">No pages to graph yet.</div>
      </div>
    );
  }

  const connectedPageCount = new Set(
    simEdges.flatMap((edge) => [edge.source, edge.target]),
  ).size;

  return (
    <div className="graph-view">
      <div className="graph-head">
        <div className="graph-title">
          <span className="graph-title-icon">
            <Icon name="pageGraph" size={16} />
          </span>
          <div>
            <h1>Page Graph</h1>
            <div className="graph-title-meta">Wikilink map</div>
          </div>
        </div>
        <div className="graph-stats" aria-label="Graph summary">
          <span>
            {simNodes.length} page{simNodes.length === 1 ? "" : "s"}
          </span>
          <span>
            {simEdges.length} link{simEdges.length === 1 ? "" : "s"}
          </span>
          <span>{connectedPageCount} connected</span>
        </div>
      </div>

      <div className="graph-container">
        <div className="graph-toolbar">
          <div className="graph-toolbar-left">
            <div className="graph-search-box">
              <Icon name="search" size={13} style={{ opacity: 0.7 }} />
              <input
                type="text"
                className="graph-search-input"
                placeholder="Find pages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                title="Search graph nodes"
              />
            </div>

            <button
              type="button"
              className={`graph-btn ${localMode ? "active" : ""}`}
              onClick={() => setLocalMode(!localMode)}
              title="Toggle Local Filter (current note and neighbors)"
              aria-pressed={localMode}
            >
              <Icon name="wand" size={12} />
              <span>{localMode ? "Local" : "Global"}</span>
            </button>
          </div>

          <div className="graph-toolbar-right">
            <button
              type="button"
              className="graph-icon-btn"
              onClick={() => {
                zoomRef.current = Math.min(6.0, zoomRef.current + 0.15);
              }}
              title="Zoom In"
              aria-label="Zoom in"
            >
              <Icon name="plus" size={14} />
            </button>
            <button
              type="button"
              className="graph-icon-btn"
              onClick={() => {
                zoomRef.current = Math.max(0.15, zoomRef.current - 0.15);
              }}
              title="Zoom Out"
              aria-label="Zoom out"
            >
              <span aria-hidden="true">−</span>
            </button>
            <button
              type="button"
              className="graph-btn"
              onClick={() => {
                panRef.current = { x: 0, y: 0 };
                zoomRef.current = 1;
                refetch();
              }}
              title="Reset View"
            >
              <Icon name="refresh" size={13} />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <div className="graph-stage">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            className="graph-canvas"
          />

          {/* Screen-reader accessible alternative list of nodes for keyboard navigation & testing */}
          <ul aria-label="Graph nodes" className="sr-only">
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
    </div>
  );
}
