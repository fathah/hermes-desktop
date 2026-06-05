// Peer comparison bars for one metric — hand-rolled SVG, no chart dependency.
// The target row is highlighted so a PSU's standing vs its govt-stake-bucketed
// peers is immediately legible.

import React from "react";
import type { PeerRow } from "../reportContract";

export function PeerCompBars({
  peers,
  metric,
  targetName,
}: {
  peers: PeerRow[];
  metric: string;
  targetName?: string;
}): React.JSX.Element | null {
  const rows = peers
    .map((p) => ({
      name: String(p.name),
      value: typeof p[metric] === "number" ? (p[metric] as number) : null,
    }))
    .filter((r) => r.value !== null) as Array<{ name: string; value: number }>;
  if (rows.length === 0) return null;

  const max = Math.max(...rows.map((r) => r.value));
  const rowHeight = 26;
  const width = 320;
  const labelWidth = 96;
  const barWidth = width - labelWidth - 44;

  return (
    <svg
      width={width}
      height={rows.length * rowHeight + 8}
      role="img"
      aria-label={`Peer ${metric}`}
    >
      {rows.map((r, i) => {
        const y = i * rowHeight + 4;
        const w = max > 0 ? (r.value / max) * barWidth : 0;
        const isTarget =
          targetName && r.name.toUpperCase() === targetName.toUpperCase();
        return (
          <g key={r.name}>
            <text
              x={0}
              y={y + 13}
              fontSize={11}
              fill="currentColor"
              fillOpacity={isTarget ? 1 : 0.7}
            >
              {r.name}
            </text>
            <rect
              x={labelWidth}
              y={y + 3}
              width={w}
              height={rowHeight - 12}
              rx={3}
              fill="currentColor"
              fillOpacity={isTarget ? 0.55 : 0.25}
            />
            <text
              x={labelWidth + w + 6}
              y={y + 13}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {r.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
