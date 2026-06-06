import { useState, useEffect, useCallback } from "react";
import { Refresh } from "../../assets/icons";
import {
  EditorSection,
  hookStatusText,
  type HookStatus,
  type MemoryFile,
} from "./parts";

interface PersonalizationProps {
  profile?: string;
  visible?: boolean;
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
