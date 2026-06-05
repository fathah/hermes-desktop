// DCF sensitivity heatmap (WACC × terminal growth) — hand-rolled SVG grid, no
// chart dependency. Cells are colored by intrinsic value relative to the grid
// range; invalid cells (growth ≥ wacc, returned as null by run_valuation) render blank.

import React from "react";
import type { DcfSensitivity as DcfSensitivityData } from "../reportContract";

// Functional value ramp between the SPS semantic endpoints: --danger-fg (low
// intrinsic value) → --ok-fg (high). Kept in sync with sps-tokens.css.
const RAMP_LOW: [number, number, number] = [0xa1, 0x20, 0x2c]; // --danger-fg
const RAMP_HIGH: [number, number, number] = [0x1f, 0x6b, 0x3a]; // --ok-fg

function lerpColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(RAMP_LOW[0] + (RAMP_HIGH[0] - RAMP_LOW[0]) * clamped);
  const g = Math.round(RAMP_LOW[1] + (RAMP_HIGH[1] - RAMP_LOW[1]) * clamped);
  const b = Math.round(RAMP_LOW[2] + (RAMP_HIGH[2] - RAMP_LOW[2]) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

export function DcfSensitivity({
  data,
}: {
  data: DcfSensitivityData;
}): React.JSX.Element | null {
  const { wacc, growth, grid } = data;
  if (!wacc?.length || !growth?.length || !grid?.length) return null;

  const flat = grid.flat().filter((v): v is number => typeof v === "number");
  if (flat.length === 0) return null;
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const range = max - min || 1;

  const cell = 54;
  const labelPad = 48;
  const width = labelPad + growth.length * cell;
  const height = labelPad + wacc.length * cell;

  return (
    <svg width={width} height={height} role="img" aria-label="DCF sensitivity">
      {/* column headers: terminal growth */}
      {growth.map((g, c) => (
        <text
          key={`g${c}`}
          x={labelPad + c * cell + cell / 2}
          y={labelPad - 8}
          fontSize={10}
          textAnchor="middle"
          fill="currentColor"
          fillOpacity={0.7}
        >
          g {(g * 100).toFixed(1)}%
        </text>
      ))}
      {/* rows: wacc */}
      {wacc.map((w, r) => (
        <text
          key={`w${r}`}
          x={labelPad - 8}
          y={labelPad + r * cell + cell / 2 + 3}
          fontSize={10}
          textAnchor="end"
          fill="currentColor"
          fillOpacity={0.7}
        >
          {(w * 100).toFixed(0)}%
        </text>
      ))}
      {grid.map((row, r) =>
        row.map((value, c) => {
          const x = labelPad + c * cell;
          const y = labelPad + r * cell;
          if (typeof value !== "number") {
            return (
              <rect
                key={`${r}-${c}`}
                x={x}
                y={y}
                width={cell - 2}
                height={cell - 2}
                fill="currentColor"
                fillOpacity={0.04}
              />
            );
          }
          const t = (value - min) / range;
          return (
            <g key={`${r}-${c}`}>
              <rect
                x={x}
                y={y}
                width={cell - 2}
                height={cell - 2}
                rx={3}
                fill={lerpColor(t)}
                fillOpacity={0.65}
              />
              <text
                x={x + (cell - 2) / 2}
                y={y + (cell - 2) / 2 + 3}
                fontSize={10}
                textAnchor="middle"
                fill="#fff"
              >
                {Math.round(value)}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}
