import { useMemo } from "react";
import type { PageMeta } from "../types";
import { useStore } from "../store";

interface AnsiWindowCardProps {
  id: string;
  meta: PageMeta;
  x: number;
  y: number;
  width?: number;
  height?: number;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onSelect: (id: string) => void;
  onUpdateMeta: (id: string, patch: Partial<PageMeta>) => void;
  onRemove: (id: string) => void;
  onAddConnection: (sourceId: string, targetId: string) => void;
  allPages: { id: string; meta: PageMeta }[];
}

export function AnsiWindowCard({
  id,
  meta,
  x,
  y,
  width = 280,
  height = 240, // Expanded height to hold card content summaries and visual selectors
  onDragStart,
  onSelect,
  onUpdateMeta,
  onRemove,
  onAddConnection,
  allPages,
}: AnsiWindowCardProps) {
  // Query actual blocks from global Zustand store
  const docs = useStore((s) => s.docs);
  const blocks = docs[id] || [];

  // Extract the first few text blocks to show note contents
  const textSummary = useMemo(() => {
    const textBlocks = blocks.filter(
      (b) =>
        b.text &&
        (b.type === "p" ||
          b.type === "h1" ||
          b.type === "h2" ||
          b.type === "h3" ||
          b.type === "quote" ||
          b.type === "callout" ||
          b.type === "todo" ||
          b.type === "li" ||
          b.type === "numli")
    );
    if (textBlocks.length === 0) return "No content.";
    return textBlocks
      .map((b) => (b.type === "todo" ? `${b.done ? "☑" : "☐"} ${b.text}` : b.text))
      .slice(0, 3)
      .join("\n");
  }, [blocks]);

  const cleanTitle = meta.title || "Untitled Note";
  const activeColor = meta.color || "green";

  // Color options for swatches
  const colorOptions = [
    { name: "green", hex: "#22c55e" },
    { name: "amber", hex: "#d97706" },
    { name: "red", hex: "#ef4444" },
    { name: "blue", hex: "#3b82f6" },
  ];

  return (
    <div
      className={`ansi-card border-${activeColor}`}
      style={{
        transform: `translate(${x}px, ${y}px)`,
        width,
        height,
        zIndex: 20,
        // Override border-color dynamically if a theme color is active
        borderColor: colorOptions.find((c) => c.name === activeColor)?.hex,
        boxShadow: `0 0 15px ${colorOptions.find((c) => c.name === activeColor)?.hex}33`,
      }}
    >
      {/* Draggable Header */}
      <div
        className="ansi-card-header"
        onPointerDown={(e) => onDragStart(e, id)}
        style={{
          backgroundColor: `${colorOptions.find((c) => c.name === activeColor)?.hex}22`,
        }}
      >
        <span>
          [{id.slice(-4).toUpperCase()}] {cleanTitle.slice(0, 16)}
          {cleanTitle.length > 16 ? "..." : ""}
        </span>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "0 2px",
              fontSize: "10px",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
            title="Open note in editor"
          >
            [EDIT]
          </button>
          <button
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "0 2px",
              fontSize: "10px",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(id);
            }}
            title="Remove from board"
          >
            [X]
          </button>
        </div>
      </div>

      {/* Note Body with Content and Visual Controls */}
      <div
        className="ansi-card-body scroll"
        onDoubleClick={() => onSelect(id)}
        style={{ display: "flex", flexDirection: "column", gap: "8px" }}
      >
        {/* Title and Icon */}
        <div style={{ fontWeight: "bold", fontSize: "12px", display: "flex", gap: "4px" }}>
          <span>{meta.icon || "📄"}</span>
          <span>{cleanTitle}</span>
        </div>

        {/* Real Content Preview */}
        <div className="bbs-card-content">{textSummary}</div>

        {/* Color Swatch Selectors */}
        <div style={{ marginTop: "auto" }}>
          <div style={{ fontSize: "10px", opacity: 0.6, marginBottom: "3px" }}>CARD THEME COLOR:</div>
          <div className="bbs-color-swatches">
            {colorOptions.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`bbs-color-swatch ${activeColor === c.name ? "active" : ""}`}
                style={{ backgroundColor: c.hex }}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateMeta(id, { color: c.name });
                }}
                title={`Change color to ${c.name}`}
              />
            ))}
          </div>
        </div>

        {/* Visual Wire Linker Dropdown */}
        <div className="bbs-wire-linker" onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: "10px", opacity: 0.6 }}>WIRE LINK TO:</span>
          <select
            className="bbs-select"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                onAddConnection(id, e.target.value);
              }
            }}
          >
            <option value="">-- select connection node --</option>
            {allPages
              .filter((p) => p.id !== id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.meta.icon || "📄"} {p.meta.title || p.id}
                </option>
              ))}
          </select>
        </div>

        {/* Action Links */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", borderTop: "1px dashed rgba(255, 255, 255, 0.15)", paddingTop: "4px" }}>
          <span className="bbs-action-link" onClick={() => onSelect(id)}>
            OPEN IN EDITOR
          </span>
          <span className="bbs-action-link" style={{ color: "#ef4444" }} onClick={() => onRemove(id)}>
            REMOVE
          </span>
        </div>
      </div>
    </div>
  );
}
