interface Coordinate {
  x: number;
  y: number;
}

interface SvgCablesProps {
  connections: { source: string; target: string }[];
  nodePositions: Record<string, Coordinate>;
  nodeDimensions: Record<string, { width: number; height: number }>;
}

export function SvgCables({
  connections,
  nodePositions,
  nodeDimensions,
}: SvgCablesProps) {
  const getBezierPath = (
    srcId: string,
    tgtId: string,
    p1: Coordinate,
    p2: Coordinate,
  ) => {
    const srcDim = nodeDimensions[srcId] || { width: 280, height: 180 };
    const tgtDim = nodeDimensions[tgtId] || { width: 280, height: 180 };

    const srcAnchor = {
      x: p1.x + srcDim.width,
      y: p1.y + srcDim.height / 2,
    };
    const tgtAnchor = {
      x: p2.x,
      y: p2.y + tgtDim.height / 2,
    };

    if (p1.x > p2.x + tgtDim.width) {
      srcAnchor.x = p1.x;
      tgtAnchor.x = p2.x + tgtDim.width;
    }

    const dx = tgtAnchor.x - srcAnchor.x;
    const dy = tgtAnchor.y - srcAnchor.y;

    const cx1 = srcAnchor.x + dx * 0.4;
    const cy1 = srcAnchor.y + dy * 0.1;
    const cx2 = tgtAnchor.x - dx * 0.4;
    const cy2 = tgtAnchor.y - dy * 0.1;

    return `M ${srcAnchor.x} ${srcAnchor.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tgtAnchor.x} ${tgtAnchor.y}`;
  };

  return (
    <svg className="cables-svg">
      <defs>
        <filter id="cable-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {connections.map(({ source, target }, idx) => {
        const p1 = nodePositions[source];
        const p2 = nodePositions[target];

        if (!p1 || !p2) return null;

        const pathData = getBezierPath(source, target, p1, p2);

        return (
          <g key={`${source}-${target}-${idx}`}>
            <path
              d={pathData}
              className="cable-path"
              filter="url(#cable-glow)"
            />
            <path d={pathData} className="cable-pulse" />
          </g>
        );
      })}
    </svg>
  );
}
