// Sector heatmap — hand-rolled SVG grid, no chart dependency. Rows are names,
// columns are normalized metrics (z-scores, ~ -1..1); cells ramp from the
// danger endpoint (low/negative) to the ok endpoint (high/positive), matching
// the DCF heatmap's functional color scheme.

import React from "react";
import type { SectorHeatmap as SectorHeatmapData } from "../reportContract";

const RAMP_LOW: [number, number, number] = [0xa1, 0x20, 0x2c]; // --danger-fg
const RAMP_MID: [number, number, number] = [0xec, 0xe8, 0xde]; // --neutral-bg
const RAMP_HIGH: [number, number, number] = [0x1f, 0x6b, 0x3a]; // --ok-fg

function rampColor(v: number): string {
  const t = Math.max(-1, Math.min(1, v));
  const [a, b] = t < 0 ? [RAMP_LOW, RAMP_MID] : [RAMP_MID, RAMP_HIGH];
  const f = t < 0 ? t + 1 : t; // 0..1 within the half
  const ch = (i: number): number => Math.round(a[i] + (b[i] - a[i]) * f);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

export function SectorHeatmap({
  data,
}: {
  data: SectorHeatmapData;
}): React.JSX.Element | null {
  const metrics = data?.metrics ?? [];
  const rows = data?.rows ?? [];
  if (metrics.length === 0 || rows.length === 0) return null;

  const cellW = 64;
  const cellH = 24;
  const labelW = 96;
  const headerH = 40;
  const width = labelW + metrics.length * cellW + 8;
  const height = headerH + rows.length * cellH + 8;

  return (
    <svg width={width} height={height} role="img" aria-label="Sector heatmap">
      {metrics.map((m, c) => (
        <text
          key={m}
          x={labelW + c * cellW + cellW / 2}
          y={headerH - 6}
          fontSize={9}
          textAnchor="middle"
          fill="currentColor"
          fillOpacity={0.6}
          transform={`rotate(-12 ${labelW + c * cellW + cellW / 2} ${headerH - 6})`}
        >
          {m}
        </text>
      ))}
      {rows.map((row, r) => (
        <g key={row.name}>
          <text
            x={labelW - 6}
            y={headerH + r * cellH + cellH / 2 + 3}
            fontSize={10}
            textAnchor="end"
            fill="currentColor"
            fillOpacity={0.8}
          >
            {row.name}
          </text>
          {metrics.map((_, c) => {
            const v = typeof row.values?.[c] === "number" ? row.values[c] : 0;
            const x = labelW + c * cellW;
            const yy = headerH + r * cellH;
            return (
              <g key={c}>
                <rect
                  x={x}
                  y={yy}
                  width={cellW - 2}
                  height={cellH - 2}
                  rx={2}
                  fill={rampColor(v)}
                  fillOpacity={0.7}
                />
                <text
                  x={x + (cellW - 2) / 2}
                  y={yy + (cellH - 2) / 2 + 3}
                  fontSize={9}
                  textAnchor="middle"
                  fill="#fff"
                >
                  {v.toFixed(1)}
                </text>
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
