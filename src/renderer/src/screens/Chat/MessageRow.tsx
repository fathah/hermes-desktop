import { memo, useMemo, useState, useRef, useCallback, useEffect } from "react";
import { Pencil } from "lucide-react";
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

/**
 * Empty box the size of an avatar. Rendered in place of the avatar on
 * continuation rows of a turn (the thinking/tool rows and answer bubble that
 * follow the first row) so one turn shows a single avatar while every row
 * stays aligned to the same content column.
 */
export const AvatarSpacer = memo(function AvatarSpacer(): React.JSX.Element {
  return <div className="chat-avatar" aria-hidden="true" />;
});

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
  /** False on continuation rows of a turn — render a spacer instead of the
   *  avatar so the turn reads as one grouped block. Defaults to true. */
  showAvatar?: boolean;
  /** Called when the user edits their last message and presses Enter.
   *  The parent should update the message content and trigger a regenerate. */
  onEditMessage?: (msgId: string, newContent: string) => void;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  showAvatar = true,
  onEditMessage,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Only the last user message can be edited, and only when not loading
  const canEdit =
    onEditMessage &&
    msg.role === "user" &&
    isLast &&
    !isLoading &&
    !!bubbleContent;

  const startEdit = useCallback(() => {
    if (!bubbleContent) return;
    setEditText(bubbleContent);
    setEditing(true);
  }, [bubbleContent]);

  const commitEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== bubbleContent && onEditMessage) {
      onEditMessage(msg.id, trimmed);
    }
    setEditing(false);
    setEditText("");
  }, [editText, bubbleContent, msg.id, onEditMessage]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditText("");
  }, []);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      );
    }
  }, [editing]);

  // Auto-resize textarea height to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !editing) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [editText, editing]);

  // Only chat bubble messages have content/attachments
  if (!isChatBubbleMessage(msg)) {
    return (
      <div className={`chat-message chat-message-${msg.role}`}>
        {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
        <div className={`chat-bubble chat-bubble-${msg.role}`}>
          {/* Reasoning/tool messages handled separately */}
        </div>
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
        {editing ? (
          <textarea
            ref={textareaRef}
            className="chat-bubble-edit"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            rows={1}
          />
        ) : (
          <>
            {canEdit && (
              <div className="chat-bubble-actions">
                <button
                  type="button"
                  className="chat-bubble-edit-btn"
                  onClick={startEdit}
                  title={t("chat.editMessage")}
                  aria-label={t("chat.editMessage")}
                >
                  <Pencil size={14} />
                </button>
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
          </>
        )}
      </div>
      {showApprovalBar && (
        <div className="chat-approval-bar">
          <button
            className="chat-approval-btn chat-approve"
            onClick={onApprove}
          >
            {t("chat.approve")}
          </button>
          <button className="chat-approval-btn chat-deny" onClick={onDeny}>
            {t("chat.deny")}
          </button>
        </div>
      )}
    </div>
  );
});