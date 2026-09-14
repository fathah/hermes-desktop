import { useState } from "react";
import { Plus, Trash } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { MemoryEntry } from "./types";

interface MemoryEntriesProps {
  entries: MemoryEntry[];
  profile?: string;
  onRefresh: () => void;
}

export function MemoryEntries({
  entries,
  profile,
  onRefresh,
}: MemoryEntriesProps): React.JSX.Element {
  const { t } = useI18n();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [error, setError] = useState("");

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
      onRefresh();
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
      onRefresh();
    } else {
      setError(result.error || t("memory.updateFailed"));
    }
  }

  async function handleDeleteEntry(index: number): Promise<void> {
    await window.hermesAPI.removeMemoryEntry(index, profile);
    setConfirmDelete(null);
    onRefresh();
  }

  return (
    <div className="memory-entries">
      <div className="memory-entries-header">
        <span className="memory-entries-count">
          {t("memory.entries", { count: entries.length })}
        </span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowAdd(!showAdd)}
        >
          <Plus size={13} />
          {t("memory.addMemory")}
        </button>
      </div>

      {error && (
        <div className="memory-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

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
            <span className="memory-entry-chars">{newEntry.length} chars</span>
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

      {entries.length === 0 ? (
        <div className="memory-empty">
          <p>{t("memory.noMemoriesYet")}</p>
          <p className="memory-empty-hint">{t("memory.addManuallyHint")}</p>
        </div>
      ) : (
        entries.map((entry) => (
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
  );
}
