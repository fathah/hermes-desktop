// parts.tsx — shared building blocks for the personalization surfaces. Used by
// the admin Personalization screen (overlay) and the in-workspace "You" surface
// (SpsAgent/you/YouSurface). Kept dependency-free (no IPC) so both can reuse it.
import { useState, useEffect } from "react";

export interface HookStatus {
  configured: boolean;
  allowlisted: boolean;
  scriptExists: boolean;
  enabled: boolean;
}

// readMemory returns charLimit at runtime; the preload type omits it, so callers
// narrow it to this shape.
export interface MemoryFile {
  content: string;
  charLimit: number;
}

export type SaveResult = { success: boolean; error?: string };

/** One markdown file editor — textarea + char-count footer + save-on-edit. */
export function EditorSection({
  title,
  hint,
  value,
  charLimit,
  placeholder,
  onSave,
}: {
  title: string;
  hint: string;
  value: string;
  charLimit?: number;
  placeholder?: string;
  onSave: (content: string) => Promise<SaveResult>;
}): React.JSX.Element {
  const [val, setVal] = useState(value);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setVal(value);
    setEditing(false);
  }, [value]);

  const over = charLimit != null && val.length > charLimit;

  async function handleSave(): Promise<void> {
    setError("");
    const result = await onSave(val);
    if (result.success) {
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError(result.error || "Save failed");
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        {title}
        {saved && (
          <span className="settings-saved" style={{ marginLeft: 8 }}>
            Saved
          </span>
        )}
      </div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 8 }}>
          {hint}
        </div>
        {error && (
          <div className="memory-error" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        <textarea
          className="memory-profile-textarea"
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            setEditing(true);
          }}
          placeholder={placeholder}
          rows={6}
        />
        <div className="memory-profile-footer">
          <span className={over ? "memory-error" : "memory-entry-chars"}>
            {val.length}
            {charLimit != null ? ` / ${charLimit}` : ""} chars
          </span>
          {editing && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={over}
            >
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Plain-English status line for the daily-context hook toggle. */
export function hookStatusText(status: HookStatus | null): string {
  if (!status) return "";
  if (status.enabled) {
    return "On — injecting today's date and your current focus into every chat.";
  }
  if (status.configured && !status.allowlisted) {
    return "Configured but not yet approved. Toggle on to grant consent.";
  }
  return "Off — the agent won't see the date/focus injection.";
}
