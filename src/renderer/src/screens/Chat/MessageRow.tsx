import { memo, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { FileText, X, Pencil, GitBranch, Copy, Check as CheckIcon } from "lucide-react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { MediaSegmentView } from "../../components/MediaImage";
import { useI18n } from "../../components/useI18n";
import { parseMediaTokens } from "./mediaUtils";
import type { Attachment, ChatBubbleMessage, ChatMessage } from "./types";

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

/** Lightbox overlay for full-size image view */
function ImageLightbox({
  att,
  onClose,
}: {
  att: Attachment;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>
          <X size={18} />
        </button>
        <img src={att.dataUrl} alt={att.name} className="lightbox-img" />
        <div className="lightbox-name">{att.name}</div>
      </div>
    </div>
  );
}

/** Attachment pills shown inside a user message bubble */
function AttachmentList({
  attachments,
}: {
  attachments: Attachment[];
}): React.JSX.Element {
  const [lightboxAtt, setLightboxAtt] = useState<Attachment | null>(null);
  return (
    <>
      <div className="msg-attachments">
        {attachments.map((att) =>
          att.isImage ? (
            <img
              key={att.id}
              src={att.dataUrl}
              alt={att.name}
              className="msg-attachment-img"
              title={att.name}
              onClick={() => setLightboxAtt(att)}
            />
          ) : (
            <div key={att.id} className="msg-attachment-file">
              <FileText size={13} />
              <span>{att.name}</span>
            </div>
          ),
        )}
      </div>
      {lightboxAtt && (
        <ImageLightbox att={lightboxAtt} onClose={() => setLightboxAtt(null)} />
      )}
    </>
  );
}

/** Small copy-to-clipboard button with a 1.5s checkmark confirmation */
function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard not available — silent fail
      }
    },
    [text],
  );

  return (
    <button
      className={`msg-copy-btn ${copied ? "msg-copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <CheckIcon size={13} /> : <Copy size={13} />}
    </button>
  );
}

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
  /** Called with the (possibly edited) text to fork the conversation from this message */
  onFork?: (editedText: string) => void;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  onFork,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(
    null,
  );

  // Only chat bubble messages have content/attachments
  if (!isChatBubbleMessage(msg)) {
    return (
      <div className={`chat-message chat-message-${msg.role}`}>
        <HermesAvatar />
        <div className={`chat-bubble chat-bubble-${msg.role}`}>
          {/* Reasoning/tool messages handled separately */}
        </div>
      </div>
    );
  }

  const showApprovalBar =
    msg.role === "agent" &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;

  // MessageRow is wrapped in memo() but still re-renders on any prop change
  // (e.g. isLoading toggling at the end of a stream), and `parseMediaTokens`
  // runs a full regex pipeline. Cache the result against the message content
  // so a long conversation doesn't reparse every row on every render.
  // Only agent bubbles need media parsing — user bubbles render content
  // verbatim — so this is gated on the role to skip the work entirely for
  // user rows. (Follow-up item from PR #303 review.)
  const segments = useMemo(
    () =>
      msg.role === "agent" && msg.content
        ? parseMediaTokens(msg.content)
        : null,
    [msg.role, msg.content],
  );

  // Auto-focus + resize textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [isEditing]);

  function startEdit(): void {
    setEditText(msg.content);
    setIsEditing(true);
  }

  function cancelEdit(): void {
    setIsEditing(false);
  }

  function submitFork(): void {
    if (!editText.trim()) return;
    setIsEditing(false);
    onFork?.(editText);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitFork();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setEditText(e.target.value);
    // Auto-grow
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  const canFork = !!onFork && !isLoading && msg.role === "user";

  return (
    <div className={`chat-message chat-message-${msg.role}`}>
      {msg.role === "user" ? (
        <div className="chat-avatar chat-avatar-user">U</div>
      ) : (
        <HermesAvatar />
      )}

      <div className={`chat-bubble chat-bubble-${msg.role}`}>
        {isEditing ? (
          /* ── Edit / fork mode ── */
          <div className="msg-edit-wrap">
            <textarea
              ref={textareaRef}
              className="msg-edit-textarea"
              value={editText}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              rows={3}
            />
            <div className="msg-edit-actions">
              <button
                className="msg-edit-btn msg-edit-fork"
                onClick={submitFork}
                disabled={!editText.trim()}
                title="Fork & send (⌘↵)"
              >
                <GitBranch size={13} />
                Fork &amp; Send
              </button>
              <button
                className="msg-edit-btn msg-edit-cancel"
                onClick={cancelEdit}
                title="Cancel (Esc)"
              >
                <X size={13} />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
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
              (msg.role === "agent" && segments
                ? segments.map((segment) =>
                    segment.type === "text" ? (
                      segment.value.trim() ? (
                        // Keyed on the segment's character offset rather than its
                        // array index — a MEDIA: token appearing mid-stream shifts
                        // every subsequent index, which would otherwise re-mount
                        // each downstream MediaSegmentView and re-fire its
                        // `mediaFileExists` probe.
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
          </>
        )}
      </div>

      {/* Copy button — agent messages */}
      {msg.role === "agent" && !isLoading && msg.content && (
        <div className="msg-agent-controls">
          <CopyButton text={msg.content} />
        </div>
      )}

      {/* Fork + copy controls — user messages, hidden when loading or editing */}
      {canFork && !isEditing && (
        <div className="msg-fork-controls">
          <CopyButton text={msg.content} />
          <button
            className="msg-fork-btn"
            onClick={startEdit}
            title="Edit & fork from here"
          >
            <Pencil size={13} />
          </button>
          <button
            className="msg-fork-btn"
            onClick={() => onFork(msg.content)}
            title="Fork from here (keep prompt)"
          >
            <GitBranch size={13} />
          </button>
        </div>
      )}
      {/* Copy only — user messages when fork not available */}
      {msg.role === "user" && !canFork && !isEditing && msg.content && (
        <div className="msg-fork-controls">
          <CopyButton text={msg.content} />
        </div>
      )}

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
