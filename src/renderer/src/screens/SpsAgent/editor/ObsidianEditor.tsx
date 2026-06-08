// ObsidianEditor.tsx — dedicated Markdown editor for arbitrary Obsidian notes.
// Reads/writes vault files via hermesAPI, auto-saves on a 500ms debounce, and
// registers an IPC file listener to sync edits made inside the Obsidian app.
import { useEffect, useState, useRef } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";

export function ObsidianEditor() {
  const path = useStore((s) => s.activeObsidianPath);
  const setSurface = useStore((s) => s.setSurface);
  const flash = useStore((s) => s.flash);

  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"clean" | "saving" | "synced">("clean");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Track standard profile key
  const profile = "default";

  // Load note content on path change
  useEffect(() => {
    if (!path) return;

    const load = async () => {
      setLoading(true);
      setSyncStatus("clean");
      try {
        const data = await window.hermesAPI.readObsidianFile(path, profile);
        setContent(data);
      } catch (err) {
        flash((err as Error).message || "Failed to read Obsidian note", { tone: "warn" });
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [path, flash]);

  // Handle auto-save on content change (500ms debounce)
  const handleContentChange = (val: string) => {
    setContent(val);
    setSyncStatus("saving");

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(async () => {
      if (!path) return;
      try {
        await window.hermesAPI.writeObsidianFile(path, val, profile);
        setSyncStatus("synced");
        setTimeout(() => setSyncStatus("clean"), 1500);
      } catch (err) {
        flash("Failed to save Obsidian note", { tone: "warn" });
        setSyncStatus("clean");
      }
    }, 500);
  };

  // Sync edits made externally inside the Obsidian application
  useEffect(() => {
    if (!path) return undefined;

    const api = window.hermesAPI;
    if (api?.onObsidianFileChanged) {
      const cleanup = api.onObsidianFileChanged((event) => {
        if (event.path === path) {
          // Only update if content actually differs to prevent cursor jump
          setContent((current) => {
            if (current !== event.content) {
              return event.content;
            }
            return current;
          });
        }
      });
      return cleanup;
    }
    return undefined;
  }, [path]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const openInObsidian = async () => {
    if (!path) return;
    try {
      await window.hermesAPI.openObsidianNote(path, profile);
      flash("Opening note in Obsidian app...");
    } catch (err) {
      flash("Obsidian is not running or bridge is disconnected", { tone: "warn" });
    }
  };

  const closeNote = () => {
    setSurface("doc");
  };

  if (!path) {
    return (
      <div style={{ padding: 40, color: "var(--tx-3)", textAlign: "center" }}>
        No note selected. Select a note from the Obsidian Vault in the sidebar.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 40, color: "var(--tx-3)", textAlign: "center" }}>
        Loading note...
      </div>
    );
  }

  return (
    <div
      className="obsidian-editor-surface"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        padding: "8px 24px 32px",
        boxSizing: "border-box",
      }}
    >
      {/* Editor Header Toolbar */}
      <div
        className="obsidian-editor-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 0 16px",
          borderBottom: "1px solid var(--hair-strong)",
          marginBottom: 16,
        }}
      >
        <button
          onClick={closeNote}
          style={{
            background: "none",
            border: "1px solid var(--hair-strong)",
            borderRadius: 4,
            padding: "4px 8px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "var(--tx-2)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <Icon name="chevR" size={13} style={{ transform: "rotate(180deg)" }} />
          Back
        </button>

        <span
          style={{
            color: "var(--tx-2)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={path}
        >
          {path}
        </span>

        {/* Sync Status Badge */}
        <span
          style={{
            fontSize: 11,
            color: syncStatus === "saving" ? "var(--accent)" : "var(--tx-4)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {syncStatus === "saving" && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent)",
                display: "inline-block",
                animation: "pulse 1s infinite alternate",
              }}
            />
          )}
          {syncStatus === "saving" ? "Saving..." : syncStatus === "synced" ? "Saved" : "Synced"}
        </span>

        <button
          onClick={openInObsidian}
          style={{
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            padding: "4px 12px",
            color: "var(--accent)",
            fontWeight: 500,
            cursor: "pointer",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="sparkle" size={12} />
          Reveal in Obsidian
        </button>
      </div>

      {/* Editor Content Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="# New Note..."
          style={{
            flex: 1,
            width: "100%",
            background: "none",
            border: "none",
            resize: "none",
            outline: "none",
            color: "var(--tx-1)",
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: "var(--font-mono, monospace)",
            padding: "8px 0",
            boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}
