import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectMenuOption {
  value: string;
  label: string;
}

interface SelectMenuProps {
  /** Currently selected value; it does not have to appear in `options`. */
  value: string;
  options: readonly SelectMenuOption[];
  onSelect: (value: string) => void;
  /** Shown on the trigger when `value` is deliberately absent from `options`. */
  triggerLabel?: string;
  label?: string;
  disabled?: boolean;
}

/**
 * Dropdown used by the settings panes and the Theme Creator. The
 * `.settings-language-*` classes are inherited from the language picker it was
 * extracted from, so both surfaces keep the same styling.
 */
export function SelectMenu({
  value,
  options,
  onSelect,
  triggerLabel,
  label,
  disabled = false,
}: SelectMenuProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (disabled && isOpen) setIsOpen(false);
  }, [disabled, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const selected = options.find((option) => option.value === value);
  const shown = triggerLabel ?? selected?.label ?? value;

  return (
    // shortcut: absolute panel, clipped by overflow ancestors; portal when a
    // scrollable pane needs it.
    <div className="settings-language-select" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-language-trigger"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={label}
        disabled={disabled}
      >
        <span>{shown}</span>
        <ChevronDown size={14} />
      </button>
      {isOpen && !disabled && (
        <div className="settings-language-dropdown" id={listId} role="listbox">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`settings-language-option ${active ? "active" : ""}`}
                onClick={() => {
                  onSelect(option.value);
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span>{option.label}</span>
                {active && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
