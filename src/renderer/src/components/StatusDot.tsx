/** Phase 6B — Orthogonal Agent Fleet StatusDot.
 *  Displays status (online/idle/offline) + working/error badges independently.
 */
import React from "react";

interface StatusDotProps {
  status: "online" | "idle" | "offline";
  working: boolean;
  error: boolean;
  diagnostics?: number;
}

const DOT_COLORS: Record<string, string> = {
  online: "#22c55e",
  idle: "#9ca3af",
  offline: "#6b7280",
};

function StatusDot({ status, working, error, diagnostics }: StatusDotProps): React.JSX.Element {
  const color = DOT_COLORS[status];
  const outline = status === "offline";

  return (
    <span className="fleet-status-dot" title={[
      status,
      working ? "working" : "",
      error ? "error" : "",
      diagnostics ? `${diagnostics} diagnostic(s)` : "",
    ].filter(Boolean).join(", ")}>
      <span style={{
        display: "inline-block",
        width: 10, height: 10, borderRadius: "50%",
        backgroundColor: outline ? "transparent" : color,
        border: outline ? `2px solid ${color}` : "none",
        verticalAlign: "middle",
      }} />
      {working && <span className="fleet-badge fleet-badge-working" title="Agent has active runs">⚡</span>}
      {error && <span className="fleet-badge fleet-badge-error" title="Agent has errors">✕</span>}
      {status === "offline" && working && (
        <span className="fleet-badge fleet-badge-warn" title="Run without gateway — data may be stale">⚠</span>
      )}
      {diagnostics ? (
        <span className="fleet-badge fleet-badge-info" title={`${diagnostics} diagnostic(s)`}>ⓘ</span>
      ) : null}
    </span>
  );
}

export default StatusDot;
