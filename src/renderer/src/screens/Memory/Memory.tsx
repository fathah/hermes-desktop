import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Refresh } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { Check, ExternalLink } from "lucide-react";

interface MemoryEntry {
  index: number;
  content: string;
}

interface MemoryData {
  memory: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    entries: MemoryEntry[];
    charCount: number;
    charLimit: number;
  };
  user: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    charCount: number;
    charLimit: number;
  };
  stats: { totalSessions: number; totalMessages: number };
}

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function CapacityBar({
  used,
  limit,
  label,
}: {
  used: number;
  limit: number;
  label: string;
}): React.JSX.Element {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color =
    pct > 90 ? "var(--error)" : pct > 70 ? "var(--warning)" : "var(--success)";
  return (
    <div className="memory-capacity">
      <div className="memory-capacity-header">
        <span className="memory-capacity-label">{label}</span>
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

interface MemoryProviderInfo {
  name: string;
  description: string;
  installed: boolean;
  active: boolean;
  envVars: string[];
}

const PROVIDER_URLS: Record<string, string> = {
  honcho: "https://app.honcho.dev",
  hindsight: "https://ui.hindsight.vectorize.io",
  mem0: "https://app.mem0.ai",
  retaindb: "https://retaindb.com",
  supermemory: "https://supermemory.ai",
  byterover: "https://app.byterover.dev",
};

function Memory({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"entries" | "profile" | "providers">(
    "entries",
  );
  const [error, setError] = useState("");
  const [memoryProvider, setMemoryProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([]);
  const [providerEnv, setProviderEnv] = useState<Record<string, string>>({});
  const [providerSavedKey, setProviderSavedKey] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);

  // Entry management
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // User profile editing
  const [userContent, setUserContent] = useState("");
  const [userEditing, setUserEditing] = useState(false);
  const [userSaved, setUserSaved] = useState(false);

  const loadData = useCallback(async () => {
    const [d, provider, provs, env] = await Promise.all([
      window.hermesAPI.readMemory(profile),
      window.hermesAPI.getConfig("memory.provider", profile),
      window.hermesAPI.discoverMemoryProviders(profile),
      window.hermesAPI.getEnv(profile),
    ]);
    setData(d as MemoryData);
    setUserContent(d.user.content);
    setMemoryProvider(provider);
    setProviders(provs);
    setProviderEnv(env);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  async function handleAddEntry(): Promise<void> {
    if (!newEntry.trim()) return;
    setError("");
    const result = await window.hermesAPI.addMemoryEntry(
      newEntry.trim(),
      profile,
    );
    if (result.success) {
      setNewEntry("");
      setShowAdd(false);
      await loadData();
    } else {
      setError(result.error || t("memory.addFailed"));
    }
  }

  async function handleSaveEdit(): Promise<void> {
    if (editingIndex === null) return;
    setError("");
    const result = await window.hermesAPI.updateMemoryEntry(
      editingIndex,
      editContent.trim(),
      profile,
    );
    if (result.success) {
      setEditingIndex(null);
      setEditContent("");
      await loadData();
    } else {
      setError(result.error || t("memory.updateFailed"));
    }
  }

  async function handleDeleteEntry(index: number): Promise<void> {
    await window.hermesAPI.removeMemoryEntry(index, profile);
    setConfirmDelete(null);
    await loadData();
  }

  async function handleSaveUserProfile(): Promise<void> {
    setError("");
    const result = await window.hermesAPI.writeUserProfile(
      userContent,
      profile,
    );
    if (result.success) {
      setUserEditing(false);
      setUserSaved(true);
      setTimeout(() => setUserSaved(false), 2000);
      await loadData();
    } else {
      setError(result.error || t("memory.saveFailed"));
    }
  }

  if (loading || !data) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("memory.title")}</h1>
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="memory-header">
        <div>
          <h1 className="settings-header" style={{ marginBottom: 4 }}>
            {t("memory.title")}
          </h1>
          <p className="memory-subtitle">{t("memory.subtitle")}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>
          <Refresh size={13} />
        </button>
      </div>

      {/* Stats */}
      <div className="memory-stats">
        <div className="memory-stat">
          <span className="memory-stat-value">{data.stats.totalSessions}</span>
          <span className="memory-stat-label">{t("memory.sessions")}</span>
        </div>
        <div className="memory-stat">
          <span className="memory-stat-value">{data.stats.totalMessages}</span>
          <span className="memory-stat-label">{t("memory.messages")}</span>
        </div>
        <div className="memory-stat">
          <span className="memory-stat-value">
            {data.memory.entries.length}
          </span>
          <span className="memory-stat-label">{t("memory.memories")}</span>
        </div>
      </div>

      {/* Capacity */}
      <div className="memory-capacities">
        <CapacityBar
          used={data.memory.charCount}
          limit={data.memory.charLimit}
          label={t("memory.agentMemory")}
        />
        <CapacityBar
          used={data.user.charCount}
          limit={data.user.charLimit}
          label={t("memory.userProfile")}
        />
      </div>

      {/* Tabs */}
      <div className="memory-tabs">
        <button
          className={`memory-tab ${tab === "entries" ? "active" : ""}`}
          onClick={() => setTab("entries")}
        >
          {t("memory.agentMemory")}
          {data.memory.lastModified && (
            <span className="memory-tab-time">
              {timeAgo(data.memory.lastModified)}
            </span>
          )}
        </button>
        <button
          className={`memory-tab ${tab === "profile" ? "active" : ""}`}
          onClick={() => setTab("profile")}
        >
          {t("memory.userProfile")}
          {data.user.lastModified && (
            <span className="memory-tab-time">
              {timeAgo(data.user.lastModified)}
            </span>
          )}
        </button>
        <button
          className={`memory-tab ${tab === "providers" ? "active" : ""}`}
          onClick={() => setTab("providers")}
        >
          {t("memory.providersTitle")}
          {memoryProvider && (
            <span className="memory-tab-time">{memoryProvider}</span>
          )}
        </button>
      </div>

      {error && <div className="memory-error">{error}</div>}

      {/* Agent Memory Entries */}
      {tab === "entries" && (
        <div className="memory-entries">
          <div className="memory-entries-header">
            <span className="memory-entries-count">
              {t("memory.entries", { count: data.memory.entries.length })}
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAdd(!showAdd)}
            >
              <Plus size={13} />
              {t("memory.addMemory")}
            </button>
          </div>

          {showAdd && (
            <div className="memory-entry-form">
              <textarea
                className="memory-entry-textarea"
                value={newEntry}
                onChange={(e) => setNewEntry(e.target.value)}
                placeholder={t("memory.entriesPlaceholder")}
                rows={3}
                autoFocus
              />
              <div className="memory-entry-form-actions">
                <span className="memory-entry-chars">
                  {newEntry.length} chars
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setShowAdd(false);
                    setNewEntry("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleAddEntry}
                  disabled={!newEntry.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {data.memory.entries.length === 0 ? (
            <div className="memory-empty">
              <p>
                {t("memory.noMemoriesYet")}
              </p>
              <p className="memory-empty-hint">
                {t("memory.addManuallyHint")}
              </p>
            </div>
          ) : (
            data.memory.entries.map((entry) => (
              <div key={entry.index} className="memory-entry-card">
                {editingIndex === entry.index ? (
                  <div className="memory-entry-form">
                    <textarea
                      className="memory-entry-textarea"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      autoFocus
                    />
                    <div className="memory-entry-form-actions">
                      <span className="memory-entry-chars">
                        {t("memory.chars", { count: editContent.length })}
                      </span>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditingIndex(null)}
                      >
                        {t("memory.cancel")}
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSaveEdit}
                      >
                        {t("memory.save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="memory-entry-content">{entry.content}</div>
                    <div className="memory-entry-actions">
                      <button
                        className="btn-ghost memory-entry-btn"
                        onClick={() => {
                          setEditingIndex(entry.index);
                          setEditContent(entry.content);
                        }}
                      >
                        {t("memory.edit")}
                      </button>
                      {confirmDelete === entry.index ? (
                        <span className="memory-entry-confirm">
                          {t("memory.deleteConfirm")}
                          <button
                            className="btn-ghost"
                            style={{ color: "var(--error)" }}
                            onClick={() => handleDeleteEntry(entry.index)}
                          >
                            {t("memory.yes")}
                          </button>
                          <button
                            className="btn-ghost"
                            onClick={() => setConfirmDelete(null)}
                          >
                            {t("memory.no")}
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn-ghost memory-entry-btn"
                          onClick={() => setConfirmDelete(entry.index)}
                        >
                          <Trash size={13} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* User Profile */}
      {tab === "profile" && (
        <div className="memory-profile">
          <div className="memory-profile-header">
            <span className="memory-profile-hint">
              {t("memory.userProfileHint")}
            </span>
            {userSaved && (
              <span
                style={{
                  color: "var(--success)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {t("common.saved")}
              </span>
            )}
          </div>
          <textarea
            className="memory-profile-textarea"
            value={userContent}
            onChange={(e) => {
              setUserContent(e.target.value);
              setUserEditing(true);
            }}
            placeholder={t("memory.userProfilePlaceholder")}
            rows={8}
          />
          <div className="memory-profile-footer">
            <span className="memory-entry-chars">
              {t("memory.chars", { count: userContent.length })} / {data.user.charLimit} {t("memory.chars", { count: 1 }).split(" ")[1]}
            </span>
            {userEditing && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveUserProfile}
              >
                {t("memory.saveProfile")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Memory Providers */}
      {tab === "providers" && (
        <div className="memory-providers">
          <div className="memory-providers-hint">
            {t("memory.providersHint")}
            {memoryProvider ? (
              <span dangerouslySetInnerHTML={{ __html: t("memory.providersHintActive", { provider: memoryProvider }) }} />
            ) : (
              <span> {t("memory.providersHintInactive")}</span>
            )}
          </div>

          {providers.length === 0 ? (
            <div className="memory-empty">
              <p>{t("memory.noProvidersFound")}</p>
            </div>
          ) : (
            <div className="memory-providers-grid">
              {providers.map((p) => (
                <div
                  key={p.name}
                  className={`memory-provider-card ${p.active ? "memory-provider-active" : ""}`}
                >
                  <div className="memory-provider-header">
                    <div className="memory-provider-name">
                      {p.name}
                      {p.active && (
                        <span className="memory-provider-badge">
                          <Check size={10} /> {t("memory.active")}
                        </span>
                      )}
                    </div>
                    {PROVIDER_URLS[p.name] && (
                      <button
                        className="btn-ghost"
                        style={{ padding: 2, opacity: 0.6 }}
                        onClick={() =>
                          window.hermesAPI.openExternal(PROVIDER_URLS[p.name])
                        }
                        title={t("memory.openProviderWebsite")}
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                  </div>
                  <div className="memory-provider-desc">{t(p.description)}</div>

                  {/* Env var config fields */}
                  {p.envVars.length > 0 && (
                    <div className="memory-provider-fields">
                      {p.envVars.map((envKey) => (
                        <div key={envKey} className="memory-provider-field">
                          <label className="memory-provider-field-label">
                            {envKey}
                            {providerSavedKey === envKey && (
                              <span
                                style={{
                                  color: "var(--success)",
                                  fontSize: 10,
                                  marginLeft: 6,
                                }}
                              >
                                {t("common.saved")}
                              </span>
                            )}
                          </label>
                          <input
                            className="input"
                            type="password"
                            value={providerEnv[envKey] || ""}
                            onChange={(e) =>
                              setProviderEnv((prev) => ({
                                ...prev,
                                [envKey]: e.target.value,
                              }))
                            }
                            onBlur={async () => {
                              await window.hermesAPI.setEnv(
                                envKey,
                                providerEnv[envKey] || "",
                                profile,
                              );
                              setProviderSavedKey(envKey);
                              setTimeout(() => setProviderSavedKey(null), 2000);
                            }}
                            placeholder={t("memory.enterEnvKey", { key: envKey })}
                            style={{ fontSize: 12 }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="memory-provider-actions">
                    {p.active ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                          setActivating(p.name);
                          await window.hermesAPI.setConfig(
                            "memory.provider",
                            "",
                            profile,
                          );
                          setMemoryProvider(null);
                          setProviders((prev) =>
                            prev.map((pr) => ({ ...pr, active: false })),
                          );
                          setActivating(null);
                        }}
                        disabled={activating !== null}
                      >
                        {t("memory.deactivate")}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          setActivating(p.name);
                          await window.hermesAPI.setConfig(
                            "memory.provider",
                            p.name,
                            profile,
                          );
                          setMemoryProvider(p.name);
                          setProviders((prev) =>
                            prev.map((pr) => ({
                              ...pr,
                              active: pr.name === p.name,
                            })),
                          );
                          setActivating(null);
                        }}
                        disabled={activating !== null}
                      >
                        {activating === p.name ? t("memory.activating") : t("memory.activate")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Memory;
