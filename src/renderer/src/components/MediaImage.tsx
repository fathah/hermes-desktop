import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { useLightboxClose } from "../hooks/useLightboxClose";
import type { MediaToken } from "../screens/Chat/mediaUtils";
import { useI18n } from "./useI18n";

/**
 * Returns an `onContextMenu` handler that opens a native right-click menu
 * for a media element — "Open" (hands the file to the OS default handler,
 * or a web URL to the browser) and "Save as…". The labels are resolved
 * through i18n here so the native menu matches the active UI locale, since
 * the menu itself is built in the main process (issue #299).
 */
function useMediaContextMenu(
  token: MediaToken,
): (event: React.MouseEvent) => void {
  const { t } = useI18n();
  return (event) => {
    event.preventDefault();
    window.hermesAPI.showMediaMenu(token.src, token.name, {
      open: t("chat.media.open"),
      saveAs: t("chat.media.saveAs"),
    });
  };
}

/**
 * Renders an agent-delivered image (issue #299). Data URLs and http(s)
 * URLs render directly; local filesystem paths are resolved to a data URL
 * through the main process. Clicking the image opens a zoom/lightbox
 * overlay with a localized save action.
 */
export function MediaImage({
  token,
}: {
  token: MediaToken;
}): React.JSX.Element {
  const { t } = useI18n();
  const isDirect =
    token.src.startsWith("data:") || /^https?:\/\//i.test(token.src);
  const [resolved, setResolved] = useState<string | null>(
    isDirect ? token.src : null,
  );
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  useLightboxClose(zoomed, () => setZoomed(false));
  const resolvedToken = { ...token, src: resolved ?? token.src };
  const onContextMenu = useMediaContextMenu(resolvedToken);

  useEffect(() => {
    if (isDirect) return;
    let cancelled = false;
    window.hermesAPI
      .readMediaFile(token.src)
      .then((dataUrl) => {
        if (cancelled) return;
        if (dataUrl) setResolved(dataUrl);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token.src, isDirect]);

  if (failed) {
    return (
      <span className="chat-media-error">⚠ Could not load {token.name}</span>
    );
  }

  if (!resolved) {
    return <span className="chat-media-loading">Loading {token.name}…</span>;
  }

  return (
    <>
      <img
        className="chat-media-image"
        src={resolved}
        alt={token.name}
        onClick={() => setZoomed(true)}
        onContextMenu={onContextMenu}
        onError={() => setFailed(true)}
      />
      {/* Portal to <body>: `.chat-message` rows use `content-visibility: auto`
          (chat perf), whose implied paint containment makes the row a
          containing block for `position: fixed` descendants — rendered
          inline, the backdrop gets trapped and clipped inside the message
          row instead of covering the viewport. */}
      {zoomed &&
        createPortal(
          <div
            className="chat-image-preview-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setZoomed(false)}
          >
            <img
              className="chat-image-preview-image"
              src={resolved}
              alt={token.name}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={onContextMenu}
            />
            <div
              className="chat-image-preview-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="chat-image-preview-btn"
                onClick={() =>
                  window.hermesAPI.saveMediaFile(
                    resolved ?? token.src,
                    token.name,
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

/** A compact, clickable chip for non-image media — saves the file. */
export function DownloadChip({
  token,
}: {
  token: MediaToken;
}): React.JSX.Element {
  const onContextMenu = useMediaContextMenu(token);
  return (
    <button
      className="chat-media-file"
      onClick={() => window.hermesAPI.saveMediaFile(token.src, token.name)}
      onContextMenu={onContextMenu}
    >
      <Download size={14} />
      {token.name}
    </button>
  );
}

/**
 * Renders one media segment (issue #299). Explicit `MEDIA:` tokens are
 * trusted and shown eagerly; a bare-path candidate is first verified to
 * point at a real file — until then, and if verification fails, its
 * original text is shown verbatim, so a path merely mentioned in prose is
 * never turned into media.
 */
export function MediaSegmentView({
  token,
  raw,
  source,
}: {
  token: MediaToken;
  raw: string;
  source: "media-token" | "bare-path";
}): React.JSX.Element {
  const [verified, setVerified] = useState<boolean | null>(
    source === "media-token" ? true : null,
  );

  useEffect(() => {
    // Only an inferred local path needs verifying; explicit tokens and
    // URLs are trusted as-is.
    if (source !== "bare-path" || token.isUrl) return;
    let cancelled = false;
    window.hermesAPI
      .mediaFileExists(token.src)
      .then((ok) => {
        if (!cancelled) setVerified(ok);
      })
      .catch(() => {
        if (!cancelled) setVerified(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, token.src, token.isUrl]);

  if (verified !== true) return <>{raw}</>;
  return token.isImage ? (
    <MediaImage token={token} />
  ) : (
    <DownloadChip token={token} />
  );
}

export default MediaImage;
