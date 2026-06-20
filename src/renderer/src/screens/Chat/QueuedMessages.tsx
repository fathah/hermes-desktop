import { memo, useEffect, useState } from "react";
import {
  CircleDashed,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  X,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { QueuedMessage } from "./types";

interface QueuedMessagesProps {
  messages: QueuedMessage[];
  onRemove: (id: string) => void;
  paused?: boolean;
  onRetry?: () => void;
}

interface QueuedPromptRowProps {
  message: QueuedMessage;
  onRemove: (id: string) => void;
}

/** Visual-only marker anchored in the transcript at submission time. */
export const QueuedPromptRow = memo(function QueuedPromptRow({
  message,
  onRemove,
}: QueuedPromptRowProps): React.JSX.Element {
  const { t } = useI18n();
  const text = message.text.trim();
  const preview =
    text || t("chat.queuedAttachment", { count: message.attachments.length });

  return (
    <div className="chat-queued-prompt-row" data-queued-message-id={message.id}>
      <div className="chat-queued-prompt-note">
        <div className="chat-queued-prompt-label">
          <CircleDashed size={13} className="chat-queue-icon" />
          <span>{t("chat.queuedSubmittedHere")}</span>
        </div>
        <div className="chat-queued-prompt-text">{preview}</div>
        <button
          type="button"
          className="chat-queue-remove"
          onClick={() => onRemove(message.id)}
          aria-label={t("chat.queuedCancel")}
          title={t("chat.queuedCancel")}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
});

/**
 * Pending-send queue indicator shown above the input while the agent is busy.
 * Each queued message can be individually cancelled via an X button.
 */
export const QueuedMessages = memo(function QueuedMessages({
  messages,
  onRemove,
  paused = false,
  onRetry,
}: QueuedMessagesProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (messages.length === 0) setExpanded(false);
  }, [messages.length]);

  if (messages.length === 0) return null;

  const preview = (m: QueuedMessage): string => {
    const text = m.text.trim();
    if (text) return text;
    return t("chat.queuedAttachment", { count: m.attachments.length });
  };

  if (messages.length === 1) {
    return (
      <div className="chat-queue-indicator">
        <CircleDashed size={14} className="chat-queue-icon" />
        <span className="chat-queue-single" title={preview(messages[0])}>
          {preview(messages[0])}
        </span>
        <button
          type="button"
          className="chat-queue-remove"
          onClick={() => onRemove(messages[0].id)}
          aria-label={t("chat.queuedCancel")}
          title={t("chat.queuedCancel")}
        >
          <X size={12} />
        </button>
        {paused && onRetry && (
          <button
            type="button"
            className="chat-queue-retry"
            onClick={onRetry}
            title={t("chat.queuedRetry")}
          >
            <RotateCcw size={12} />
            <span>{t("chat.queuedRetry")}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="chat-queue-indicator chat-queue-collapsible">
      <button
        type="button"
        className="chat-queue-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <CircleDashed size={14} className="chat-queue-icon" />
        <span>{t("chat.queuedCount", { count: messages.length })}</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <ul className="chat-queue-list">
          {messages.map((m) => (
            <li key={m.id} className="chat-queue-item" title={preview(m)}>
              <span className="chat-queue-item-text">{preview(m)}</span>
              <button
                type="button"
                className="chat-queue-remove"
                onClick={() => onRemove(m.id)}
                aria-label={t("chat.queuedCancel")}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {paused && onRetry && (
        <button
          type="button"
          className="chat-queue-retry"
          onClick={onRetry}
          title={t("chat.queuedRetry")}
        >
          <RotateCcw size={12} />
          <span>{t("chat.queuedSendFailed")}</span>
        </button>
      )}
    </div>
  );
});
