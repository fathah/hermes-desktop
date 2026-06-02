import { memo } from "react";
import { FolderOpen, FolderTree, X } from "lucide-react";
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
}

/** Last path segment, for the compact chip label (handles \ and /). */
function folderName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Context-folder control rendered as a chip in the input footer, next to the
 * model picker (both share the `.chat-meta-chip` style). When a folder is set
 * it shows the folder name with a clear (×) and a worktree-panel toggle;
 * otherwise a single "add folder" chip.
 */
export const ContextFolderChip = memo(function ContextFolderChip({
  contextFolder,
  show,
  worktreeVisible,
  onPickFolder,
  onClearFolder,
  onToggleWorktree,
}: ContextFolderChipProps): React.JSX.Element | null {
  const { t } = useI18n();
  if (!show) return null;

  if (!contextFolder) {
    return (
      <button
        className="chat-meta-chip"
        onClick={onPickFolder}
        title={t("chat.setContextFolder")}
        type="button"
      >
        <FolderOpen size={13} />
        <span>{t("chat.contextFolderChip")}</span>
      </button>
    );
  }

  return (
    <div className="chat-ctxfolder-group">
      <button
        className="chat-meta-chip chat-meta-chip--active"
        onClick={onPickFolder}
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
    </div>
  );
});
