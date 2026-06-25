import { useCallback, useEffect, useMemo, useState } from "react";

type McpTransport = "http" | "stdio" | "unknown";

interface McpServer {
  name: string;
  type: McpTransport;
  transport: McpTransport;
  enabled: boolean;
  detail: string;
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
}

interface McpCatalogEntry {
  name: string;
  description: string;
  installed: boolean;
  enabled: boolean;
}

interface McpFormState {
  name: string;
  type: "http" | "stdio";
  url: string;
  auth: string;
  command: string;
  args: string;
  env: string;
}

const EMPTY_FORM: McpFormState = {
  name: "",
  type: "http",
  url: "",
  auth: "",
  command: "",
  args: "",
  env: "",
};

function parseArgs(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      throw new Error("Environment lines must use KEY=value.");
    }
    const key = trimmed.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name "${key}".`);
    }
    env[key] = trimmed.slice(idx + 1);
  }
  return env;
}

function serverSubtitle(server: McpServer): string {
  const detail = server.url || server.command || server.detail || server.type;
  const parts = [server.transport || server.type, detail].filter(Boolean);
  if (server.auth) parts.push(`auth: ${server.auth}`);
  if (server.args.length) parts.push(`${server.args.length} args`);
  const envKeys = Object.keys(server.env);
  if (envKeys.length) parts.push(`env: ${envKeys.join(", ")}`);
  return parts.join(" · ");
}

function McpServersManager({
  profile,
  active,
  sectionTab = "troubleshooting",
}: {
  profile?: string;
  active: boolean;
  sectionTab?: string;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<McpFormState>(EMPTY_FORM);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setMessage(null);
    try {
      const [nextServers, catalogResult] = await Promise.all([
        window.hermesAPI.listMcpServers(profile),
        window.hermesAPI.listMcpCatalog(profile).catch((err) => ({
          entries: [],
          diagnostics: [],
          error: (err as Error).message,
        })),
      ]);
      setServers(nextServers as McpServer[]);
      setCatalog((catalogResult.entries || []) as McpCatalogEntry[]);
      setCatalogMessage(catalogResult.error || null);
      setLoaded(true);
    } catch (err) {
      setMessage({
        kind: "error",
        text: (err as Error).message || "Could not load MCP servers.",
      });
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!active || loaded) return;
    void reload();
  }, [active, loaded, reload]);

  const filteredServers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return servers;
    return servers.filter((server) =>
      [server.name, server.type, server.detail, server.url, server.command]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [query, servers]);

  async function handleAdd(): Promise<void> {
    setBusy("add");
    setMessage(null);
    try {
      const input =
        form.type === "http"
          ? {
              name: form.name,
              type: "http" as const,
              url: form.url,
              auth: form.auth || undefined,
            }
          : {
              name: form.name,
              type: "stdio" as const,
              command: form.command,
              args: parseArgs(form.args),
              env: parseEnv(form.env),
            };
      const result = await window.hermesAPI.addMcpServer(input, profile);
      if (!result.success) {
        setMessage({
          kind: "error",
          text: result.error || "Could not add MCP server.",
        });
        return;
      }
      setForm(EMPTY_FORM);
      setShowAdd(false);
      setMessage({
        kind: "info",
        text: "MCP server saved. Review new capabilities before enabling when prompted.",
      });
      await reload();
    } catch (err) {
      setMessage({
        kind: "error",
        text: (err as Error).message || "Could not add MCP server.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleToggle(server: McpServer): Promise<void> {
    setBusy(`toggle:${server.name}`);
    setMessage(null);
    try {
      const result = await window.hermesAPI.setMcpServerEnabled(
        server.name,
        !server.enabled,
        profile,
      );
      if (!result.success) {
        setMessage({
          kind: "error",
          text: result.error || "Could not update MCP server.",
        });
      }
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function handleTest(server: McpServer): Promise<void> {
    setBusy(`test:${server.name}`);
    setMessage(null);
    try {
      const result = await window.hermesAPI.testMcpServer(server.name, profile);
      if (!result.success) {
        setMessage({
          kind: "error",
          text: result.error || "MCP server test failed.",
        });
      } else {
        setMessage({
          kind: "info",
          text: `MCP server responded. ${result.tools?.length || 0} tools found.`,
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(server: McpServer): Promise<void> {
    if (!window.confirm(`Remove MCP server "${server.name}"?`)) return;
    setBusy(`remove:${server.name}`);
    setMessage(null);
    try {
      const result = await window.hermesAPI.removeMcpServer(
        server.name,
        profile,
      );
      if (!result.success) {
        setMessage({
          kind: "error",
          text: result.error || "Could not remove MCP server.",
        });
        return;
      }
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function handleInstall(entry: McpCatalogEntry): Promise<void> {
    setBusy(`install:${entry.name}`);
    setMessage(null);
    try {
      const result = await window.hermesAPI.installMcpCatalogEntry(
        entry.name,
        {},
        profile,
      );
      if (!result.success) {
        setMessage({
          kind: "error",
          text: result.error || "Could not install MCP catalog entry.",
        });
        return;
      }
      setMessage({
        kind: "info",
        text: result.background
          ? "MCP install started in the background."
          : "MCP catalog entry installed.",
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="settings-section" data-section-tab={sectionTab}>
      <div className="settings-section-title">MCP Servers</div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 12 }}>
          Manage Model Context Protocol servers available to this profile. Newly
          added reach may require capability review before it can run.
        </div>

        <div className="settings-hermes-actions" style={{ marginBottom: 12 }}>
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter servers"
            style={{ maxWidth: 260 }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={loading}
            onClick={() => void reload()}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAdd((value) => !value)}
          >
            {showAdd ? "Cancel" : "Add Server"}
          </button>
        </div>

        {message && (
          <div
            className={`settings-field-hint ${
              message.kind === "error" ? "settings-field-error" : ""
            }`}
            role={message.kind === "error" ? "alert" : "status"}
            style={{ marginBottom: 12 }}
          >
            {message.text}
          </div>
        )}

        {showAdd && (
          <div className="settings-field" style={{ marginBottom: 16 }}>
            <div className="settings-input-row">
              <input
                className="input"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Server name"
              />
              <select
                className="input"
                value={form.type}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as "http" | "stdio",
                  }))
                }
                style={{ maxWidth: 140 }}
              >
                <option value="http">HTTP</option>
                <option value="stdio">stdio</option>
              </select>
            </div>
            {form.type === "http" ? (
              <div className="settings-input-row" style={{ marginTop: 8 }}>
                <input
                  className="input"
                  value={form.url}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      url: event.target.value,
                    }))
                  }
                  placeholder="https://example.com/mcp"
                />
                <input
                  className="input"
                  value={form.auth}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      auth: event.target.value,
                    }))
                  }
                  placeholder="auth type"
                  style={{ maxWidth: 160 }}
                />
              </div>
            ) : (
              <>
                <input
                  className="input"
                  value={form.command}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      command: event.target.value,
                    }))
                  }
                  placeholder="Command"
                  style={{ marginTop: 8 }}
                />
                <textarea
                  className="input"
                  value={form.args}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      args: event.target.value,
                    }))
                  }
                  placeholder="Arguments, one per line"
                  rows={3}
                  style={{ marginTop: 8 }}
                />
                <textarea
                  className="input"
                  value={form.env}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      env: event.target.value,
                    }))
                  }
                  placeholder="KEY=value, one per line"
                  rows={3}
                  style={{ marginTop: 8 }}
                />
              </>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy === "add"}
              onClick={() => void handleAdd()}
              style={{ marginTop: 10 }}
            >
              {busy === "add" ? "Adding..." : "Add MCP Server"}
            </button>
          </div>
        )}

        {!loaded ? (
          <div className="settings-field-hint">Loading MCP servers...</div>
        ) : filteredServers.length === 0 ? (
          <div className="settings-field-hint">
            {servers.length === 0
              ? "No MCP servers configured."
              : "No MCP servers match the filter."}
          </div>
        ) : (
          <div className="cap-summary">
            {filteredServers.map((server) => (
              <div className="cap-summary-row" key={server.name}>
                <span className="cap-summary-label">
                  {server.name} ({server.type})
                </span>{" "}
                <span className="settings-field-hint">
                  {server.enabled ? "Enabled" : "Disabled"} -{" "}
                  {serverSubtitle(server)}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy === `toggle:${server.name}`}
                  onClick={() => void handleToggle(server)}
                  style={{ marginLeft: 8 }}
                >
                  {server.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy === `test:${server.name}`}
                  onClick={() => void handleTest(server)}
                  style={{ marginLeft: 6 }}
                >
                  Test
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy === `remove:${server.name}`}
                  onClick={() => void handleRemove(server)}
                  style={{ marginLeft: 6 }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {catalogMessage && (
          <div className="settings-field-hint" style={{ marginTop: 12 }}>
            {catalogMessage}
          </div>
        )}

        {catalog.length > 0 && (
          <div className="settings-field" style={{ marginTop: 16 }}>
            <div className="settings-field-label">Catalog</div>
            {catalog.map((entry) => (
              <div className="cap-summary-row" key={entry.name}>
                <span className="cap-summary-label">{entry.name}</span>{" "}
                <span className="settings-field-hint">
                  {entry.description || "No description."}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy === `install:${entry.name}` || entry.installed}
                  onClick={() => void handleInstall(entry)}
                  style={{ marginLeft: 8 }}
                >
                  {entry.installed || entry.enabled ? "Installed" : "Install"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default McpServersManager;
