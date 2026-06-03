// FsPop.tsx — filter/sort popover shell. Ported from tasks.jsx FsPop.
import type { ReactNode } from "react";

interface Props {
  x: number;
  y: number;
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function FsPop({ x, y, title, children, onClose }: Props) {
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 64 }}
        onMouseDown={onClose}
      />
      <div
        className="fs-pop"
        style={{
          left: Math.min(x, window.innerWidth - 240),
          top: y,
          zIndex: 65,
        }}
      >
        <div className="menu-label">{title}</div>
        {children}
      </div>
    </>
  );
}
