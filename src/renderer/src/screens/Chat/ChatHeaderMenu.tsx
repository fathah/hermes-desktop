// ChatHeaderMenu.tsx — the "⋯" overflow menu for the chat header's secondary
// actions. Self-contained (global main.css classes + inline positioning) rather
// than the sps-scoped .menu idiom, because <Chat> renders BOTH inside the SPS
// workspace AND in the admin overlay's chat view (outside .sps-scope). Full
// keyboard support: Esc closes, ↑/↓ rove, focus returns to the trigger on close.
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export interface OverflowItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** Render with the active/selected accent (e.g. fast mode on). */
  active?: boolean;
  /** Render as a destructive action (e.g. clear chat). */
  danger?: boolean;
}

export function ChatHeaderMenu({
  items,
}: {
  items: OverflowItem[];
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openMenu = (): void => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const menuItems = (): HTMLElement[] =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
          [],
      );
    menuItems()[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const nodes = menuItems();
        if (nodes.length === 0) return;
        const idx = nodes.indexOf(document.activeElement as HTMLElement);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        nodes[(idx + delta + nodes.length) % nodes.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn-ghost chat-clear-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More chat options"
        title="More"
        onClick={() => (open ? close() : openMenu())}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && pos && (
        <>
          <div
            className="chat-overflow-scrim"
            onMouseDown={close}
            role="presentation"
          />
          <div
            ref={menuRef}
            className="chat-overflow-menu"
            role="menu"
            style={{ top: pos.top, right: pos.right }}
          >
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className={`chat-overflow-item${it.active ? " active" : ""}${
                  it.danger ? " danger" : ""
                }`}
                onClick={() => {
                  it.onClick();
                  close();
                }}
              >
                <span className="chat-overflow-icon" aria-hidden="true">
                  {it.icon}
                </span>
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
