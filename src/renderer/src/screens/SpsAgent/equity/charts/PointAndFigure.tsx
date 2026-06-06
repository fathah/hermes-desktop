// Point & Figure chart — hand-rolled SVG X/O grid, no chart dependency.
// Computes columns client-side from the report's price_series closes. X columns
// (demand) use the up/ok color, O columns (supply) use the danger color, so the
// supply/demand read is immediate. Box price labels run down the left axis.

import React from "react";
import type { PriceBar } from "../reportContract";
import { closes, pointAndFigure } from "../indicators";

export function PointAndFigure({
  series,
  boxPct = 0.02,
  reversal = 3,
}: {
  series: PriceBar[];
  boxPct?: number;
  reversal?: number;
}): React.JSX.Element | null {
  const pnf = pointAndFigure(closes(series), boxPct, reversal);
  if (!pnf) return null;

  const { columns, minBox, maxBox, boxSize, signal } = pnf;
  const rows = maxBox - minBox + 1;
  if (rows <= 0 || rows > 400) return null; // guard against pathological scaling

  const cell = 14;
  const axisW = 52;
  const headerH = 18;
  const width = axisW + columns.length * cell + 8;
  const height = headerH + rows * cell + 8;

  const rowY = (box: number): number => headerH + (maxBox - box) * cell;
  const colX = (i: number): number => axisW + i * cell;

  const upColor = "var(--ok-fg, currentColor)";
  const downColor = "var(--danger-fg, currentColor)";

  // price gridline labels every ~5 boxes
  const labels: number[] = [];
  for (let b = minBox; b <= maxBox; b++) {
    if ((maxBox - b) % 5 === 0) labels.push(b);
  }

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="Point and Figure chart"
    >
      <text x={0} y={12} fontSize={10} fill="currentColor" fillOpacity={0.7}>
        box ₹{boxSize} · {reversal}-box ·{" "}
        {signal === "buy" ? "▲ buy" : signal === "sell" ? "▼ sell" : "neutral"}
      </text>
      {labels.map((b) => (
        <text
          key={`l${b}`}
          x={axisW - 6}
          y={rowY(b) + cell - 3}
          fontSize={9}
          textAnchor="end"
          fill="currentColor"
          fillOpacity={0.55}
        >
          {Math.round(b * boxSize)}
        </text>
      ))}
      {columns.map((col, i) => {
        const x = colX(i) + cell / 2;
        const marks: React.JSX.Element[] = [];
        for (let b = col.lo; b <= col.hi; b++) {
          const y = rowY(b) + cell / 2;
          if (col.dir === "X") {
            const r = cell / 2 - 2;
            marks.push(
              <g key={`${i}-${b}`} stroke={upColor} strokeWidth={1.4}>
                <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} />
                <line x1={x - r} y1={y + r} x2={x + r} y2={y - r} />
              </g>,
            );
          } else {
            marks.push(
              <circle
                key={`${i}-${b}`}
                cx={x}
                cy={y}
                r={cell / 2 - 2}
                fill="none"
                stroke={downColor}
                strokeWidth={1.4}
              />,
            );
          }
        }
        return <g key={i}>{marks}</g>;
      })}
    </svg>
  );
}
