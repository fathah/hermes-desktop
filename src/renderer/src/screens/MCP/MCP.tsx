import { useState, useEffect } from "react";

function MCP({ profile }: { profile: string }): React.JSX.Element {
  const [catalog, setCatalog] = useState<Array<{ name: string; description: string; installed: boolean }>>([]);
  const [installed, setInstalled] = useState<Array<{ name: string; type: string; enabled: boolean; detail: string }>>([]);

  useEffect(() => {
    window.hermesAPI.listMcpCatalog().then(setCatalog);
    window.hermesAPI.listMcpServers(profile).then(setInstalled);
  }, [profile]);

  return (
    <div className="mcp-screen">
      <header className="screen-header">
        <h1 className="screen-title">MCP Hub</h1>
        <p className="screen-subtitle">Model Context Protocol servers</p>
      </header>
      <section>
        <h2>Installed</h2>
        {installed.length === 0 ? (
          <p className="empty-state">No MCP servers configured. Use <code>hermes mcp add</code> in terminal.</p>
        ) : (
          <ul className="mcp-list">
            {installed.map((s) => (
              <li key={s.name} className="card mcp-item">
                <strong>{s.name}</strong> <span className="badge">{s.type}</span>
                <p>{s.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Catalog</h2>
        <ul className="mcp-list">
          {catalog.map((c) => (
            <li key={c.name} className="card mcp-item">
              <strong>{c.name}</strong> {c.installed && <span className="badge installed">Installed</span>}
              <p>{c.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default MCP;
