// ObsidianExplorer.tsx — recursive browser for the configured Obsidian vault.
// Uses getObsidianTree and getObsidianConfig IPC, handles collapsible dirs, and
// switches SpsAgent to the "obsidian-note" surface on file selection.
import { useEffect, useState, useCallback } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";

interface ObsidianFileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: ObsidianFileNode[];
}

export function ObsidianExplorer() {
  const activeObsidianPath = useStore((s) => s.activeObsidianPath);
  const setActiveObsidianPath = useStore((s) => s.setActiveObsidianPath);
  const setSurface = useStore((s) => s.setSurface);

  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<ObsidianFileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const refreshTree = useCallback(async () => {
    const api = window.hermesAPI;
    if (!api?.getObsidianConfig || !api?.getObsidianTree) return;

    setLoading(true);
    setError("");
    try {
      const config = await api.getObsidianConfig();
      setEnabled(config.enabled);

      if (config.enabled) {
        const nodes = await api.getObsidianTree();
        setTree(nodes);
      } else {
        setTree([]);
      }
    } catch (err) {
      setError((err as Error).message || "Failed to load Obsidian vault tree");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTree();

    const api = window.hermesAPI;
    if (api?.onObsidianFileChanged) {
      // Refresh the tree on external file modifications
      const cleanup = api.onObsidianFileChanged(() => {
        refreshTree();
      });
      return cleanup;
    }
    return undefined;
  }, [refreshTree]);

  const toggleDirectory = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectFile = (path: string) => {
    setActiveObsidianPath(path);
    setSurface("obsidian-note");
  };

  const renderNode = (node: ObsidianFileNode, depth: number) => {
    const isDir = node.kind === "directory";
    const isExpanded = expandedDirs.has(node.path);
    const isActive = activeObsidianPath === node.path;

    if (isDir) {
      return (
        <div key={node.path}>
          <div
            className="tree-row"
            style={{ paddingLeft: depth * 12 + 6 }}
            onClick={(e) => toggleDirectory(node.path, e)}
          >
            <span className={`tree-toggle ${isExpanded ? "open" : ""}`}>
              <Icon name="chevR" size={13} />
            </span>
            <span
              style={{
                marginRight: 6,
                opacity: 0.7,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon name="board" size={14} />
            </span>
            <span className="tree-label" style={{ fontWeight: 500 }}>
              {node.name}
            </span>
          </div>
          {isExpanded && node.children && (
            <div className="tree-children">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={`tree-row ${isActive ? "active" : ""}`}
        style={{ paddingLeft: depth * 12 + 19 }}
        onClick={() => selectFile(node.path)}
      >
        <span
          style={{
            marginRight: 6,
            opacity: 0.6,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Icon name="doc" size={14} />
        </span>
        <span className="tree-label">{node.name.replace(/\.md$/i, "")}</span>
      </div>
    );
  };

  if (loading && tree.length === 0) {
    return (
      <div style={{ padding: "8px 16px", color: "var(--tx-4)", fontSize: 12 }}>
        Loading vault...
      </div>
    );
  }

  if (!enabled) {
    return (
      <div
        style={{
          padding: "8px 16px",
          color: "var(--tx-2)",
          fontSize: 11.5,
          lineHeight: 1.4,
        }}
      >
        Obsidian vault path is not configured.
        <div style={{ marginTop: 6 }}>
          Set it in <b>Tweaks Panel → Storage</b>.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{ padding: "8px 16px", color: "var(--error)", fontSize: 11.5 }}
      >
        Error: {error}
      </div>
    );
  }

  return (
    <div className="obsidian-explorer" style={{ paddingBottom: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 16px 6px",
          color: "var(--tx-3)",
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        <span>Files</span>
        <button
          onClick={refreshTree}
          title="Refresh vault files"
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Icon name="clock" size={12} />
        </button>
      </div>
      {tree.length === 0 ? (
        <div
          style={{ padding: "8px 16px", color: "var(--tx-4)", fontSize: 11.5 }}
        >
          Empty vault.
        </div>
      ) : (
        tree.map((node) => renderNode(node, 0))
      )}
    </div>
  );
}
