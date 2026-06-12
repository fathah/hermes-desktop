import { useEffect, useState } from "react";

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

  useEffect(() => {
    if (!active || loaded) return;
    let cancelled = false;
    const loadSkills = window.hermesAPI.listInstalledSkills(profile);
    const loadTools = window.hermesAPI.getToolsets(profile);
    const loadMcp = window.hermesAPI.listMcpServers(profile);
    Promise.all([loadSkills, loadTools, loadMcp])
      .then(([skills, tools, mcp]) => {
        if (cancelled) return;
        setData({ skillCount: skills.length, tools, mcp });
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
          </div>
        )}
      </div>
    </div>
  );
}

export default CapabilitySummary;
