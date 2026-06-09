// InlineRename.tsx — themed in-place rename input, replacing native prompt().
// Renders an <input> where a label normally sits; Enter commits, Esc cancels,
// blur commits. A cancelled-ref makes Esc win the race against the blur handler
// (Esc triggers blur, which would otherwise re-commit the old value).
import { useEffect, useRef } from "react";

interface InlineRenameProps {
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  /** Label class of the element being replaced (so layout matches). */
  className?: string;
}

export function InlineRename({
  initial,
  onSubmit,
  onCancel,
  className = "nav-label",
}: InlineRenameProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = (): void => {
    if (cancelled.current) return;
    const value = ref.current?.value.trim() ?? "";
    if (value) onSubmit(value);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      className={className}
      defaultValue={initial}
      // Keep clicks/keys from bubbling to the row (navigate) and the global
      // SPS hotkey handler.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
      style={{
        flex: 1,
        minWidth: 0,
        font: "inherit",
        color: "inherit",
        background: "var(--card, #fff)",
        border: "1px solid var(--accent, #9993)",
        borderRadius: 4,
        padding: "0 4px",
      }}
    />
  );
}
