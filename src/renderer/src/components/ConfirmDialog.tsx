// ConfirmDialog.tsx — themed, accessible confirm modal. Replaces jarring native
// window.confirm() calls. Markup/classes are lifted from the Sessions delete
// modal (sessions-confirm-*) so the whole renderer shares one confirm pattern.
import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "./useI18n";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  /** Confirm-button label. Defaults to the shared "Confirm". */
  confirmLabel?: string;
  /** Cancel-button label. Defaults to the shared "Cancel". */
  cancelLabel?: string;
  /** Style the confirm action as destructive (red). */
  danger?: boolean;
  /** Disable both buttons while an async confirm is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element | null {
  const { t } = useI18n();

  // Esc cancels — registered only while open so it doesn't shadow other handlers.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="sessions-confirm-overlay"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        className="sessions-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sessions-confirm-header">
          <h3 id="confirm-dialog-title">{title}</h3>
          <button
            type="button"
            className="btn-ghost sessions-confirm-close"
            onClick={onCancel}
            disabled={busy}
            aria-label={cancelLabel ?? t("common.cancel")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="sessions-confirm-body">
          <p>{body}</p>
        </div>
        <div className="sessions-confirm-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
