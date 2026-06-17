import { memo, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Copy } from "lucide-react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { MediaSegmentView } from "../../components/MediaImage";
import { useI18n } from "../../components/useI18n";
import { parseMediaTokens, cleanLeakedToolTags } from "./mediaUtils";
import type { ChatBubbleMessage, ChatMessage } from "./types";

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

function isChatBubbleMessage(msg: ChatMessage): msg is ChatBubbleMessage {
  return (
    msg.kind === "user" ||
    msg.kind === "assistant" ||
    (!msg.kind && (msg.role === "user" || msg.role === "agent"))
  );
}

export const HermesAvatar = memo(function HermesAvatar({
  size = 30,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <img src={icon} width={size} height={size} alt="" />
    </div>
  );
});

export const AvatarSpacer = memo(function AvatarSpacer(): React.JSX.Element {
  return <div className="chat-avatar" aria-hidden="true" />;
});

interface ContextMenuState {
  x: number;
  y: number;
}

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
  showAvatar?: boolean;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  showAvatar = true,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const bubbleContent = isChatBubbleMessage(msg)
    ? (msg as ChatBubbleMessage).content
    : null;

  const segments = useMemo(
    () =>
      msg.role === "agent" && bubbleContent
        ? parseMediaTokens(cleanLeakedToolTags(bubbleContent))
        : null,
    [msg.role, bubbleContent],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleCopy = useCallback(async () => {
    if (!bubbleContent) return;
    try {
      await window.hermesAPI.copyToClipboard(bubbleContent);
    } catch {
      // ignore clipboard errors
    }
    closeContextMenu();
  }, [bubbleContent, closeContextMenu]);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    function onClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") closeContextMenu();
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu, closeContextMenu]);

  if (!isChatBubbleMessage(msg)) {
    return (
      <div className={`chat-message chat-message-${msg.role}`}>
        {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
        <div className={`chat-bubble chat-bubble-${msg.role}`} />
      </div>
    );
  }

  const showApprovalBar =
    msg.role === "agent" &&
    !msg.error &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;

  return (
    <div
      className={`chat-message chat-message-${msg.role}${
        showAvatar ? "" : " chat-message--grouped"
      }`}
      onContextMenu={handleContextMenu}
    >
      {!showAvatar ? (
        <AvatarSpacer />
      ) : msg.role === "user" ? (
        <div className="chat-avatar chat-avatar-user">U</div>
      ) : (
        <HermesAvatar />
      )}
      <div
        className={`chat-bubble chat-bubble-${msg.role}${
          msg.error ? " chat-bubble-error" : ""
        }`}
      >
        {hasAttachments && (
          <div className="chat-message-attachments">
            {msg.attachments!.map((att) => (
              <AttachmentChip key={att.id} attachment={att} />
            ))}
          </div>
        )}
        {msg.content &&
          (msg.role === "agent" && segments
            ? segments.map((segment) =>
                segment.type === "text" ? (
                  segment.value.trim() ? (
                    <AgentMarkdown key={`t-${segment.start}`}>
                      {segment.value}
                    </AgentMarkdown>
                  ) : null
                ) : (
                  <MediaSegmentView
                    key={`m-${segment.start}`}
                    token={segment.token}
                    raw={segment.raw}
                    source={segment.source}
                  />
                ),
              )
            : msg.content)}
        {msg.error && (
          <div className="chat-error-message" role="alert">
            {msg.error}
          </div>
        )}
      </div>
      {showApprovalBar && (
        <div className="chat-approval-bar">
          <button className="chat-approval-btn chat-approve" onClick={onApprove}>
            {t("chat.approve")}
          </button>
          <button className="chat-approval-btn chat-deny" onClick={onDeny}>
            {t("chat.deny")}
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="chat-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="chat-context-menu-item"
            onClick={handleCopy}
          >
            <Copy size={14} />
            <span>{t("chat.copyMessage")}</span>
          </button>
        </div>
      )}
    </div>
  );
});