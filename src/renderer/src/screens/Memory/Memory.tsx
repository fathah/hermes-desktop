import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Refresh } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

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

function Memory({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"entries" | "profile">("entries");
  const [error, setError] = useState("");

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
    const d = await window.hermesAPI.readMemory(profile);
    setData(d as MemoryData);
    setUserContent(d.user.content);
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
    </div>
  );
}

export default Memory;
