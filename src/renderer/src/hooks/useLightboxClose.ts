import { useEffect } from "react";

/**
 * Close the image lightbox on Escape. The document-level listener is bound
 * only while `active`, so it exists just for the overlay's lifetime. Shared
 * by MediaImage and AttachmentChip so both lightboxes behave identically.
 *
 * The listener runs in the capture phase and stops propagation: the lightbox
 * is the topmost modal (z-index above the panels), so it must consume Escape
 * exclusively. Other overlays bind document-level bubble-phase Escape
 * listeners (e.g. FileViewer) — without the capture+stop, one keypress would
 * close both the lightbox and the panel behind it.
 */
export function useLightboxClose(active: boolean, close: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, close]);
}
