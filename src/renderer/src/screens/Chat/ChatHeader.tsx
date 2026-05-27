import { memo } from "react";
import { Trash2 as Trash, Plus, Zap, FolderOpen, X } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { UsageState } from "./types";

interface ChatHeaderProps {
  sessionId: string | null;
  usage: UsageState | null;
  fastMode: boolean;
  hasMessages: boolean;
  /** Working folder bound to this conversation (issue #27), or null. */
  contextFolder: string | null;
  /** Whether to show the context-folder control (hidden in remote/SSH mode,
   *  where the picker would browse the wrong machine's filesystem). */
  showContextFolder: boolean;
  onPickFolder: () => void;
  onClearFolder: () => void;
  onToggleFast: () => void;
  onNewChat?: () => void;
  onClear: () => void;
}

function UsageBadge({ usage }: { usage: UsageState }): React.JSX.Element {
  const { t } = useI18n();
  const tooltip =
    `${t("chat.usagePrompt")}: ${usage.promptTokens.toLocaleString()} | ` +
    `${t("chat.usageCompletion")}: ${usage.completionTokens.toLocaleString()}` +
    (usage.cost != null
      ? ` | ${t("chat.usageCost")}: $${usage.cost.toFixed(4)}`
      : "");

  return (
    <span className="chat-token-counter" title={tooltip}>
      {usage.totalTokens.toLocaleString()} {t("chat.tokensUnit")}
      {usage.cost != null && (
        <span className="chat-cost"> · ${usage.cost.toFixed(4)}</span>
      )}
    </span>
  );
}

/** Last path segment, for the compact chip label (handles \ and /). */
function folderName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export const ChatHeader = memo(function ChatHeader({
  sessionId,
  usage,
  fastMode,
  hasMessages,
  contextFolder,
  showContextFolder,
  onPickFolder,
  onClearFolder,
  onToggleFast,
  onNewChat,
  onClear,
}: ChatHeaderProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="chat-header">
      <div className="chat-header-left">
        <div className="chat-header-title">
          {sessionId
            ? t("chat.sessionTitle", { id: sessionId.slice(-6) })
            : t("chat.title")}
        </div>
        {usage && <UsageBadge usage={usage} />}
      </div>
      <div className="chat-header-actions">
        {showContextFolder &&
          (contextFolder ? (
            <div className="chat-ctxfolder">
              <button
                className="btn-ghost chat-ctxfolder-btn chat-ctxfolder-set"
                onClick={onPickFolder}
                title={t("chat.contextFolderActive", { path: contextFolder })}
              >
                <FolderOpen size={14} />
                <span className="chat-ctxfolder-name">
                  {folderName(contextFolder)}
                </span>
              </button>
              <button
                className="btn-ghost chat-ctxfolder-clear"
                onClick={onClearFolder}
                title={t("chat.removeContextFolder")}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              className="btn-ghost chat-ctxfolder-btn"
              onClick={onPickFolder}
              title={t("chat.setContextFolder")}
            >
              <FolderOpen size={14} />
            </button>
          ))}
        <div className="chat-fast-wrapper">
          <button
            className={`btn-ghost chat-fast-btn ${fastMode ? "chat-fast-active" : ""}`}
            onClick={onToggleFast}
          >
            <Zap size={14} />
          </button>
          <div className="chat-fast-popover">
            <strong>
              {fastMode ? t("chat.fastModeOn") : t("chat.fastMode")}
            </strong>
            <span>
              {fastMode ? t("chat.fastModeActive") : t("chat.fastModeInactive")}
            </span>
          </div>
        </div>
        {onNewChat && (
          <button
            className="btn-ghost chat-clear-btn"
            onClick={onNewChat}
            title={t("chat.newChat")}
          >
            <Plus size={16} />
          </button>
        )}
        {hasMessages && (
          <button
            className="btn-ghost chat-clear-btn"
            onClick={() => {
              if (window.confirm(t("chat.clearChatConfirm"))) onClear();
            }}
            title={t("chat.clearChat")}
          >
            <Trash size={16} />
          </button>
        )}
      </div>
    </div>
  );
});
