import { memo } from "react";
import {
  X,
  FileText,
  FileImage,
  FileCode,
  File,
  AlertCircle,
} from "lucide-react";
import type { Attachment } from "../types/attachment";

interface ChatFilesDisplayProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

function getFileIcon(type: string): React.JSX.Element {
  if (type.startsWith("image/")) {
    return <FileImage size={14} />;
  }
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/javascript"
  ) {
    return <FileCode size={14} />;
  }
  if (type === "application/pdf" || type.startsWith("application/")) {
    return <FileText size={14} />;
  }
  return <File size={14} />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ChatFilesDisplay = memo(function ChatFilesDisplay({
  attachments,
  onRemove,
}: ChatFilesDisplayProps): React.JSX.Element | null {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="chat-files-display">
      {attachments.map((att) => (
        <div
          key={att.id}
          className={`chat-file-item ${att.isSupported ? "" : "chat-file-unsupported"}`}
        >
          {att.type.startsWith("image/") && att.preview ? (
            <img
              src={att.preview}
              alt={att.name}
              className="chat-file-preview"
            />
          ) : (
            <span className="chat-file-icon">{getFileIcon(att.type)}</span>
          )}

          <span className="chat-file-info">
            <span className="chat-file-name" title={att.name}>
              {att.name}
            </span>
            <span className="chat-file-size">{formatFileSize(att.size)}</span>
          </span>

          {att.isLarge && (
            <span className="chat-file-warning" title="File maggiore di 10MB">
              <AlertCircle size={12} />
            </span>
          )}

          {!att.isSupported && (
            <span
              className="chat-file-warning"
              title="File non supportato. Usa /read_file per file locali"
            >
              <AlertCircle size={12} />
            </span>
          )}

          <button
            type="button"
            className="chat-file-remove"
            onClick={() => onRemove(att.id)}
            title="Rimuovi allegato"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
});

export { ChatFilesDisplay };
export default ChatFilesDisplay;
