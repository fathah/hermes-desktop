// SpsModal.tsx — the single chrome shell for SPS centered dialogs.
//
// The CSS (.scrim / .modal / .modal-head) was already shared; what was NOT
// shared was behavior — Esc-to-close existed on some modals and not others, and
// the close-guards (Research's "don't close mid-run", External's viewer-aware
// Esc) were hand-rolled per file. This shell standardizes backdrop-close +
// Esc-close behind one component while letting each modal keep its exact
// semantics via `closeGuard` (vetoes a close) and `closeOnEsc` (opt out when a
// modal needs its own keydown logic). The drawer (TaskDrawer) is intentionally
// NOT built on this — it's a full-height slide-over with a different class tree.
import { useEffect, type CSSProperties, type ReactNode } from "react";

interface SpsModalProps {
  /** Header title (string or node, e.g. "🔬 Research"). */
  title: ReactNode;
  /** Close the modal (called by backdrop click and Esc, after `closeGuard`). */
  onClose: () => void;
  /** Body content rendered directly under the header (modal keeps its own
   *  `.modal-body` wrapper inside `children` if it had one). */
  children: ReactNode;
  /** Right-aligned header slot (tab chips, refresh button). When present the
   *  header switches to a space-between row. */
  headerActions?: ReactNode;
  /** Fixed width in px → inline `width` + `maxWidth`. Omit for the CSS default. */
  width?: number;
  /** Override the default `maxWidth` ("92vw") when `width` is set. */
  maxWidth?: string;
  /** Return false to veto a close (applies to both backdrop and Esc). */
  closeGuard?: () => boolean;
  /** Set false when the modal supplies its own Esc handler. Default true. */
  closeOnEsc?: boolean;
}

export function SpsModal({
  title,
  onClose,
  children,
  headerActions,
  width,
  maxWidth,
  closeGuard,
  closeOnEsc = true,
}: SpsModalProps): React.JSX.Element {
  useEffect(() => {
    if (!closeOnEsc) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      if (closeGuard && !closeGuard()) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEsc, closeGuard, onClose]);

  function handleBackdrop(): void {
    if (closeGuard && !closeGuard()) return;
    onClose();
  }

  const modalStyle: CSSProperties | undefined =
    width != null ? { width, maxWidth: maxWidth ?? "92vw" } : undefined;
  const headStyle: CSSProperties | undefined = headerActions
    ? { display: "flex", alignItems: "center", justifyContent: "space-between" }
    : undefined;

  return (
    <div
      className="scrim"
      onMouseDown={handleBackdrop}
      style={{ alignItems: "flex-start" }}
    >
      <div
        className="modal"
        style={modalStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head" style={headStyle}>
          <h3>{title}</h3>
          {headerActions}
        </div>
        {children}
      </div>
    </div>
  );
}
