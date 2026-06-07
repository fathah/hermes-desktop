import { useEffect, useState } from "react";

/**
 * Capability review (read-only). One screen answering "what can this profile's
 * agent currently do, and what touches credentials / the filesystem?" across
 * skills, tools, and MCP servers. Composes existing IPC — no new handlers. The
 * toggles themselves live in the Skills / Tools screens; this is the audit view
 * the operator-guide checklist points at ("are only the needed capabilities
 * enabled?"). Mirrors the Insights screen's load/visible/empty pattern.
 */
interface Skill {
  name: string;
  category: string;
  description: string;
  path: string;
}
interface Toolset {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}
interface McpServer {
  name: string;
  type: string;
  enabled: boolean;
  detail: string;
}

interface CapabilityData {
  skills: Skill[];
  tools: Toolset[];
  mcp: McpServer[];
}

function CapabilityReview({
  profile,
  visible,
}: {
  profile: string;
  visible?: boolean;
}): React.JSX.Element {
  const [data, setData] = useState<CapabilityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      window.hermesAPI.listInstalledSkills(profile),
      window.hermesAPI.getToolsets(profile),
      window.hermesAPI.listMcpServers(profile),
    ])
      .then(([skills, tools, mcp]) => {
        if (!cancelled) setData({ skills, tools, mcp });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, visible]);

  const activeTools = data ? data.tools.filter((t) => t.enabled) : [];
  const activeMcp = data ? data.mcp.filter((m) => m.enabled) : [];

  return (
    <div className="insights-screen">
      <header className="insights-header">
        <h1>Capabilities</h1>
        <p className="insights-subtitle">
          Everything this profile&apos;s agent can currently do and touch.
          Disable anything you don&apos;t recognize in Skills or Tools.
        </p>
      </header>

      {loading ? (
        <div className="insights-empty">Loading…</div>
      ) : !data ? (
        <div className="insights-empty">Couldn&apos;t load capabilities.</div>
      ) : (
        <div className="insights-body">
          <section className="insights-section">
            <h2>
              Skills <span className="cap-count">{data.skills.length}</span>
            </h2>
            {data.skills.length === 0 ? (
              <div className="cap-empty">No skills installed.</div>
            ) : (
              <ul className="cap-list">
                {data.skills.map((s) => (
                  <li key={s.path} className="cap-item">
                    <span className="cap-item-name">{s.name}</span>
                    <span className="cap-item-tag">{s.category}</span>
                    <span className="cap-item-desc">{s.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="insights-section">
            <h2>
              Tools{" "}
              <span className="cap-count">
                {activeTools.length}/{data.tools.length} active
              </span>
            </h2>
            <ul className="cap-list">
              {data.tools.map((t) => (
                <li
                  key={t.key}
                  className={`cap-item ${t.enabled ? "" : "cap-off"}`}
                >
                  <span className="cap-item-name">{t.label}</span>
                  <span className={`cap-badge ${t.enabled ? "on" : "off"}`}>
                    {t.enabled ? "active" : "off"}
                  </span>
                  <span className="cap-item-desc">{t.description}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="insights-section">
            <h2>
              MCP servers{" "}
              <span className="cap-count">
                {activeMcp.length}/{data.mcp.length} active
              </span>
            </h2>
            {data.mcp.length === 0 ? (
              <div className="cap-empty">No MCP servers configured.</div>
            ) : (
              <ul className="cap-list">
                {data.mcp.map((m) => (
                  <li
                    key={m.name}
                    className={`cap-item ${m.enabled ? "" : "cap-off"}`}
                  >
                    <span className="cap-item-name">{m.name}</span>
                    <span className="cap-item-tag">{m.type}</span>
                    <span className={`cap-badge ${m.enabled ? "on" : "off"}`}>
                      {m.enabled ? "active" : "off"}
                    </span>
                    <span className="cap-item-desc">{m.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default CapabilityReview;
