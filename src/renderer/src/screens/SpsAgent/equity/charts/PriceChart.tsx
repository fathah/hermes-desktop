// Price / technical chart — hand-rolled SVG, no chart dependency. Close-price
// area line with SMA(20)/SMA(50) overlays, plus a latest RSI/MACD readout. All
// derived client-side from the report's price_series.

import React from "react";
import type { PriceBar } from "../reportContract";
import { closes, sma, rsi, macd } from "../indicators";

export function PriceChart({
  series,
  width = 560,
  height = 200,
}: {
  series: PriceBar[];
  width?: number;
  height?: number;
}): React.JSX.Element | null {
  const c = closes(series);
  if (c.length < 2) return null;

  const padL = 44;
  const padR = 8;
  const padT = 22;
  const padB = 18;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const min = Math.min(...c);
  const max = Math.max(...c);
  const range = max - min || 1;
  const x = (i: number): number => padL + (i / (c.length - 1)) * plotW;
  const y = (v: number): number => padT + (1 - (v - min) / range) * plotH;

  const linePath = (vals: Array<number | null>): string =>
    vals
      .map((v, i) =>
        v == null
          ? null
          : `${i === 0 || vals[i - 1] == null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
      )
      .filter(Boolean)
      .join(" ");

  const closePath = c
    .map(
      (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
    )
    .join(" ");
  const areaPath = `${closePath} L${x(c.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const sma20 = sma(c, 20);
  const sma50 = sma(c, 50);
  const latestRsi = rsi(c, 14);
  const latestMacd = macd(c);

  const yTicks = [max, (max + min) / 2, min];

  return (
    <svg width={width} height={height} role="img" aria-label="Price chart">
      <text x={0} y={12} fontSize={10} fill="currentColor" fillOpacity={0.7}>
        Close · SMA20 · SMA50
        {latestRsi != null ? ` · RSI ${latestRsi}` : ""}
        {latestMacd
          ? ` · MACD ${latestMacd.histogram >= 0 ? "▲" : "▼"}${latestMacd.histogram}`
          : ""}
      </text>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line
            x1={padL}
            y1={y(v)}
            x2={width - padR}
            y2={y(v)}
            stroke="currentColor"
            strokeOpacity={0.1}
          />
          <text
            x={padL - 6}
            y={y(v) + 3}
            fontSize={9}
            textAnchor="end"
            fill="currentColor"
            fillOpacity={0.55}
          >
            {Math.round(v)}
          </text>
        </g>
      ))}
      <path d={areaPath} fill="currentColor" fillOpacity={0.06} />
      <path
        d={closePath}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.85}
        strokeWidth={1.4}
      />
      <path
        d={linePath(sma20)}
        fill="none"
        stroke="var(--info-fg, currentColor)"
        strokeOpacity={0.8}
        strokeWidth={1.2}
      />
      <path
        d={linePath(sma50)}
        fill="none"
        stroke="var(--accent-ochre, currentColor)"
        strokeOpacity={0.85}
        strokeWidth={1.2}
      />
    </svg>
  );
}
