import { useState, useRef, useEffect } from "react";
import type { PageMeta } from "../types";

interface AnsiWindowCardProps {
  id: string;
  meta: PageMeta;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onSelect: (id: string) => void;
  onUpdateMeta: (id: string, patch: Partial<PageMeta>) => void;
  onRemove: (id: string) => void;
  onAddConnection: (sourceId: string, targetId: string) => void;
}

export function AnsiWindowCard({
  id,
  meta,
  x,
  y,
  width = 280,
  height = 180,
  onDragStart,
  onSelect,
  onUpdateMeta,
  onRemove,
  onAddConnection,
}: AnsiWindowCardProps) {
  const [cmdInput, setCmdInput] = useState("");
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLogs]);

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = cmdInput.trim();
    if (!cmd) return;

    setConsoleLogs((prev) => [...prev, `> ${cmd}`]);
    setCmdInput("");

    const args = cmd.split(" ");
    const primary = args[0].toLowerCase();

    switch (primary) {
      case "help":
        setConsoleLogs((prev) => [
          ...prev,
          "Commands: color [c], wire [id], rename [name], clear, rm",
        ]);
        break;
      case "color":
        if (args[1]) {
          onUpdateMeta(id, { color: args[1] });
          setConsoleLogs((prev) => [...prev, `Color updated to ${args[1]}`]);
        } else {
          setConsoleLogs((prev) => [...prev, "Usage: color <name/hex>"]);
        }
        break;
      case "wire":
      case "connect":
        if (args[1]) {
          onAddConnection(id, args[1]);
          setConsoleLogs((prev) => [...prev, `Wired to ${args[1]}`]);
        } else {
          setConsoleLogs((prev) => [...prev, "Usage: wire <nodeId>"]);
        }
        break;
      case "rename": {
        const newTitle = args.slice(1).join(" ");
        if (newTitle) {
          onUpdateMeta(id, { title: newTitle });
          setConsoleLogs((prev) => [...prev, `Renamed to: ${newTitle}`]);
        } else {
          setConsoleLogs((prev) => [...prev, "Usage: rename <new title>"]);
        }
        break;
      }
      case "clear":
        setConsoleLogs([]);
        break;
      case "rm":
      case "delete":
        onRemove(id);
        break;
      default:
        setConsoleLogs((prev) => [...prev, `Unknown command: ${primary}`]);
        break;
    }
  };

  const cleanTitle = meta.title || "Untitled Note";

  return (
    <div
      className="ansi-card"
      style={{
        transform: `translate(${x}px, ${y}px)`,
        width,
        height,
        zIndex: 20,
      }}
    >
      <div
        className="ansi-card-header"
        onPointerDown={(e) => onDragStart(e, id)}
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

      <div
        className="ansi-card-body scroll"
        onDoubleClick={() => onSelect(id)}
        style={{ cursor: "pointer" }}
        title="Double-click to open in document editor"
      >
        {consoleLogs.length === 0 ? (
          <div
            style={{
              color: "var(--phosphor-text)",
              fontSize: "12px",
              lineHeight: "1.4",
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
              {meta.icon || "📄"} {cleanTitle}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.4)",
                fontSize: "11px",
                marginBottom: "8px",
              }}
            >
              {"Double-click grid to connect nodes. Type 'help' below."}
            </div>
            {meta.tags && meta.tags.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  flexWrap: "wrap",
                  marginTop: "4px",
                }}
              >
                {meta.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      color: "var(--phosphor-glow)",
                      fontSize: "10px",
                      background: "rgba(0,255,0,0.1)",
                      padding: "1px 4px",
                    }}
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: "11px", fontFamily: "monospace" }}>
            {consoleLogs.map((log, index) => (
              <div key={index} style={{ marginBottom: "2px" }}>
                {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleCommandSubmit} className="ansi-card-prompt">
        <span>&gt;</span>
        <input
          type="text"
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          placeholder="type cmd..."
          autoCapitalize="off"
          autoComplete="off"
        />
      </form>
    </div>
  );
}
