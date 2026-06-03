// Icon.tsx — inline SVG icon, ported from the prototype's icons.jsx.
import type { CSSProperties } from "react";
import { ICON_PATHS, type IconName } from "./iconPaths";

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({
  name,
  size = 18,
  stroke = 1.6,
  className = "",
  style,
  title,
}: IconProps) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg
      className={"ic " + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      dangerouslySetInnerHTML={{
        __html: (title ? `<title>${title}</title>` : "") + path,
      }}
    />
  );
}
