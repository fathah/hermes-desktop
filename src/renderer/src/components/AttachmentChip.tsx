import { Download, FileText, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment } from "../../../shared/attachments";
import { useLightboxClose } from "../hooks/useLightboxClose";
import { useI18n } from "./useI18n";

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
  const { t } = useI18n();
  const [zoomed, setZoomed] = useState(false);
  useLightboxClose(zoomed, () => setZoomed(false));
  const isImage = attachment.kind === "image";
  const showImageMenu = (event: React.MouseEvent): void => {
    if (!isImage || !attachment.dataUrl) return;
    event.preventDefault();
    window.hermesAPI.showMediaMenu(attachment.dataUrl, attachment.name, {
      open: t("chat.media.open"),
      saveAs: t("chat.media.saveAs"),
    });
  };
  const previewImage = (): void => {
    if (!isImage || !attachment.dataUrl) return;
    onPreview?.(attachment);
    setZoomed(true);
  };

  // When the renderer compressed the image down to fit the gateway's
  // request-body cap (#405), surface the size delta in the tooltip so the
  // user knows quality changed and isn't surprised by a "compressed"
  // version appearing in the chat transcript.
  const tooltip =
    attachment.originalSize && attachment.originalSize > attachment.size
      ? `${attachment.name} (${formatSize(attachment.originalSize)} -> ${formatSize(attachment.size)}, compressed)`
      : `${attachment.name} (${formatSize(attachment.size)})`;

  return (
    <>
      <div
        className={`attachment-chip attachment-chip-${attachment.kind}`}
        title={tooltip}
      >
        {isImage && attachment.dataUrl ? (
          <button
            type="button"
            className="attachment-chip-thumb"
            onClick={previewImage}
            onContextMenu={showImageMenu}
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
      {/* Portal to <body> — same containment escape as MediaImage: chat
          rows' `content-visibility: auto` traps an inline fixed backdrop. */}
      {zoomed &&
        isImage &&
        attachment.dataUrl &&
        createPortal(
          <div
            className="chat-image-preview-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setZoomed(false)}
          >
            <img
              className="chat-image-preview-image"
              src={attachment.dataUrl}
              alt={attachment.name}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={showImageMenu}
            />
            <div
              className="chat-image-preview-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="chat-image-preview-btn"
                onClick={() =>
                  window.hermesAPI.saveMediaFile(
                    attachment.dataUrl!,
                    attachment.name,
                  )
                }
              >
                <Download size={14} />
                {t("chat.media.saveImage")}
              </button>
              <button
                className="chat-image-preview-btn"
                onClick={() => setZoomed(false)}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
