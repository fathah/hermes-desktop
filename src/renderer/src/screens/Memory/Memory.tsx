import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Refresh } from "../../assets/icons";
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
      setError(result.error || "Failed to add entry");
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
      setError(result.error || "Failed to update entry");
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
      setError(result.error || "Failed to save");
    }
  }

  if (loading || !data) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">Memory</h1>
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
            Memory
          </h1>
          <p className="memory-subtitle">
            What Hermes remembers about you and your environment across
            sessions.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>
          <Refresh size={13} />
        </button>
      </div>

      {/* Stats */}
      <div className="memory-stats">
        <div className="memory-stat">
          <span className="memory-stat-value">{data.stats.totalSessions}</span>
          <span className="memory-stat-label">Sessions</span>
        </div>
        <div className="memory-stat">
          <span className="memory-stat-value">{data.stats.totalMessages}</span>
          <span className="memory-stat-label">Messages</span>
        </div>
        <div className="memory-stat">
          <span className="memory-stat-value">
            {data.memory.entries.length}
          </span>
          <span className="memory-stat-label">Memories</span>
        </div>
      </div>

      {/* Capacity */}
      <div className="memory-capacities">
        <CapacityBar
          used={data.memory.charCount}
          limit={data.memory.charLimit}
          label="Agent Memory"
        />
        <CapacityBar
          used={data.user.charCount}
          limit={data.user.charLimit}
          label="User Profile"
        />
      </div>

      {/* Tabs */}
      <div className="memory-tabs">
        <button
          className={`memory-tab ${tab === "entries" ? "active" : ""}`}
          onClick={() => setTab("entries")}
        >
          Agent Memory
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
          User Profile
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
          Providers
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
              {data.memory.entries.length} entries
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAdd(!showAdd)}
            >
              <Plus size={13} />
              Add Memory
            </button>
          </div>

          {showAdd && (
            <div className="memory-entry-form">
              <textarea
                className="memory-entry-textarea"
                value={newEntry}
                onChange={(e) => setNewEntry(e.target.value)}
                placeholder="e.g. User prefers TypeScript over JavaScript. Always use strict mode."
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
                No memories yet. Hermes will save important facts as you chat.
              </p>
              <p className="memory-empty-hint">
                You can also add memories manually using the button above.
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
                        {editContent.length} chars
                      </span>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditingIndex(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSaveEdit}
                      >
                        Save
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
                        Edit
                      </button>
                      {confirmDelete === entry.index ? (
                        <span className="memory-entry-confirm">
                          Delete?
                          <button
                            className="btn-ghost"
                            style={{ color: "var(--error)" }}
                            onClick={() => handleDeleteEntry(entry.index)}
                          >
                            Yes
                          </button>
                          <button
                            className="btn-ghost"
                            onClick={() => setConfirmDelete(null)}
                          >
                            No
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
              Tell Hermes about yourself — name, role, preferences,
              communication style.
            </span>
            {userSaved && (
              <span
                style={{
                  color: "var(--success)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Saved
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
            placeholder="e.g. Name: Alex. Senior developer. Prefers concise answers. Uses macOS with zsh. Timezone: PST."
            rows={8}
          />
          <div className="memory-profile-footer">
            <span className="memory-entry-chars">
              {userContent.length} / {data.user.charLimit} chars
            </span>
            {userEditing && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveUserProfile}
              >
                Save Profile
              </button>
            )}
          </div>
        </div>
      )}

      {/* Memory Providers */}
      {tab === "providers" && (
        <div className="memory-providers">
          <div className="memory-providers-hint">
            Pluggable memory providers give Hermes advanced long-term memory.
            Built-in memory (above) is always active alongside the selected
            provider.
            {memoryProvider ? (
              <span>
                {" "}
                Active: <strong>{memoryProvider}</strong>
              </span>
            ) : (
              <span> No external provider active — using built-in only.</span>
            )}
          </div>

          {providers.length === 0 ? (
            <div className="memory-empty">
              <p>No memory providers found in this installation.</p>
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
                          <Check size={10} /> Active
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
                        title="Open provider website"
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                  </div>
                  <div className="memory-provider-desc">{p.description}</div>

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
                                Saved
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
                            placeholder={`Enter ${envKey}`}
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
                        Deactivate
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
                        {activating === p.name ? "Activating..." : "Activate"}
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
