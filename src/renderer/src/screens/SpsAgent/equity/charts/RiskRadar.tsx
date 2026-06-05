// 8-axis risk radar, hand-rolled SVG — no charting dependency, no global CSS,
// stays inside .sps-scope and uses currentColor so it inherits SPS theme tokens.

import React from "react";
import type { RiskCell } from "../reportContract";

const DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "financial", label: "Financial" },
  { key: "governance", label: "Governance" },
  { key: "geopolitical", label: "Geopolitical" },
  { key: "tech_disruption", label: "Tech" },
  { key: "fx_trade", label: "FX/Trade" },
  { key: "legislative", label: "Legislative" },
  { key: "political", label: "Political" },
  { key: "technical", label: "Technical" },
];

const SEVERITY_SCORE: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function severityToScore(cell: RiskCell | undefined): number {
  if (!cell) return 0;
  return SEVERITY_SCORE[String(cell.severity).toLowerCase()] ?? 0;
}

export function RiskRadar({
  riskMatrix,
  size = 280,
}: {
  riskMatrix: Record<string, RiskCell>;
  size?: number;
}): React.JSX.Element {
  const center = size / 2;
  const maxRadius = center - 36;
  const levels = 4; // Low..Critical

  const angleFor = (i: number): number =>
    (Math.PI * 2 * i) / DIMENSIONS.length - Math.PI / 2;
  const point = (i: number, radiusFraction: number): [number, number] => {
    const angle = angleFor(i);
    const r = maxRadius * radiusFraction;
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  };

  const gridRings = Array.from({ length: levels }, (_, level) => {
    const fraction = (level + 1) / levels;
    const pts = DIMENSIONS.map((_, i) => point(i, fraction).join(",")).join(
      " ",
    );
    return (
      <polygon
        key={level}
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.22}
      />
    );
  });

  const dataPoints = DIMENSIONS.map((dim, i) => {
    const score = severityToScore(riskMatrix[dim.key]);
    return point(i, score / levels);
  });
  const dataPolygon = dataPoints.map((p) => p.join(",")).join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Risk radar"
    >
      {gridRings}
      {DIMENSIONS.map((dim, i) => {
        const [x, y] = point(i, 1);
        const [lx, ly] = point(i, 1.16);
        return (
          <g key={dim.key}>
            <line
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.22}
            />
            <text
              x={lx}
              y={ly}
              fontSize={10}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="currentColor"
              fillOpacity={0.85}
            >
              {dim.label}
            </text>
          </g>
        );
      })}
      <polygon
        points={dataPolygon}
        fill="currentColor"
        fillOpacity={0.3}
        stroke="currentColor"
        strokeOpacity={0.9}
      />
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.5} fill="currentColor" />
      ))}
    </svg>
  );
}
