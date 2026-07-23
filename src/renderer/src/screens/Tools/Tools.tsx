import { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "../../components/useI18n";
import { Wrench, Plug, Puzzle, Search, X } from "../../assets/icons";
import { TOOL_ICONS, FALLBACK_TOOL_ICON } from "../../components/toolMeta";
import Skills from "../Skills/Skills";
import RemoteNotice from "../../components/RemoteNotice";
import { OrbLoader } from "../../components/OrbLoader";

interface ToolsetInfo {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface ToolsProps {
  profile?: string;
  showPlatformToolsets?: boolean;
  remoteMode?: boolean;
  // Whether this pane is the active view. The Layout keeps tabs mounted and
  // toggles visibility, so we refetch on each show to pick up changes made
  // elsewhere (e.g. installing an MCP from Discover).
  visible?: boolean;
  // Navigate to the Discover → Skills tab (used by the embedded Skills tab).
  onBrowseSkills?: () => void;
  // Navigate to the Discover → MCPs tab (used by the MCP "Browse catalog").
  onBrowseMcps?: () => void;
}

type CapabilityTab = "tools" | "mcp" | "skills";

function ToolIcon({ toolKey }: { toolKey: string }): React.JSX.Element {
  return (
    <div className="tools-card-icon">
      {TOOL_ICONS[toolKey] || FALLBACK_TOOL_ICON}
    </div>
  );
}

// Logo for an MCP server. Following the registry's own web UI: render the
// icon as a plain <img> on a white tile (in both themes) so single-colour
// black glyphs stay legible and colour logos keep their colours — no inline
// SVG or recolouring needed. Source order: registry icon → the HTTP server's
// own-domain favicon → a generic server glyph (on the normal dark tile).
function McpLogo({
  iconUrl,
  url,
}: {
  iconUrl?: string;
  url?: string;
}): React.JSX.Element {
  const candidates = useMemo(() => {
    const list: string[] = [];
    if (iconUrl) list.push(iconUrl);
    if (url) {
      try {
        list.push(`${new URL(url).origin}/favicon.ico`);
      } catch {
        /* not a valid URL — skip the favicon candidate */
      }
    }
    return list;
  }, [iconUrl, url]);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [candidates]);
  const src = candidates[idx];
  if (!src) {
    return (
      <div className="tools-card-icon">
        <TinyIcon kind="server" />
      </div>
    );
  }
  return (
    <div className="tools-card-icon mcp-logo-tile">
      <img src={src} alt="" onError={() => setIdx((i) => i + 1)} />
    </div>
  );
}

interface McpServer {
  name: string;
  type: "http" | "stdio" | "unknown";
  transport: "http" | "stdio" | "unknown";
  enabled: boolean;
  detail: string;
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
}

interface AddMcpForm {
  name: string;
  type: "http" | "stdio";
  url: string;
  command: string;
  argsText: string;
  envText: string;
  auth: string;
}

const EMPTY_ADD_FORM: AddMcpForm = {
  name: "",
  type: "http",
  url: "",
  command: "",
  argsText: "",
  envText: "",
  auth: "",
};

function parseArgsText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return env;
}

interface McpServerInput {
  name: string;
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
}

/** Map the visual form to the add/update payload. */
function formToInput(form: AddMcpForm): McpServerInput {
  return {
    name: form.name,
    type: form.type,
    url: form.type === "http" ? form.url : undefined,
    command: form.type === "stdio" ? form.command : undefined,
    args: form.type === "stdio" ? parseArgsText(form.argsText) : [],
    env: form.type === "stdio" ? parseEnvText(form.envText) : {},
    auth: form.auth || undefined,
  };
}

/** Serialise the form (+ enabled) to the raw "Server JSON" for full edit. */
function formToJson(form: AddMcpForm, enabled: boolean): string {
  const obj: Record<string, unknown> = {};
  if (form.type === "http") {
    obj.url = form.url;
    if (form.auth) obj.auth = form.auth;
  } else {
    obj.command = form.command;
    const args = parseArgsText(form.argsText);
    if (args.length) obj.args = args;
    const env = parseEnvText(form.envText);
    if (Object.keys(env).length) obj.env = env;
  }
  obj.enabled = enabled;
  return JSON.stringify(obj, null, 2);
}

