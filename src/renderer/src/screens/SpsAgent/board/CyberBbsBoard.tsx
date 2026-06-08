import { useState, useRef, useEffect, useMemo } from "react";
import { useStore } from "../store";
import { AnsiWindowCard } from "./AnsiWindowCard";
import { BbsTerminalNode } from "./BbsTerminalNode";
import { SvgCables } from "./SvgCables";
import { Icon } from "../components/Icon";
import { treeWalkIds } from "../lib/tree";
import "./board.css";

interface Position {
  x: number;
  y: number;
}

export function CyberBbsBoard() {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const setPageMeta = useStore((s) => s.setPageMeta);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const homeSurface = useStore((s) => s.t.homeSurface ?? "doc");
  const setTweak = useStore((s) => s.setTweak);

  // Board display preferences
  const [theme, setTheme] = useState<"green" | "amber">("green");
  const [showGrid, setShowGrid] = useState(true);
  const [scanlines, setScanlines] = useState(true);

  // Canvas Viewport Pan State
  const [pan, setPan] = useState<Position>({ x: 0, y: 0 });
  const zoom = 1;
  const isPanningRef = useRef(false);
  const panStartRef = useRef<Position>({ x: 0, y: 0 });

  // Dragging Card State
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [draggedBbs, setDraggedBbs] = useState(false);
  const dragOffsetRef = useRef<Position>({ x: 0, y: 0 });

  // Custom local state for positions of cards (prefixed with pan/grid positions)
  const [localBbsPos, setLocalBbsPos] = useState<Position>({ x: 100, y: 150 });

  // Flatten tree to get all valid vault page records
  const allVaultPages = useMemo(() => {
    const ids = Array.from(new Set(tree.flatMap((n) => treeWalkIds(n))));
    return ids.map((id) => ({
      id,
      meta: meta[id] || { title: "Untitled", icon: "📄", cover: null },
    }));
  }, [tree, meta]);

  // Pages currently positioned/pinned on the corkboard
  const boardPages = useMemo(() => {
    return allVaultPages.filter(
      (p) => p.meta.x !== undefined && p.meta.y !== undefined,
    );
  }, [allVaultPages]);

  // Seed default items if the board starts completely empty
  useEffect(() => {
    const unpositioned = allVaultPages.filter(
      (p) => p.meta.x === undefined || p.meta.y === undefined,
    );
    if (boardPages.length === 0 && unpositioned.length > 0) {
      // Seed home page at center
      const homePage = unpositioned.find((p) => p.id === "home");
      if (homePage) {
        setPageMeta("home", { x: 520, y: 120, color: "green" });
      }

      // Seed another page nearby to showcase connection
      const otherPage = unpositioned.find((p) => p.id !== "home");
      if (otherPage && homePage) {
        setPageMeta(otherPage.id, {
          x: 920,
          y: 350,
          color: "green",
          connections: ["home"],
        });
      }
    }
  }, [allVaultPages, boardPages, setPageMeta]);

  // Build key-value map of positions for SVG cable calculations
  const nodePositions = useMemo(() => {
    const posMap: Record<string, Position> = {};
    for (const p of boardPages) {
      posMap[p.id] = { x: p.meta.x!, y: p.meta.y! };
    }
    // Also include Bbs console node
    posMap["bbs-console"] = localBbsPos;
    return posMap;
  }, [boardPages, localBbsPos]);

  // Card dimensions (static map to match layout bounds in AnsiWindowCard)
  const nodeDimensions = useMemo(() => {
    const dimMap: Record<string, { width: number; height: number }> = {};
    for (const p of boardPages) {
      dimMap[p.id] = {
        width: p.meta.width || 280,
        height: p.meta.height || 180,
      };
    }
    dimMap["bbs-console"] = { width: 440, height: 400 };
    return dimMap;
  }, [boardPages]);

  // Flattened array of active connections
  const boardConnections = useMemo(() => {
    const list: { source: string; target: string }[] = [];
    for (const p of boardPages) {
      if (p.meta.connections) {
        for (const target of p.meta.connections) {
          list.push({ source: p.id, target });
        }
      }
    }
    return list;
  }, [boardPages]);

  // Pan canvas on pointer down (if not clicking card elements)
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".ansi-card")) return;
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  // Drag Card start handler
  const handleCardDragStart = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const pos = nodePositions[id] || { x: 0, y: 0 };
    setDraggedNodeId(id);
    dragOffsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };

  // Drag BBS console start handler
  const handleBbsDragStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    setDraggedBbs(true);
    dragOffsetRef.current = {
      x: e.clientX - localBbsPos.x,
      y: e.clientY - localBbsPos.y,
    };
  };

  // Mouse Move listener: handles dragging cards or panning grid background
  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanningRef.current) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
    } else if (draggedNodeId) {
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;

      // Update local store state coordinates
      setPageMeta(draggedNodeId, { x: Math.round(newX), y: Math.round(newY) });
    } else if (draggedBbs) {
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      setLocalBbsPos({ x: Math.round(newX), y: Math.round(newY) });
    }
  };

  const handlePointerUp = () => {
    isPanningRef.current = false;
    setDraggedNodeId(null);
    setDraggedBbs(false);
  };

  // Double click canvas: create connection wire between active card and home node
  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".ansi-card")) return;

    // Spawn a fresh notes card under active double clicked grid coordinates
    const unpositioned = allVaultPages.filter(
      (p) => p.meta.x === undefined || p.meta.y === undefined,
    );
    if (unpositioned.length === 0) return;

    // Calculate virtual coordinates inside board space accounting for pan offset
    const virtualX = Math.round((e.clientX - pan.x) / zoom);
    const virtualY = Math.round((e.clientY - pan.y) / zoom);

    // Eject the first unpositioned page to clicked point
    const target = unpositioned[0];
    setPageMeta(target.id, { x: virtualX, y: virtualY, color: "green" });
  };

  // Navigates back to the main document editor
  const handleSelectPage = (id: string) => {
    selectPage(id);
    setSurface("doc");
  };

  // Eject page handler triggered by BBS console command `/eject`
  const handleEjectPage = (pageId: string) => {
    // Eject page at the center of current viewport window
    const centerX = Math.round((window.innerWidth / 2 - pan.x - 140) / zoom);
    const centerY = Math.round((window.innerHeight / 2 - pan.y - 90) / zoom);
    setPageMeta(pageId, { x: centerX, y: centerY, color: "green" });
  };

  // Remote remove from corkboard card properties (leaves disk file untouched)
  const handleRemoveFromBoard = (id: string) => {
    setPageMeta(id, { x: undefined, y: undefined, connections: undefined });
  };

  // Connects two nodes with a wire line
  const handleAddConnection = (sourceId: string, targetId: string) => {
    const srcPage = boardPages.find((p) => p.id === sourceId);
    if (!srcPage) return;
    const currentConns = srcPage.meta.connections || [];
    if (!currentConns.includes(targetId)) {
      setPageMeta(sourceId, { connections: [...currentConns, targetId] });
    }
  };

  return (
    <div
      className={`cyber-board-viewport ${theme === "amber" ? "theme-amber" : ""}`}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleCanvasDoubleClick}
    >
      {/* Floating HUD Controls */}
      <div className="cyber-hud">
        <button
          className={`cyber-hud-btn ${showGrid ? "active" : ""}`}
          onClick={() => setShowGrid(!showGrid)}
          title="Toggle Grid"
        >
          <Icon name="table" size={13} />
          <span>GRID</span>
        </button>
        <button
          className={`cyber-hud-btn ${scanlines ? "active" : ""}`}
          onClick={() => setScanlines(!scanlines)}
          title="Toggle Scanlines"
        >
          <Icon name="code" size={13} />
          <span>CRT</span>
        </button>
        <button
          className="cyber-hud-btn"
          onClick={() => setTheme(theme === "green" ? "amber" : "green")}
          title="Switch Theme Color"
        >
          <Icon name="sun" size={13} />
          <span>{theme.toUpperCase()}</span>
        </button>
        <button
          className="cyber-hud-btn"
          onClick={() => setPan({ x: 0, y: 0 })}
          title="Center Canvas"
        >
          <Icon name="home" size={13} />
          <span>CENTER</span>
        </button>
        <button
          className={`cyber-hud-btn ${homeSurface === "board" ? "active" : ""}`}
          onClick={() => setTweak("homeSurface", homeSurface === "board" ? "doc" : "board")}
          title={homeSurface === "board" ? "Currently set as home page" : "Set board as home page"}
        >
          <Icon name="star" size={13} />
          <span>{homeSurface === "board" ? "HOME" : "SET AS HOME"}</span>
        </button>
      </div>

      {/* Main Coordinate Grid Layer */}
      <div
        className="cyber-grid"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          backgroundImage: showGrid ? undefined : "none",
        }}
      >
        {/* Connection Cables Lines Overlay */}
        <SvgCables
          connections={boardConnections}
          nodePositions={nodePositions}
          nodeDimensions={nodeDimensions}
        />

        {/* Central BBS Console Terminal Node */}
        <BbsTerminalNode
          x={localBbsPos.x}
          y={localBbsPos.y}
          activeTheme={theme}
          onThemeToggle={() => setTheme(theme === "green" ? "amber" : "green")}
          onDragStart={handleBbsDragStart}
          onEjectPage={handleEjectPage}
          allPages={allVaultPages}
        />

        {/* Floating Note Window Cards */}
        {boardPages.map((p) => (
          <AnsiWindowCard
            key={p.id}
            id={p.id}
            meta={p.meta}
            x={p.meta.x!}
            y={p.meta.y!}
            width={p.meta.width}
            height={p.meta.height}
            onDragStart={handleCardDragStart}
            onSelect={handleSelectPage}
            onUpdateMeta={setPageMeta}
            onRemove={handleRemoveFromBoard}
            onAddConnection={handleAddConnection}
          />
        ))}
      </div>

      {/* CRT Scanline Filter Overlays */}
      {scanlines && (
        <div className="crt-overlay crt-flicker-anim">
          <div className="crt-scanlines" />
          <div className="crt-vignette" />
        </div>
      )}
    </div>
  );
}
