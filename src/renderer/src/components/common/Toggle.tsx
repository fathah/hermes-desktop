import { useState, type ButtonHTMLAttributes } from "react";

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-checked" | "onChange" | "onClick" | "role" | "type"
>;

export interface ToggleProps extends NativeButtonProps {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void | Promise<void>;
}

/** Accessible controlled switch with an interaction-gated bounce animation. */
export function Toggle({
  checked,
  label,
  onCheckedChange,
  className,
  disabled,
  ...buttonProps
}: ToggleProps): React.JSX.Element {
  const [hasInteracted, setHasInteracted] = useState(false);

  return (
    <button
      {...buttonProps}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-on={checked ? "true" : "false"}
      className={`app-toggle${hasInteracted ? " is-init" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      onClick={() => {
        setHasInteracted(true);
        void onCheckedChange(!checked);
      }}
    >
      <span className="app-toggle-thumb" aria-hidden="true" />
    </button>
  );
}