/** Parse the raw "Server JSON" back into form fields (+ optional enabled). */
function parseServerJson(
  text: string,
): { form: Omit<AddMcpForm, "name">; enabled?: boolean } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Expected a JSON object." };
  }
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : "";
  const command = typeof o.command === "string" ? o.command : "";
  const args = Array.isArray(o.args) ? o.args.map((a) => String(a)) : [];
  const envText =
    o.env && typeof o.env === "object" && !Array.isArray(o.env)
      ? Object.entries(o.env as Record<string, unknown>)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join("\n")
      : "";
  return {
    form: {
      type: url.trim() ? "http" : "stdio",
      url,
      command,
      argsText: args.join("\n"),
      envText,
      auth: typeof o.auth === "string" ? o.auth : "",
    },
    enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
  };
}

function IconButton({
  title,
  children,
  onClick,
  disabled,
  danger,
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tools-icon-btn ${danger ? "tools-icon-btn-danger" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function TinyIcon({
  kind,
}: {
  kind:
    | "plus"
    | "refresh"
    | "trash"
    | "test"
    | "server"
    | "x"
    | "install"
    | "edit";
}): React.JSX.Element {
  if (kind === "edit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (kind === "plus") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (kind === "refresh") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
      </svg>
    );
  }
  if (kind === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 18h10l1-18M10 11v6M14 11v6" />
      </svg>
    );
  }
  if (kind === "test") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M10 2v6L4 19a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3L14 8V2M8 14h8" />
      </svg>
    );
  }
  if (kind === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  if (kind === "install") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="6" cy="18" r="1" />
    </svg>
  );
}

