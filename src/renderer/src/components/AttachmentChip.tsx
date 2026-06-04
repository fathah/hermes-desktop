import { FileText, X } from "lucide-react";
import type { Attachment } from "../../../shared/attachments";

interface AttachmentChipProps {
  attachment: Attachment;
  // When provided, renders a remove button.  Used in the composer strip.
  onRemove?: () => void;
  // When provided, the image is clickable to preview at full size.
  onPreview?: (att: Attachment) => void;
}

export function AttachmentChip({
  attachment,
  onRemove,
  onPreview,
}: AttachmentChipProps): React.JSX.Element {
  const isImage = attachment.kind === "image";

  // When the renderer compressed the image down to fit the gateway's
  // request-body cap (#405), surface the size delta in the tooltip so the
  // user knows quality changed and isn't surprised by a "compressed"
  // version appearing in the chat transcript.
  const tooltip =
    attachment.originalSize && attachment.originalSize > attachment.size
      ? `${attachment.name} (${formatSize(attachment.originalSize)} → ${formatSize(attachment.size)}, compressed)`
      : `${attachment.name} (${formatSize(attachment.size)})`;

  return (
    <div
      className={`attachment-chip attachment-chip-${attachment.kind}`}
      title={tooltip}
    >
      {isImage && attachment.dataUrl ? (
        <button
          type="button"
          className="attachment-chip-thumb"
          onClick={() => onPreview?.(attachment)}
          aria-label={attachment.name}
        >
          <img src={attachment.dataUrl} alt={attachment.name} />
        </button>
      ) : (
        <div className="attachment-chip-file">
          <FileText size={14} />
          <span className="attachment-chip-name">{attachment.name}</span>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          className="attachment-chip-remove"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
