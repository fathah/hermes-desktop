import { memo, useState, useEffect, useRef } from "react";
import { FolderOpen, FolderTree, X, Check } from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface ContextFolderChipProps {
  /** Working folder bound to this conversation (issue #27), or null. */
  contextFolder: string | null;
  /** Hidden in remote/SSH mode, where the picker browses the wrong machine. */
  show: boolean;
  worktreeVisible: boolean;
  onPickFolder: () => void;
  onClearFolder: () => void;
  onToggleWorktree: () => void;
  onSelectRecentFolder?: (path: string) => void;
}

/** Last path segment, for the compact chip label (handles \ and /). */
function folderName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Context-folder control rendered as a chip in the input footer, next to the
 * model picker (both share the `.chat-meta-chip` style). When clicked, opens a
 * dropdown popup showing recent project folders and an "Open folder..." option.
 */
export const ContextFolderChip = memo(function ContextFolderChip({
  contextFolder,
  show,
  worktreeVisible,
  onPickFolder,
  onClearFolder,
  onToggleWorktree,
  onSelectRecentFolder,
}: ContextFolderChipProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void window.hermesAPI
      .listRecentSessionContextFolders(20)
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setRecentFolders(list);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  if (!show) return null;

  const renderDropdown = (): React.JSX.Element => (
    <div className="chat-ctxfolder-dropdown">
      <div className="chat-ctxfolder-dropdown-header">Recent</div>
      <div className="chat-ctxfolder-dropdown-list">
        {recentFolders.length === 0 ? (
          <div className="chat-ctxfolder-dropdown-empty">No recent folders</div>
        ) : (
          recentFolders.map((path) => {
            const isSelected = path === contextFolder;
            return (
              <button
                key={path}
                type="button"
                className={`chat-ctxfolder-dropdown-item${
                  isSelected ? " chat-ctxfolder-dropdown-item--active" : ""
                }`}
                onClick={() => {
                  onSelectRecentFolder?.(path);
                  setIsOpen(false);
                }}
                title={path}
              >
                <span className="chat-ctxfolder-dropdown-item-name">{folderName(path)}</span>
                {isSelected && (
                  <Check size={14} className="chat-ctxfolder-dropdown-item-check" />
                )}
              </button>
            );
          })
        )}
      </div>
      <div className="chat-ctxfolder-dropdown-divider" />
      <button
        type="button"
        className="chat-ctxfolder-dropdown-item chat-ctxfolder-dropdown-item--open"
        onClick={() => {
          setIsOpen(false);
          onPickFolder();
        }}
      >
        <span>Open folder...</span>
      </button>
    </div>
  );

  if (!contextFolder) {
    return (
      <div className="chat-ctxfolder-picker" ref={containerRef}>
        <button
          className="chat-meta-chip"
          onClick={() => setIsOpen((v) => !v)}
          title={t("chat.setContextFolder")}
          type="button"
        >
          <FolderOpen size={13} />
          <span>{t("chat.contextFolderChip")}</span>
        </button>
        {isOpen && renderDropdown()}
      </div>
    );
  }

  return (
    <div className="chat-ctxfolder-group" ref={containerRef}>
      <button
        className="chat-meta-chip chat-meta-chip--active"
        onClick={() => setIsOpen((v) => !v)}
        title={t("chat.contextFolderActive", { path: contextFolder })}
        type="button"
      >
        <FolderOpen size={13} />
        <span className="chat-ctxfolder-name">{folderName(contextFolder)}</span>
      </button>
      <button
        className="chat-meta-chip-icon"
        onClick={onClearFolder}
        title={t("chat.removeContextFolder")}
        type="button"
      >
        <X size={11} />
      </button>
      <button
        className={`chat-meta-chip-icon${
          worktreeVisible ? " chat-meta-chip-icon--active" : ""
        }`}
        onClick={onToggleWorktree}
        title={
          worktreeVisible ? t("chat.hideWorktree") : t("chat.showWorktree")
        }
        type="button"
      >
        <FolderTree size={13} />
      </button>
      {isOpen && renderDropdown()}
    </div>
  );
});
