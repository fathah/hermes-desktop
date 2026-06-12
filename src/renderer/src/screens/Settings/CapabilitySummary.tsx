import { useEffect, useState } from "react";
import type {
  CapabilityRiskReport,
  CapabilityRiskSummary,
} from "../../../../shared/capability-risk";

/**
 * Capability summary card (read-only) for Settings → Application Health.
 *
 * Absorbs the old standalone CapabilityReview screen (deleted in P2.4): the
 * security-oversight answer to "what can this profile's agent currently do, and
 * what's touching credentials / the filesystem right now?". Composes the same
 * existing IPC the screen used (no new handlers) and renders a compact summary —
 * installed-skill count plus the *active* tools and MCP servers (the ones that
 * actually grant the agent reach). The toggles still live in the Skills / Tools
 * surfaces; this is purely the audit glance. Loads lazily the first time the
 * Application Health tab is shown so it stays off the Settings-mount hot path.
 */
interface Toolset {
  key: string;
  label: string;
  enabled: boolean;
}
interface McpServer {
  name: string;
  type: string;
  enabled: boolean;
}
interface CapabilitySnapshot {
  skillCount: number;
  tools: Toolset[];
  mcp: McpServer[];
  risk: CapabilityRiskSummary | null;
}

function CapabilitySummary({
  profile,
  active,
}: {
  profile?: string;
  active: boolean;
}): React.JSX.Element | null {
  const [data, setData] = useState<CapabilitySnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!active || loaded) return;
    let cancelled = false;
    const loadSkills = window.hermesAPI.listInstalledSkills(profile);
    const loadTools = window.hermesAPI.getToolsets(profile);
    const loadMcp = window.hermesAPI.listMcpServers(profile);
    const loadRisk = window.hermesAPI.getCapabilityRiskSummary(profile);
    Promise.all([loadSkills, loadTools, loadMcp, loadRisk])
      .then(([skills, tools, mcp, risk]) => {
        if (cancelled) return;
        setData({ skillCount: skills.length, tools, mcp, risk });
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, loaded, profile]);

  const activeTools = data ? data.tools.filter((t) => t.enabled) : [];
  const activeMcp = data ? data.mcp.filter((m) => m.enabled) : [];
  const riskReports = data?.risk?.reports || [];
  const notableRisks = riskReports.filter(
    (r) =>
      r.status !== "safe" ||
      r.reviewState !== "reviewed" ||
      r.updateStatus !== "current",
  );

  async function checkNow(): Promise<void> {
    setChecking(true);
    try {
      const risk = await window.hermesAPI.checkCapabilityRisksNow(profile);
      setData((current) => (current ? { ...current, risk } : current));
      setLoaded(true);
    } finally {
      setChecking(false);
    }
  }

  async function markReviewed(report: CapabilityRiskReport): Promise<void> {
    const risk = await window.hermesAPI.reviewCapabilityRisk(report.id, profile);
    setData((current) => (current ? { ...current, risk } : current));
  }

  return (
    <div className="settings-section" data-section-tab="agenthealth">
      <div className="settings-section-title">Capabilities</div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 12 }}>
          Everything My Assistant can currently access and use. Disable anything
          you don&apos;t recognize in the workspace Skills / Tools surfaces.
        </div>
        {!loaded ? (
          <div className="settings-field-hint">Loading capabilities…</div>
        ) : !data ? (
          <div className="settings-field-hint">
            Couldn&apos;t load capabilities.
          </div>
        ) : (
          <div className="cap-summary">
            <div className="cap-summary-counts">
              <span className="cap-count">{data.skillCount} skills</span>
              <span className="cap-count">
                {activeTools.length}/{data.tools.length} tools active
              </span>
              <span className="cap-count">
                {activeMcp.length}/{data.mcp.length} MCP servers active
              </span>
              {data.risk && (
                <span className="cap-count">
                  {data.risk.stats.blocked} blocked / {data.risk.stats.warning} warn
                </span>
              )}
            </div>
            <div className="cap-summary-row">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={checking}
                onClick={() => void checkNow()}
              >
                {checking ? "Checking..." : "Check now"}
              </button>
              {data.risk && (
                <span className="settings-field-hint" style={{ marginLeft: 10 }}>
                  Last checked{" "}
                  {data.risk.checkedAt
                    ? new Date(data.risk.checkedAt).toLocaleString()
                    : "never"}
                </span>
              )}
            </div>
            {activeTools.length > 0 && (
              <div className="cap-summary-row">
                <span className="cap-summary-label">Active tools:</span>{" "}
                {activeTools.map((t) => t.label).join(", ")}
              </div>
            )}
            {activeMcp.length > 0 && (
              <div className="cap-summary-row">
                <span className="cap-summary-label">Active MCP:</span>{" "}
                {activeMcp.map((m) => `${m.name} (${m.type})`).join(", ")}
              </div>
            )}
            {notableRisks.length > 0 && (
              <div className="cap-summary-row">
                <span className="cap-summary-label">Review needed:</span>{" "}
                {notableRisks.slice(0, 4).map((report) => (
                  <span key={report.id} style={{ display: "block", marginTop: 6 }}>
                    {report.name} ({report.kind}) - {report.status} -{" "}
                    {report.updateStatus}
                    {report.findings[0] ? ` - ${report.findings[0].title}` : ""}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginLeft: 8 }}
                      onClick={() => void markReviewed(report)}
                    >
                      Mark reviewed
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CapabilitySummary;
