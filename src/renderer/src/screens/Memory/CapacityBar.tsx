interface CapacityBarProps {
  used: number;
  limit: number;
  label: string;
}

export function CapacityBar({
  used,
  limit,
  label,
}: CapacityBarProps): React.JSX.Element {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color =
    pct > 90 ? "var(--error)" : pct > 70 ? "var(--warning)" : "var(--success)";
  return (
    <div className="memory-capacity">
      <div className="memory-capacity-header">
        {label && <span className="memory-capacity-label">{label}</span>}
        <span className="memory-capacity-value">
          {used.toLocaleString()} / {limit.toLocaleString()} chars ({pct}%)
        </span>
      </div>
      <div className="memory-capacity-track">
        <div
          className="memory-capacity-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