function Tools({
  profile,
  showPlatformToolsets = true,
  remoteMode = false,
  visible = true,
  onBrowseSkills,
  onBrowseMcps,
}: ToolsProps): React.JSX.Element {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<CapabilityTab>(
    showPlatformToolsets ? "tools" : "mcp",
  );
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpError, setMcpError] = useState("");
  const [mcpMessage, setMcpMessage] = useState("");
  const [mcpBusy, setMcpBusy] = useState("");
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [addForm, setAddForm] = useState<AddMcpForm>(EMPTY_ADD_FORM);
  // Original name of the server being edited (null = adding a new one).
  const [editingMcpName, setEditingMcpName] = useState<string | null>(null);
  // Modal editor mode + the raw JSON buffer for full edit.
  const [mcpEditMode, setMcpEditMode] = useState<"visual" | "json">("visual");
  const [mcpJsonText, setMcpJsonText] = useState("");
  const [mcpJsonError, setMcpJsonError] = useState("");
  // Enabled state of the server being edited (round-tripped through the JSON).
  const [editingEnabled, setEditingEnabled] = useState(true);
  // Registry MCP id → icon URL, so installed servers show their catalog logo.
  const [registryIcons, setRegistryIcons] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .fetchRegistry(false)
      .then((catalog) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const m of catalog.mcps) if (m.icon) map[m.id] = m.icon;
        setRegistryIcons(map);
      })
      .catch(() => {
        /* registry offline — favicon/glyph fallback still applies */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [mcpSearch, setMcpSearch] = useState("");

  const loadToolsets = useCallback(async (): Promise<void> => {
    setLoading(true);
    setMcpError("");
    try {
      const [list, mcp] = await Promise.all([
        showPlatformToolsets
          ? window.hermesAPI.getToolsets(profile)
          : Promise.resolve([]),
        window.hermesAPI.listMcpServers(profile),
      ]);
      setToolsets(list);
      setMcpServers(mcp);
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [profile, showPlatformToolsets]);

  useEffect(() => {
    if (visible) loadToolsets();
  }, [visible, loadToolsets]);

  async function handleToggle(
    key: string,
    currentEnabled: boolean,
  ): Promise<void> {
    setToolsets((prev) =>
      prev.map((t) => (t.key === key ? { ...t, enabled: !currentEnabled } : t)),
    );
    await window.hermesAPI.setToolsetEnabled(key, !currentEnabled, profile);
  }

  async function reloadMcp(): Promise<void> {
    setMcpError("");
    try {
      setMcpServers(await window.hermesAPI.listMcpServers(profile));
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpLoadFailed"));
    }
  }

  function resetMcpModalMode(): void {
    setMcpEditMode("visual");
    setMcpJsonText("");
    setMcpJsonError("");
  }

  function openAddMcp(): void {
    setEditingMcpName(null);
    setEditingEnabled(true);
    setAddForm(EMPTY_ADD_FORM);
    setMcpError("");
    resetMcpModalMode();
    setShowAddMcp(true);
  }

  // Open the shared modal pre-filled with an existing server for in-place edits.
  function openEditMcp(server: McpServer): void {
    setEditingMcpName(server.name);
    setEditingEnabled(server.enabled);
    setAddForm({
      name: server.name,
      type: server.type === "stdio" ? "stdio" : "http",
      url: server.url || "",
      command: server.command || "",
      argsText: (server.args || []).join("\n"),
      envText: Object.entries(server.env || {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      auth: server.auth || "",
    });
    setMcpError("");
    resetMcpModalMode();
    setShowAddMcp(true);
  }

  function closeMcpModal(): void {
    setShowAddMcp(false);
    setEditingMcpName(null);
    setAddForm(EMPTY_ADD_FORM);
    resetMcpModalMode();
  }

  // Switch modes, keeping the two representations in sync.
  function switchMcpMode(mode: "visual" | "json"): void {
    if (mode === mcpEditMode) return;
    if (mode === "json") {
      setMcpJsonText(formToJson(addForm, editingEnabled));
      setMcpJsonError("");
      setMcpEditMode("json");
      return;
    }
    const parsed = parseServerJson(mcpJsonText);
    if ("error" in parsed) {
      setMcpJsonError(parsed.error);
      return;
    }
    setAddForm((prev) => ({ ...prev, ...parsed.form }));
    if (parsed.enabled !== undefined) setEditingEnabled(parsed.enabled);
    setMcpJsonError("");
    setMcpEditMode("visual");
  }

  async function handleSaveMcp(): Promise<void> {
    const editing = editingMcpName;
    // In JSON mode, the raw buffer is the source of truth: parse it into the
    // form fields (+ enabled) first, surfacing a parse error inline.
    let input: McpServerInput;
    let nextEnabled: boolean | undefined;
    if (mcpEditMode === "json") {
      const parsed = parseServerJson(mcpJsonText);
      if ("error" in parsed) {
        setMcpJsonError(parsed.error);
        return;
      }
      input = formToInput({ ...parsed.form, name: addForm.name });
      nextEnabled = parsed.enabled;
    } else {
      input = formToInput(addForm);
    }
    setMcpError("");
    setMcpMessage("");
    setMcpBusy(editing ? "update" : "add");
    try {
      const result = editing
        ? await window.hermesAPI.updateMcpServer(editing, input, profile)
        : await window.hermesAPI.addMcpServer(input, profile);
      if (!result.success) {
        setMcpError(
          result.error ||
            t(editing ? "tools.mcpUpdateFailed" : "tools.mcpAddFailed"),
        );
        return;
      }
      // Apply an enabled change requested via the JSON (add/update carry only
      // the config; the enabled flag is a separate call).
      if (nextEnabled !== undefined && nextEnabled !== editingEnabled) {
        await window.hermesAPI.setMcpServerEnabled(
          input.name,
          nextEnabled,
          profile,
        );
      }
      closeMcpModal();
      setMcpMessage(t(editing ? "tools.mcpUpdated" : "tools.mcpAdded"));
      await reloadMcp();
    } catch (err) {
      setMcpError(
        (err as Error).message ||
          t(editing ? "tools.mcpUpdateFailed" : "tools.mcpAddFailed"),
      );
    } finally {
      setMcpBusy("");
    }
  }

  async function handleRemoveMcp(name: string): Promise<void> {
    if (!window.confirm(t("tools.mcpRemoveConfirm", { name }))) return;
    setMcpBusy(`remove:${name}`);
    try {
      const result = await window.hermesAPI.removeMcpServer(name, profile);
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpRemoveFailed"));
        return;
      }
      setMcpMessage(t("tools.mcpRemoved"));
      await reloadMcp();
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpRemoveFailed"));
    } finally {
      setMcpBusy("");
    }
  }

  async function handleMcpEnabled(
    name: string,
    enabled: boolean,
  ): Promise<void> {
    setMcpBusy(`toggle:${name}`);
    setMcpServers((prev) =>
      prev.map((server) =>
        server.name === name ? { ...server, enabled } : server,
      ),
    );
    try {
      const result = await window.hermesAPI.setMcpServerEnabled(
        name,
        enabled,
        profile,
      );
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpToggleFailed"));
        await reloadMcp();
        return;
      }
      setMcpMessage(enabled ? t("tools.mcpEnabled") : t("tools.mcpDisabled"));
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpToggleFailed"));
      await reloadMcp();
    } finally {
      setMcpBusy("");
    }
  }

  async function handleTestMcp(name: string): Promise<void> {
    setMcpBusy(`test:${name}`);
    setMcpError("");
    setMcpMessage("");
    try {
      const result = await window.hermesAPI.testMcpServer(name, profile);
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpTestFailed"));
        return;
      }
      setMcpMessage(
        t("tools.mcpTestPassed", { count: result.tools?.length || 0 }),
      );
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpTestFailed"));
    } finally {
      setMcpBusy("");
    }
  }

  const filteredMcpServers = mcpSearch.trim()
    ? mcpServers.filter((s) => {
        const q = mcpSearch.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) || s.detail.toLowerCase().includes(q)
        );
      })
    : mcpServers;

  if (loading) {
    return (
      <div className="tools-container">
        <div className="tools-loading">
          <OrbLoader state="searching" size={64} />
        </div>
      </div>
    );
  }

  return (
    <div className="tools-screen">
      <div className="tools-tabs">
        {showPlatformToolsets && (
          <button
            type="button"
            className={`tools-tab ${activeTab === "tools" ? "active" : ""}`}
            onClick={() => setActiveTab("tools")}
          >
            <Wrench size={16} />
            {t("tools.title")}
            <span className="tools-tab-count">{toolsets.length}</span>
          </button>
        )}
        <button
          type="button"
          className={`tools-tab ${activeTab === "mcp" ? "active" : ""}`}
          onClick={() => setActiveTab("mcp")}
        >
          <Plug size={16} />
          {t("tools.mcpServers")}
          <span className="tools-tab-count">{mcpServers.length}</span>
        </button>
        <button
          type="button"
          className={`tools-tab ${activeTab === "skills" ? "active" : ""}`}
          onClick={() => setActiveTab("skills")}
        >
          <Puzzle size={16} />
          {t("navigation.skills")}
        </button>
      </div>

      {activeTab === "skills" ? (
        <div className="tools-skills-pane">
          {remoteMode ? (
            <RemoteNotice feature="Skills" />
          ) : (
            <Skills profile={profile} embedded onBrowse={onBrowseSkills} />
          )}
        </div>
      ) : (
        <div className="tools-pane">
          {showPlatformToolsets && activeTab === "tools" && (
            <>
              <div className="tools-toolset-grid">
                {toolsets.map((t) => (
                  <div
                    key={t.key}
                    className={`tools-toolset-row ${t.enabled ? "is-on" : "is-off"}`}
                    onClick={() => handleToggle(t.key, t.enabled)}
                  >
                    <ToolIcon toolKey={t.key} />
                    <div className="tools-toolset-info">
                      <div className="tools-card-label">{t.label}</div>
                      <div className="tools-card-description">
                        {t.description}
                      </div>
                    </div>
                    <label
                      className="tools-toggle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={() => handleToggle(t.key, t.enabled)}
                      />
                      <span className="tools-toggle-track" />
                    </label>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "mcp" && (
            <div className="tools-section">
              <div className="tools-header tools-header-row">
                <div className="tools-mcp-search">
                  <Search size={15} />
                  <input
                    className="tools-mcp-search-input"
                    type="text"
                    placeholder={t("tools.mcpSearch")}
                    value={mcpSearch}
                    onChange={(e) => setMcpSearch(e.target.value)}
                  />
                  {mcpSearch && (
                    <button
                      type="button"
                      className="tools-icon-btn"
                      aria-label={t("tools.close")}
                      onClick={() => setMcpSearch("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="tools-header-actions">
                  {onBrowseMcps && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={onBrowseMcps}
                    >
                      <TinyIcon kind="install" />
                      {t("tools.mcpBrowseCatalog")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void reloadMcp()}
                  >
                    <TinyIcon kind="refresh" />
                    {t("tools.refresh")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={openAddMcp}
                  >
                    <TinyIcon kind="plus" />
                    {t("tools.mcpAddServer")}
                  </button>
                </div>
              </div>

              {mcpError && <div className="tools-error">{mcpError}</div>}
              {mcpMessage && <div className="tools-success">{mcpMessage}</div>}

              {mcpServers.length === 0 ? (
                <div className="tools-empty">
                  <div className="tools-card-icon">
                    <TinyIcon kind="server" />
                  </div>
                  <div>
                    <div className="tools-card-label">
                      {t("tools.mcpEmptyTitle")}
                    </div>
                    <div className="tools-card-description">
                      {t("tools.mcpEmptyDescription")}
                    </div>
                  </div>
                </div>
              ) : filteredMcpServers.length === 0 ? (
                <div className="tools-card-description tools-mcp-no-results">
                  {t("tools.mcpNoResults")}
                </div>
              ) : (
                <div className="mcp-table">
                  <div className="mcp-thead">
                    <span>{t("tools.mcpColServer")}</span>
                    <span>{t("tools.mcpColTransport")}</span>
                    <span>{t("tools.mcpColCommand")}</span>
                    <span className="mcp-th-enabled">
                      {t("tools.mcpColEnabled")}
                    </span>
                  </div>
                  {filteredMcpServers.map((s) => {
                    const cmd =
                      s.type === "http"
                        ? s.url || ""
                        : [s.command, ...(s.args || [])]
                            .filter(Boolean)
                            .join(" ");
                    return (
                      <div
                        key={s.name}
                        className={`mcp-row ${s.enabled ? "" : "mcp-row-off"}`}
                      >
                        <div className="mcp-cell mcp-cell-server">
                          <McpLogo
                            iconUrl={registryIcons[s.name]}
                            url={s.url}
                          />
                          <span className="mcp-name">{s.name}</span>
                        </div>
                        <div className="mcp-cell">
                          <span
                            className={`mcp-transport ${s.type === "http" ? "is-http" : ""}`}
                          >
                            {s.type === "http"
                              ? t("tools.http")
                              : s.type === "stdio"
                                ? t("tools.stdio")
                                : t("tools.unknown")}
                          </span>
                        </div>
                        <div className="mcp-cell mcp-cell-cmd" title={cmd}>
                          <span className="mcp-cmd">
                            {cmd || t("tools.mcpNoDetail")}
                          </span>
                        </div>
                        <div className="mcp-cell mcp-cell-controls">
                          <div className="mcp-row-actions">
                            <IconButton
                              title={t("tools.mcpEdit")}
                              onClick={() => openEditMcp(s)}
                            >
                              <TinyIcon kind="edit" />
                            </IconButton>
                            <IconButton
                              title={t("tools.mcpTest")}
                              disabled={mcpBusy === `test:${s.name}`}
                              onClick={() => void handleTestMcp(s.name)}
                            >
                              <TinyIcon kind="test" />
                            </IconButton>
                            <IconButton
                              title={t("tools.mcpRemove")}
                              danger
                              disabled={mcpBusy === `remove:${s.name}`}
                              onClick={() => void handleRemoveMcp(s.name)}
                            >
                              <TinyIcon kind="trash" />
                            </IconButton>
                          </div>
                          <label
                            className="tools-toggle"
                            title={
                              s.enabled
                                ? t("tools.mcpDisable")
                                : t("tools.mcpEnable")
                            }
                          >
                            <input
                              type="checkbox"
                              checked={s.enabled}
                              disabled={mcpBusy === `toggle:${s.name}`}
                              onChange={() =>
                                void handleMcpEnabled(s.name, !s.enabled)
                              }
                            />
                            <span className="tools-toggle-track" />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                  <div className="mcp-tfoot">
                    <span>
                      {t("tools.mcpFooter", {
                        servers: mcpServers.length,
                        enabled: mcpServers.filter((s) => s.enabled).length,
                      })}
                    </span>
                    <span className="mcp-tfoot-hint">
                      {t("tools.mcpActionsHint")}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showAddMcp && (
        <div className="models-modal-overlay" onClick={closeMcpModal}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {editingMcpName
                  ? t("tools.mcpEditServer")
                  : t("tools.mcpAddServer")}
              </h2>
              <button
                type="button"
                className="tools-icon-btn"
                aria-label={t("tools.close")}
                onClick={closeMcpModal}
              >
                <TinyIcon kind="x" />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("tools.mcpName")}
                </label>
                <input
                  className="input"
                  value={addForm.name}
                  onChange={(e) =>
                    setAddForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="github"
                />
              </div>

              <div className="mcp-mode-toggle">
                <button
                  type="button"
                  className={`mcp-mode-btn ${mcpEditMode === "visual" ? "active" : ""}`}
                  onClick={() => switchMcpMode("visual")}
                >
                  {t("tools.mcpModeVisual")}
                </button>
                <button
                  type="button"
                  className={`mcp-mode-btn ${mcpEditMode === "json" ? "active" : ""}`}
                  onClick={() => switchMcpMode("json")}
                >
                  {t("tools.mcpModeJson")}
                </button>
              </div>

              {mcpEditMode === "visual" && (
                <>
                  <div className="models-modal-field">
                    <label className="models-modal-label">
                      {t("tools.mcpTransport")}
                    </label>
                    <select
                      className="input"
                      value={addForm.type}
                      onChange={(e) =>
                        setAddForm((prev) => ({
                          ...prev,
                          type: e.target.value as "http" | "stdio",
                        }))
                      }
                    >
                      <option value="http">{t("tools.http")}</option>
                      <option value="stdio">{t("tools.stdio")}</option>
                    </select>
                  </div>
                  {addForm.type === "http" ? (
                    <>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpUrl")}
                        </label>
                        <input
                          className="input"
                          value={addForm.url}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              url: e.target.value,
                            }))
                          }
                          placeholder="https://example.com/mcp"
                        />
                      </div>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpAuth")}
                        </label>
                        <select
                          className="input"
                          value={addForm.auth}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              auth: e.target.value,
                            }))
                          }
                        >
                          <option value="">{t("tools.mcpAuthNone")}</option>
                          <option value="oauth">OAuth</option>
                          <option value="header">
                            {t("tools.mcpAuthHeader")}
                          </option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpCommand")}
                        </label>
                        <input
                          className="input"
                          value={addForm.command}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              command: e.target.value,
                            }))
                          }
                          placeholder="npx"
                        />
                      </div>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpArgs")}
                        </label>
                        <textarea
                          className="input tools-textarea"
                          value={addForm.argsText}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              argsText: e.target.value,
                            }))
                          }
                          placeholder={
                            "-y\n@modelcontextprotocol/server-github"
                          }
                        />
                        <span className="models-modal-hint">
                          {t("tools.mcpArgsHint")}
                        </span>
                      </div>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpEnv")}
                        </label>
                        <textarea
                          className="input tools-textarea"
                          value={addForm.envText}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              envText: e.target.value,
                            }))
                          }
                          placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=..."
                        />
                        <span className="models-modal-hint">
                          {t("tools.mcpEnvHint")}
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}

              {mcpEditMode === "json" && (
                <div className="models-modal-field">
                  <label className="models-modal-label">
                    {t("tools.mcpJsonLabel")}
                  </label>
                  <textarea
                    className="input tools-textarea mcp-json-input"
                    value={mcpJsonText}
                    spellCheck={false}
                    onChange={(e) => {
                      setMcpJsonText(e.target.value);
                      setMcpJsonError("");
                    }}
                  />
                  {mcpJsonError && (
                    <span className="models-modal-hint mcp-json-error">
                      {mcpJsonError}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="models-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={closeMcpModal}
              >
                {t("tools.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={mcpBusy === (editingMcpName ? "update" : "add")}
                onClick={() => void handleSaveMcp()}
              >
                {editingMcpName
                  ? t("tools.mcpSaveChanges")
                  : t("tools.mcpAddServer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Tools;
