import { memo, useState } from "react";
import {
  Trash2 as Trash,
  Plus,
  Zap,
  FolderOpen,
  X,
  FolderTree,
  PanelRight,
  Minimize2,
  History,
  BookOpen,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ChatHeaderMenu, type OverflowItem } from "./ChatHeaderMenu";
import type { UsageState } from "./types";
import { contextGaugeInfo } from "./contextGauge";
import {
  getGroundInWorkspace,
  setGroundInWorkspace,
} from "../../lib/grounding";

interface ChatHeaderProps {
  sessionId: string | null;
  /** Human session title; shown instead of the id suffix when present. */
  sessionTitle?: string | null;
  usage: UsageState | null;
  fastMode: boolean;
  hasMessages: boolean;
  /** Working folder bound to this conversation (issue #27), or null. */
  contextFolder: string | null;
  /** Whether to show the context-folder control (hidden in remote/SSH mode,
   *  where the picker would browse the wrong machine's filesystem). */
  showContextFolder: boolean;
  /** Whether the worktree panel is visible (when contextFolder is set). */
  worktreeVisible: boolean;
  /** Developer mode — gates the niche power-user controls (worktree, checkpoints). */
  devMode: boolean;
  /** Whether there is previewable visual output to show (WS2). */
  previewAvailable: boolean;
  /** Whether the preview pane is currently shown. */
  previewVisible: boolean;
  onPickFolder: () => void;
  onClearFolder: () => void;
  onToggleFast: () => void;
  onToggleWorktree: () => void;
  onTogglePreview: () => void;
  onNewChat?: () => void;
  onClear: () => void;
  /** Current model id — drives the context-fill gauge (idea A3). */
  model?: string;
  /** Send a `/compress` turn to compact the conversation context (idea A3). */
  onCompress?: () => void;
  /** List filesystem checkpoints via `/rollback` (idea B2). */
  onCheckpoints?: () => void;
}

/** Context-fill gauge: how much of the model's window the last prompt used. */
function ContextGauge({
  promptTokens,
  model,
}: {
  promptTokens: number;
  model?: string;
}): React.JSX.Element | null {
  if (!promptTokens || promptTokens <= 0) return null;
  const info = contextGaugeInfo(promptTokens, model);
  return (
    <span
      className={`chat-context-gauge chat-context-gauge--${info.level}`}
      title={`Context: ${promptTokens.toLocaleString()} prompt tokens (${info.label})`}
    >
      <span className="chat-context-gauge-track">
        <span
          className="chat-context-gauge-fill"
          style={{ width: `${info.percent}%` }}
        />
      </span>
      <span className="chat-context-gauge-label">{info.label}</span>
    </span>
  );
}

