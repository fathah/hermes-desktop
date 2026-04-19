import {
  useRef,
  useCallback,
  KeyboardEvent,
  ChangeEvent,
  ForwardedRef,
  forwardRef,
} from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Paperclip, Send, Square as Stop } from "lucide-react";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { ChatFilesDisplay } from "./ChatFilesDisplay";
import { useFileHandler } from "../hooks/useFileHandler";

interface MarkdownInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  isLoading: boolean;
  disabled?: boolean;
  placeholder?: string;
  showBtw?: boolean;
  onQuickAsk?: () => void;
}

const MarkdownInput = forwardRef(function MarkdownInput(
  {
    value,
    onChange,
    onKeyDown,
    onSend,
    onStop,
    isLoading,
    disabled,
    placeholder,
    showBtw,
    onQuickAsk,
  }: MarkdownInputProps,
  ref: ForwardedRef<HTMLTextAreaElement>,
): React.JSX.Element {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef =
    (ref as React.RefObject<HTMLTextAreaElement>) || internalRef;

  const {
    attachments,
    removeAttachment,
    clearAttachments,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleFileSelect,
    isDragging,
    inputRef,
    openFileDialog,
  } = useFileHandler();

  const insertMarkdown = useCallback(
    (before: string, after: string, placeholder: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = value.substring(start, end);
      const textToInsert = selectedText || placeholder;

      const newValue =
        value.substring(0, start) +
        before +
        textToInsert +
        after +
        value.substring(end);

      onChange(newValue);

      requestAnimationFrame(() => {
        textarea.focus();
        if (selectedText) {
          const newCursorPos =
            start + before.length + textToInsert.length + after.length;
          textarea.setSelectionRange(newCursorPos, newCursorPos);
        } else {
          const newCursorPos = start + before.length + placeholder.length;
          textarea.setSelectionRange(newCursorPos, newCursorPos);
        }
      });
    },
    [value, onChange],
  );

  const handleToolbarKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (isCtrlOrCmd) {
        switch (e.key.toLowerCase()) {
          case "b":
            e.preventDefault();
            insertMarkdown("**", "**", "bold text");
            break;
          case "i":
            e.preventDefault();
            insertMarkdown("_", "_", "italic text");
            break;
          case "k":
            e.preventDefault();
            insertMarkdown("[", "](url)", "link text");
            break;
          case "e":
            e.preventDefault();
            insertMarkdown("`", "`", "code");
            break;
        }
      }
      onKeyDown(e);
    },
    [insertMarkdown, onKeyDown],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      handleToolbarKeyDown(e);
    },
    [handleToolbarKeyDown],
  );

  const handleDropWrapper = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      handleDrop(e as unknown as DragEvent<HTMLTextAreaElement>);
    },
    [handleDrop],
  );

  const handleDragOverWrapper = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      handleDragOver(e as unknown as DragEvent<HTMLTextAreaElement>);
    },
    [handleDragOver],
  );

  const handleDragLeaveWrapper = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      handleDragLeave(e as unknown as DragEvent<HTMLTextAreaElement>);
    },
    [handleDragLeave],
  );

  const handlePasteWrapper = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      handlePaste(e);
    },
    [handlePaste],
  );

  const canSend = value.trim().length > 0 || attachments.length > 0;

  const handleSendClick = useCallback(() => {
    onSend();
    clearAttachments();
  }, [onSend, clearAttachments]);

  return (
    <div className="chat-input-container">
      <MarkdownToolbar onInsert={insertMarkdown} />

      <ChatFilesDisplay attachments={attachments} onRemove={removeAttachment} />

      <div
        className={`chat-input-wrapper ${isDragging ? "chat-input-wrapper-drag-over" : ""}`}
        onDrop={handleDropWrapper}
        onDragOver={handleDragOverWrapper}
        onDragLeave={handleDragLeaveWrapper}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="chat-file-input"
          onChange={handleFileSelect}
          accept="image/*,text/*,application/json,application/javascript,application/xml"
        />

        <button
          type="button"
          className="chat-attach-btn"
          onClick={openFileDialog}
          title="Allega file"
          disabled={disabled}
        >
          <Paperclip size={16} />
        </button>

        <TextareaAutosize
          ref={textareaRef}
          className="chat-input"
          placeholder={
            placeholder || "Type a message... (Shift+Enter for new line)"
          }
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePasteWrapper}
          rows={1}
          disabled={disabled}
          autoFocus
          maxRows={5}
        />

        {isLoading ? (
          <button
            className="chat-send-btn chat-stop-btn"
            onClick={onStop}
            title="Stop"
          >
            <Stop size={14} />
          </button>
        ) : (
          <>
            {showBtw && (
              <button
                className="chat-btw-btn"
                onClick={onQuickAsk}
                title="Quick Ask (/btw) — side question that won't affect conversation context"
              >
                💭
              </button>
            )}
            <button
              className="chat-send-btn"
              onClick={handleSendClick}
              disabled={!canSend}
              title="Send"
            >
              <Send size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
});

export { MarkdownInput };
export default MarkdownInput;
