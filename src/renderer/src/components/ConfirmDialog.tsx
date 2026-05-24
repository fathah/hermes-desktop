/**
 * Reusable destructive-confirm modal.
 *
 * Used by the Memory edit-UI (β), Persona edit-UI (γ), and
 * any future destructive write flow. Replaces `window.confirm()`
 * (banned by plan v10 — too easy to dismiss, no proper
 * disabled-during-roundtrip state, inconsistent with the
 * telemetry-dialog aesthetic).
 *
 * Uses the same `.telemetry-dialog-backdrop` /
 * `.telemetry-dialog` CSS classes the KanbanTelemetryView /
 * SchedulesTelemetryView already use, plus the existing
 * `.telemetry-button-danger` class for the destructive
 * confirm button.
 *
 * State-machine: the dialog can render in three states:
 *
 *   pending=false → both buttons enabled, cancel/confirm
 *                    triggers callback
 *   pending=true  → both buttons disabled, confirm button
 *                    shows ellipsis label
 *   (after confirm/cancel, parent unmounts the dialog)
 *
 * No internal state — the parent controls open/close via
 * conditional rendering. Body content is a `ReactNode` so
 * callers can embed `<code>` excerpts, character counts, etc.
 */

import type { ReactNode } from "react";

interface ConfirmDialogProps {
  /** Modal title — rendered as `.telemetry-summary-subtitle`. */
  title: string;
  /** Body content. Free-form ReactNode for code excerpts etc. */
  body: ReactNode;
  /** Label for the confirm button. Default "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Default "Cancel". */
  cancelLabel?: string;
  /**
   * When `true`, confirm button uses `.telemetry-button-danger`
   * styling. Set for destructive actions (delete, overwrite,
   * reset).
   */
  destructive?: boolean;
  /**
   * When `true`, both buttons render `disabled` and the confirm
   * label changes to "<label>…" to signal an in-flight IPC.
   */
  pending?: boolean;
  /** Called when the user presses Cancel or clicks the backdrop. */
  onCancel: () => void;
  /** Called when the user presses Confirm. */
  onConfirm: () => void;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <div
      className="telemetry-dialog-backdrop"
      onClick={pending ? undefined : onCancel}
      data-testid="confirm-dialog-backdrop"
    >
      <div
        className="telemetry-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="telemetry-summary-subtitle">{title}</h3>
        <div className="telemetry-summary-hint" style={{ marginBottom: 12 }}>
          {body}
        </div>
        <div className="telemetry-dialog-actions">
          <button
            onClick={onCancel}
            disabled={pending}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </button>
          <button
            className={destructive ? "telemetry-button-danger" : "telemetry-button-primary"}
            onClick={onConfirm}
            disabled={pending}
            data-testid="confirm-dialog-confirm"
          >
            {pending ? `${confirmLabel}…` : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
