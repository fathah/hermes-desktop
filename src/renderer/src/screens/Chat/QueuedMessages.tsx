import { memo, useEffect, useState, useRef, useCallback } from "react";
import { CircleDashed, ChevronRight, ChevronDown, X, Pencil } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { Attachment } from "../../../../shared/attachments";

interface QueuedMessage {
  text: string;
  attachments: Attachment[];
}

interface QueuedMessagesProps {
  messages: QueuedMessage[];
  onRemove: (index: number) => void;
  onEdit: (index: number, newText: string) => void;
}

/**
 * Pending-send queue indicator shown above the input while the agent is busy.
 * Each queued message can be edited via a pencil button or cancelled via an X button.
 */
export const QueuedMessages = memo(function QueuedMessages({
  messages,
  onRemove,
  onEdit,
}: QueuedMessagesProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (messages.length === 0) setExpanded(false);
  }, [messages.length]);

  // Focus the edit input when entering edit mode
  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingIndex]);

  const startEdit = useCallback((index: number, text: string) => {
    setEditingIndex(index);
    setEditText(text);
  }, []);

  const commitEdit = useCallback((index: number) => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== messages[index].text) {
      onEdit(index, trimmed);
    }
    setEditingIndex(null);
    setEditText("");
  }, [editText, messages, onEdit]);

  const cancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditText("");
  }, []);

  if (messages.length === 0) return null;

  const preview = (m: QueuedMessage): string => {
    const text = m.text.trim();
    if (text) return text;
    return t("chat.queuedAttachment", { count: m.attachments.length });
  };

  const renderEditInput = (index: number) => (
    <input
      ref={editInputRef}
      type="text"
      className="chat-queue-edit-input"
      value={editText}
      onChange={(e) => setEditText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitEdit(index);
        if (e.key === "Escape") cancelEdit();
      }}
      onBlur={() => commitEdit(index)}
    />
  );

  if (messages.length === 1) {
    const isEditing = editingIndex === 0;
    return (
      <div className="chat-queue-indicator">
        <CircleDashed size={14} className="chat-queue-icon" />
        {isEditing ? (
          renderEditInput(0)
        ) : (
          <span className="chat-queue-single" title={preview(messages[0])}>
            {preview(messages[0])}
          </span>
        )}
        <button
          type="button"
          className="chat-queue-edit"
          onClick={() => startEdit(0, messages[0].text)}
          aria-label={t("chat.queuedEdit")}
          title={t("chat.queuedEdit")}
        >
          <Pencil size={12} />
        </button>
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
          {messages.map((m, i) => {
            const isEditing = editingIndex === i;
            return (
              <li
                key={`${i}-${m.text.length}-${m.attachments.length}`}
                className="chat-queue-item"
                title={isEditing ? undefined : preview(m)}
              >
                {isEditing ? (
                  renderEditInput(i)
                ) : (
                  <span className="chat-queue-item-text">{preview(m)}</span>
                )}
                <button
                  type="button"
                  className="chat-queue-edit"
                  onClick={() => startEdit(i, m.text)}
                  aria-label={t("chat.queuedEdit")}
                  title={t("chat.queuedEdit")}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="chat-queue-remove"
                  onClick={() => onRemove(i)}
                  aria-label={t("chat.queuedCancel")}
                >
                  <X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});