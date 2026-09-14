import { memo, useEffect, useState } from "react";
import { CircleDashed, ChevronRight, ChevronDown, X } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { Attachment } from "../../../../shared/attachments";

interface QueuedMessage {
  text: string;
  attachments: Attachment[];
}

interface QueuedMessagesProps {
  messages: QueuedMessage[];
  onRemove: (index: number) => void;
}

/**
 * Pending-send queue indicator shown above the input while the agent is busy.
 * Each queued message can be individually cancelled via an X button.
 */
export const QueuedMessages = memo(function QueuedMessages({
  messages,
  onRemove,
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
          onClick={() => onRemove(0)}
          aria-label={t("chat.queuedCancel")}
          title={t("chat.queuedCancel")}
        >
          <X size={12} />
        </button>
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
          {messages.map((m, i) => (
            <li
              key={`${i}-${m.text.length}-${m.attachments.length}`}
              className="chat-queue-item"
              title={preview(m)}
            >
              <span className="chat-queue-item-text">{preview(m)}</span>
              <button
                type="button"
                className="chat-queue-remove"
                onClick={() => onRemove(i)}
                aria-label={t("chat.queuedCancel")}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
