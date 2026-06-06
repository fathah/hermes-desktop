import { useState, useEffect, useCallback } from "react";
import { Refresh } from "../../assets/icons";

interface PersonalizationProps {
  profile?: string;
  visible?: boolean;
}

interface HookStatus {
  configured: boolean;
  allowlisted: boolean;
  scriptExists: boolean;
  enabled: boolean;
}

// readMemory returns charLimit at runtime; the preload type omits it (Memory.tsx
// casts too), so narrow it here.
interface MemoryFile {
  content: string;
  charLimit: number;
}

type SaveResult = { success: boolean; error?: string };

/** One markdown file editor — mirrors MemoryProfile's textarea + footer idiom. */
function EditorSection({
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

function hookStatusText(status: HookStatus | null): string {
  if (!status) return "";
  if (status.enabled) {
    return "On — injecting today's date and your current focus into every chat.";
  }
  if (status.configured && !status.allowlisted) {
    return "Configured but not yet approved. Toggle on to grant consent.";
  }
  return "Off — the agent won't see the date/focus injection.";
}

function Personalization({
  profile,
  visible = true,
}: PersonalizationProps): React.JSX.Element {
  const [focus, setFocus] = useState("");
  const [user, setUser] = useState<MemoryFile>({
    content: "",
    charLimit: 2200,
  });
  const [memory, setMemory] = useState<MemoryFile>({
    content: "",
    charLimit: 2200,
  });
  const [hook, setHook] = useState<HookStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hookBusy, setHookBusy] = useState(false);
  const [hookError, setHookError] = useState("");

  const load = useCallback(async () => {
    const [mem, foc, hk] = await Promise.all([
      window.hermesAPI.readMemory(profile),
      window.hermesAPI.readFocus(),
      window.hermesAPI.getDailyContextHookStatus(profile),
    ]);
    const m = mem as unknown as { user: MemoryFile; memory: MemoryFile };
    setUser({ content: m.user.content, charLimit: m.user.charLimit ?? 2200 });
    setMemory({
      content: m.memory.content,
      charLimit: m.memory.charLimit ?? 2200,
    });
    setFocus(foc);
    setHook(hk);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    load();
  }, [load, visible]);

  async function toggleHook(enabled: boolean): Promise<void> {
    setHookBusy(true);
    setHookError("");
    const res = await window.hermesAPI.setDailyContextHookEnabled(
      enabled,
      profile,
    );
    if (!res.success) setHookError(res.error || "Failed to update hook");
    const hk = await window.hermesAPI.getDailyContextHookStatus(profile);
    setHook(hk);
    setHookBusy(false);
  }

  if (loading) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">Personalization</h1>
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
            Personalization
          </h1>
          <p className="memory-subtitle">
            Make the agent feel like yours — what it knows, how it responds, and
            the daily context it sees.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          <Refresh size={13} />
        </button>
      </div>

      <EditorSection
        title="Daily context (focus.md)"
        hint="Injected into every chat as 'Current focus'. Keep it to 1–3 lines — a sticky note, not a journal."
        value={focus}
        placeholder="e.g. India equities — defensive PSU basket; tracking macro/regime and tail-risk signals."
        onSave={(content) => window.hermesAPI.writeFocus(content)}
      />

      <EditorSection
        title="Persona & response style (USER.md)"
        hint="How the agent talks to you and your standing nudge-guardrails. Read every turn."
        value={user.content}
        charLimit={user.charLimit}
        placeholder="Who you are, how you want responses, and what to flag."
        onSave={(content) =>
          window.hermesAPI.writeUserProfile(content, profile)
        }
      />

      <EditorSection
        title="Durable facts (MEMORY.md)"
        hint="Long-term facts the agent should remember (entries are separated by a line containing only §)."
        value={memory.content}
        charLimit={memory.charLimit}
        placeholder="Durable facts, separated by § on their own line."
        onSave={(content) => window.hermesAPI.writeMemory(content, profile)}
      />

      <div className="settings-section">
        <div className="settings-section-title">Daily context hook</div>
        <div className="settings-field">
          <label className="settings-field-label">
            Inject date + focus into every chat
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={!!hook?.enabled}
                disabled={hookBusy}
                onChange={(e) => toggleHook(e.target.checked)}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">{hookStatusText(hook)}</div>
          {hookError && (
            <div className="memory-error" style={{ marginTop: 8 }}>
              {hookError}
            </div>
          )}
          <div className="settings-field-hint" style={{ marginTop: 4 }}>
            Takes effect on the next gateway restart (relaunch the app).
          </div>
        </div>
      </div>
    </div>
  );
}

export default Personalization;