function UsageBadge({ usage }: { usage: UsageState }): React.JSX.Element {
  const tooltip =
    `Prompt: ${usage.promptTokens.toLocaleString()} | ` +
    `Completion: ${usage.completionTokens.toLocaleString()}` +
    (usage.cost != null ? ` | Cost: $${usage.cost.toFixed(4)}` : "");

  return (
    <span className="chat-token-counter" title={tooltip}>
      {usage.totalTokens.toLocaleString()} tokens
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
  sessionTitle,
  usage,
  fastMode,
  hasMessages,
  contextFolder,
  showContextFolder,
  worktreeVisible,
  devMode,
  previewAvailable,
  previewVisible,
  onPickFolder,
  onClearFolder,
  onToggleFast,
  onToggleWorktree,
  onTogglePreview,
  onNewChat,
  onClear,
  model,
  onCompress,
  onCheckpoints,
}: ChatHeaderProps): React.JSX.Element {
  const { t } = useI18n();
  // KB Phase 1: self-managed grounding toggle. The send path reads this from
  // localStorage at send time, so no prop threading is needed.
  const [grounded, setGrounded] = useState(getGroundInWorkspace());
  const [confirmClear, setConfirmClear] = useState(false);
  const toggleGrounding = (): void => {
    const next = !grounded;
    setGrounded(next);
    setGroundInWorkspace(next);
  };

  // Tier 3: the "⋯" overflow — secondary/rare actions. Developer-only items
  // (worktree, checkpoints) appear only in dev mode (onCheckpoints is already
  // undefined when dev mode is off; worktree is gated explicitly here).
  const overflowItems: OverflowItem[] = [
    {
      key: "fast",
      label: fastMode ? t("chat.fastModeOn") : t("chat.fastMode"),
      icon: <Zap size={15} />,
      onClick: onToggleFast,
      active: fastMode,
    },
  ];
  if (previewAvailable)
    overflowItems.push({
      key: "preview",
      label: previewVisible ? t("chat.hidePreview") : t("chat.showPreview"),
      icon: <PanelRight size={15} />,
      onClick: onTogglePreview,
      active: previewVisible,
    });
  if (onCompress && hasMessages)
    overflowItems.push({
      key: "compress",
      label: "Compress context",
      icon: <Minimize2 size={15} />,
      onClick: onCompress,
    });
  if (devMode && contextFolder)
    overflowItems.push({
      key: "worktree",
      label: worktreeVisible ? t("chat.hideWorktree") : t("chat.showWorktree"),
      icon: <FolderTree size={15} />,
      onClick: onToggleWorktree,
      active: worktreeVisible,
    });
  if (onCheckpoints && hasMessages)
    overflowItems.push({
      key: "checkpoints",
      label: "Checkpoints (/rollback)",
      icon: <History size={15} />,
      onClick: onCheckpoints,
    });
  if (hasMessages)
    overflowItems.push({
      key: "clear",
      label: t("chat.clearChat"),
      icon: <Trash size={15} />,
      onClick: () => setConfirmClear(true),
      danger: true,
    });

  return (
    <div className="chat-header">
      <div className="chat-header-left">
        <div className="chat-header-title">
          {sessionTitle
            ? sessionTitle
            : sessionId
              ? t("chat.sessionTitle", { id: sessionId.slice(-6) })
              : t("chat.title")}
        </div>
        {usage && <UsageBadge usage={usage} />}
        {usage && (
          <ContextGauge promptTokens={usage.promptTokens} model={model} />
        )}
      </div>
      <div className="chat-header-actions">
        {/* Tier 2 — context row: context folder + grounding (always visible). */}
        {showContextFolder &&
          (contextFolder ? (
            <div className="chat-ctxfolder">
              <button
                className="btn-ghost chat-ctxfolder-btn chat-ctxfolder-set"
                onClick={onPickFolder}
                title={t("chat.contextFolderActive", { path: contextFolder })}
                aria-label={t("chat.contextFolderActive", {
                  path: contextFolder,
                })}
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
                aria-label={t("chat.removeContextFolder")}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              className="btn-ghost chat-ctxfolder-btn"
              onClick={onPickFolder}
              title={t("chat.setContextFolder")}
              aria-label={t("chat.setContextFolder")}
            >
              <FolderOpen size={14} />
            </button>
          ))}
        <button
          className={`btn-ghost chat-grounding-toggle ${grounded ? "chat-worktree-active" : ""}`}
          onClick={toggleGrounding}
          title={grounded ? t("chat.groundingOn") : t("chat.groundingOff")}
          aria-label={grounded ? t("chat.groundingOn") : t("chat.groundingOff")}
        >
          <BookOpen size={14} />
        </button>
        {/* Tier 1 — primary: new chat (always visible). */}
        {onNewChat && (
          <button
            className="btn-ghost chat-clear-btn"
            onClick={onNewChat}
            title={t("chat.newChat")}
            aria-label={t("chat.newChat")}
          >
            <Plus size={16} />
          </button>
        )}
        {/* Tier 3 — overflow: fast mode, preview, compress, clear (+ dev items). */}
        <ChatHeaderMenu items={overflowItems} />
      </div>
      <ConfirmDialog
        open={confirmClear}
        title={t("chat.clearChat")}
        body={t("chat.clearChatConfirm")}
        confirmLabel={t("chat.clearChat")}
        danger
        onConfirm={() => {
          setConfirmClear(false);
          onClear();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
});
