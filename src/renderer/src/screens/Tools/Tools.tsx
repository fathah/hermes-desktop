import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";
import { Wrench, Plug, Puzzle, Search, X } from "../../assets/icons";
import { TOOL_ICONS, FALLBACK_TOOL_ICON } from "../../components/toolMeta";
import Skills from "../Skills/Skills";
import RemoteNotice from "../../components/RemoteNotice";

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
  kind: "plus" | "refresh" | "trash" | "test" | "server" | "x" | "install";
}): React.JSX.Element {
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

  async function handleAddMcp(): Promise<void> {
    setMcpError("");
    setMcpMessage("");
    setMcpBusy("add");
    try {
      const result = await window.hermesAPI.addMcpServer(
        {
          name: addForm.name,
          type: addForm.type,
          url: addForm.type === "http" ? addForm.url : undefined,
          command: addForm.type === "stdio" ? addForm.command : undefined,
          args: addForm.type === "stdio" ? parseArgsText(addForm.argsText) : [],
          env: addForm.type === "stdio" ? parseEnvText(addForm.envText) : {},
          auth: addForm.auth || undefined,
        },
        profile,
      );
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpAddFailed"));
        return;
      }
      setShowAddMcp(false);
      setAddForm(EMPTY_ADD_FORM);
      setMcpMessage(t("tools.mcpAdded"));
      await reloadMcp();
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpAddFailed"));
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
          <div className="loading-spinner" />
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
              <div className="tools-grid">
                {toolsets.map((t) => (
                  <div
                    key={t.key}
                    className={`tools-card ${t.enabled ? "tools-card-enabled" : "tools-card-disabled"}`}
                    onClick={() => handleToggle(t.key, t.enabled)}
                  >
                    <div className="tools-card-top">
                      <ToolIcon toolKey={t.key} />
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
                    <div className="tools-card-label">{t.label}</div>
                    <div className="tools-card-description">
                      {t.description}
                    </div>
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
                    onClick={() => setShowAddMcp(true)}
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
                <div className="tools-grid">
                  {filteredMcpServers.map((s) => (
                    <div
                      key={s.name}
                      className={`tools-card tools-mcp-card ${s.enabled ? "tools-card-enabled" : "tools-card-disabled"}`}
                    >
                      <div className="tools-card-top">
                        <div className="tools-card-icon">
                          <TinyIcon kind="server" />
                        </div>
                        <div className="tools-mcp-actions">
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
                          <label
                            className="tools-toggle"
                            title={
                              s.enabled
                                ? t("tools.mcpDisable")
                                : t("tools.mcpEnable")
                            }
                            onClick={(e) => e.stopPropagation()}
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
                      <div className="tools-card-label">{s.name}</div>
                      <div className="tools-card-description">
                        <span className="tools-mcp-pill">
                          {s.type === "http"
                            ? t("tools.http")
                            : s.type === "stdio"
                              ? t("tools.stdio")
                              : t("tools.unknown")}
                        </span>
                        {!s.enabled && (
                          <span className="tools-mcp-disabled">
                            {t("tools.disabled")}
                          </span>
                        )}
                      </div>
                      <div className="tools-card-description tools-mcp-detail">
                        {s.detail || t("tools.mcpNoDetail")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showAddMcp && (
        <div
          className="models-modal-overlay"
          onClick={() => setShowAddMcp(false)}
        >
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">{t("tools.mcpAddServer")}</h2>
              <button
                type="button"
                className="tools-icon-btn"
                aria-label={t("tools.close")}
                onClick={() => setShowAddMcp(false)}
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
                        setAddForm((prev) => ({ ...prev, url: e.target.value }))
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
                      <option value="header">{t("tools.mcpAuthHeader")}</option>
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
                      placeholder={"-y\n@modelcontextprotocol/server-github"}
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
            </div>
            <div className="models-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAddMcp(false)}
              >
                {t("tools.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={mcpBusy === "add"}
                onClick={() => void handleAddMcp()}
              >
                {t("tools.mcpAddServer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Tools;
