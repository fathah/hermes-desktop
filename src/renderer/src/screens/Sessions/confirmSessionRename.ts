import type { RefObject } from "react";
import toast from "react-hot-toast";
import { normalizeSessionTitle } from "../../../../shared/session-title";

export interface ConfirmSessionRenameOptions {
  sessionId: string;
  value: string;
  currentTitle: string;
  /** True when this session is still the one being edited. */
  isStillEditing: () => boolean;
  isCurrentContext: () => boolean;
  setSaving: (saving: boolean) => void;
  applyOptimistic: (title: string) => void;
  rollback: () => void;
  clearEditing: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  fallbackErrorMessage: string;
  persist: (sessionId: string, title: string) => Promise<void>;
}

export type ConfirmSessionRenameResult =
  | "cancelled"
  | "saved"
  | "failed"
  | "pending";

const pendingRenameInputs = new WeakSet<object>();

/**
 * Shared inline-rename flow for the sidebar and Sessions modal: normalize,
 * no-op cancel, optimistic update, durable persist, then clear editing on
 * success or toast + rollback + refocus on failure.
 */
export async function confirmSessionRename(
  opts: ConfirmSessionRenameOptions,
): Promise<ConfirmSessionRenameResult> {
  if (pendingRenameInputs.has(opts.inputRef)) return "pending";
  const normalized = normalizeSessionTitle(opts.value);
  if (!normalized || normalized === opts.currentTitle) {
    opts.clearEditing();
    return "cancelled";
  }

  pendingRenameInputs.add(opts.inputRef);
  opts.setSaving(true);
  opts.applyOptimistic(normalized);
  try {
    await opts.persist(opts.sessionId, normalized);
    if (opts.isCurrentContext() && opts.isStillEditing()) opts.clearEditing();
    return "saved";
  } catch (err) {
    console.error("Failed to rename session", opts.sessionId, err);
    if (!opts.isCurrentContext()) return "failed";
    opts.rollback();
    const message =
      err instanceof Error && err.message
        ? err.message
        : opts.fallbackErrorMessage;
    toast.error(message);
    if (opts.isStillEditing()) {
      setTimeout(() => {
        if (opts.isCurrentContext() && opts.isStillEditing()) {
          opts.inputRef.current?.focus();
          opts.inputRef.current?.select();
        }
      }, 0);
    }
    return "failed";
  } finally {
    pendingRenameInputs.delete(opts.inputRef);
    opts.setSaving(false);
  }
}
