import {
  ChevronLeft,
  ChevronRight,
  History,
  MessageSquare,
  PanelLeft,
  PanelRight,
} from "lucide-react";

export type WorkspaceMode = "split" | "canvas" | "chat";

interface WorkspaceHeaderProps {
  path: string;
  mode: WorkspaceMode;
  externalHighlight: boolean;
  onModeChange: (mode: WorkspaceMode) => void;
  onOpenPalette: () => void;
  onNavigateCrumb: (path: string) => void;
  onBack: () => void;
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
  onOpenHistory: () => void;
}

export default function WorkspaceHeader({
  path,
  mode,
  externalHighlight,
  onModeChange,
  onOpenPalette,
  onNavigateCrumb,
  onBack,
  onForward,
  canBack,
  canForward,
  onOpenHistory,
}: WorkspaceHeaderProps): React.JSX.Element {
  const crumbs = path.split("/");
  return (
    <header className="workspace-header">
      <div className="workspace-breadcrumbs" aria-label="Workspace breadcrumbs">
        <button
          type="button"
          aria-label="Back"
          disabled={!canBack}
          onClick={onBack}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!canForward}
          onClick={onForward}
        >
          <ChevronRight size={15} />
        </button>
        {crumbs.map((crumb, index) => (
          <span key={`${crumb}-${index}`}>
            {index > 0 && <span className="workspace-crumb-separator">/</span>}
            <button
              type="button"
              onClick={() =>
                onNavigateCrumb(crumbs.slice(0, index + 1).join("/"))
              }
            >
              {crumb}
            </button>
          </span>
        ))}
        {externalHighlight && (
          <span className="workspace-agent-badge">Agent updated</span>
        )}
      </div>
      <div className="workspace-header-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onOpenPalette}
        >
          Cmd+K
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-label="Version history"
          onClick={onOpenHistory}
        >
          <History size={14} />
        </button>
        <div
          className="workspace-mode-toggle"
          role="group"
          aria-label="Workspace mode"
        >
          <button
            type="button"
            className={mode === "split" ? "active" : ""}
            onClick={() => onModeChange("split")}
            title="Split view"
            aria-label="Split view"
          >
            <PanelLeft size={15} />
          </button>
          <button
            type="button"
            className={mode === "canvas" ? "active" : ""}
            onClick={() => onModeChange("canvas")}
            title="Canvas only"
            aria-label="Canvas only"
          >
            <PanelRight size={15} />
          </button>
          <button
            type="button"
            className={mode === "chat" ? "active" : ""}
            onClick={() => onModeChange("chat")}
            title="Chat only"
            aria-label="Chat only"
          >
            <MessageSquare size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
