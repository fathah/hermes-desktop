import { memo, useState } from "react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { useI18n } from "../../components/useI18n";
import type { Attachment, ChatBubbleMessage } from "./types";

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

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

interface MessageRowProps {
  // MessageRow renders the visible chat-bubble UI; non-bubble variants
  // (reasoning, tool_call, tool_result) have their own dedicated rows in
  // MessageList and never reach here. Narrowing the prop type makes that
  // contract explicit so `.content` / `.attachments` are safe to read.
  msg: ChatBubbleMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(
    null,
  );
  const showApprovalBar =
    msg.role === "agent" &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;

  return (
    <div className={`chat-message chat-message-${msg.role}`}>
      {msg.role === "user" ? (
        <div className="chat-avatar chat-avatar-user">U</div>
      ) : (
        <HermesAvatar />
      )}
      <div className={`chat-bubble chat-bubble-${msg.role}`}>
        {hasAttachments && (
          <div className="chat-message-attachments">
            {msg.attachments!.map((att) => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onPreview={(a) => a.kind === "image" && setPreviewAttachment(a)}
              />
            ))}
          </div>
        )}
        {msg.content &&
          (msg.role === "agent" ? (
            <AgentMarkdown>{msg.content}</AgentMarkdown>
          ) : (
            msg.content
          ))}
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
      {previewAttachment && previewAttachment.dataUrl && (
        <div
          className="chat-image-preview-backdrop"
          onClick={() => setPreviewAttachment(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={previewAttachment.dataUrl}
            alt={previewAttachment.name}
            className="chat-image-preview-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
});
