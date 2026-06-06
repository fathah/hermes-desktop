// YouSurface.tsx — the in-workspace home for "make the agent feel like yours".
// Brings the personalization controls that previously lived only in the admin
// overlay (focus / persona / durable facts / daily-context hook) into the SPS
// workspace, and adds the structured "How I like things" rules list.
//
// This surface is the SINGLE owner of USER.md while open: persona prose and the
// rules list both derive from one in-memory state and persist through one
// serializer (serializeUserMd), so the two views can never clobber each other.
import { useCallback, useEffect, useState } from "react";
import {
  EditorSection,
  hookStatusText,
  type HookStatus,
  type MemoryFile,
  type SaveResult,
} from "../../Personalization/parts";
import { RulesManager } from "./RulesManager";
import {
  parseUserMd,
  serializeUserMd,
  type Rule,
} from "../../../../../shared/userMd";

interface YouSurfaceProps {
  profile?: string;
}

export function YouSurface({
  profile = "default",
}: YouSurfaceProps): React.JSX.Element {
  const [focus, setFocus] = useState("");
  const [prose, setProse] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [userCharLimit, setUserCharLimit] = useState(2200);
  const [memory, setMemory] = useState<MemoryFile>({
    content: "",
    charLimit: 2200,
  });
  const [hook, setHook] = useState<HookStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hookBusy, setHookBusy] = useState(false);
  const [hookError, setHookError] = useState("");
  const [rulesError, setRulesError] = useState("");

  const load = useCallback(async () => {
    const [mem, foc, hk] = await Promise.all([
      window.hermesAPI.readMemory(profile),
      window.hermesAPI.readFocus(),
      window.hermesAPI.getDailyContextHookStatus(profile),
    ]);
    const m = mem as unknown as { user: MemoryFile; memory: MemoryFile };
    const parsed = parseUserMd(m.user.content);
    setProse(parsed.prose);
    setRules(parsed.rules);
    setUserCharLimit(m.user.charLimit ?? 2200);
    setMemory({
      content: m.memory.content,
      charLimit: m.memory.charLimit ?? 2200,
    });
    setFocus(foc);
    setHook(hk);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // The one place USER.md is written. Refuses an over-budget save so the agent's
  // 2200-char USER.md window is never silently truncated.
  const persistUserMd = useCallback(
    async (nextProse: string, nextRules: Rule[]): Promise<SaveResult> => {
      const serialized = serializeUserMd(nextProse, nextRules);
      if (serialized.length > userCharLimit) {
        return {
          success: false,
          error: `Too long (${serialized.length}/${userCharLimit}). Shorten your note or a rule.`,
        };
      }
      const res = await window.hermesAPI.writeUserProfile(serialized, profile);
      if (res.success) {
        setProse(nextProse);
        setRules(nextRules);
      }
      return res;
    },
    [profile, userCharLimit],
  );

  async function handleRulesChange(next: Rule[]): Promise<void> {
    setRulesError("");
    const res = await persistUserMd(prose, next);
    if (!res.success) setRulesError(res.error || "Couldn't save rules");
  }

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
        <h1 className="settings-header">You</h1>
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
            You
          </h1>
          <p className="memory-subtitle">
            Teach the agent how you think — what it knows, how it responds, and
            the standing rules it follows. Everything here is yours to edit or
            turn off.
          </p>
        </div>
      </div>

      <RulesManager rules={rules} onChange={handleRulesChange} />
      {rulesError && (
        <div className="memory-error" style={{ margin: "0 0 12px" }}>
          {rulesError}
        </div>
      )}

      <EditorSection
        title="About you & response style"
        hint="Who you are and how you want the agent to talk to you. Read every turn. (Shares the 2200-char budget with your rules.)"
        value={prose}
        charLimit={userCharLimit}
        placeholder="e.g. Defensive equity investor. Be blunt, lead with the answer, flag tail risks."
        onSave={(content) => persistUserMd(content, rules)}
      />

      <EditorSection
        title="Today's focus"
        hint="A sticky note injected into every chat as 'Current focus'. Keep it to 1–3 lines."
        value={focus}
        placeholder="e.g. India equities — defensive PSU basket; tracking macro/regime and tail-risk signals."
        onSave={(content) => window.hermesAPI.writeFocus(content)}
      />

      <EditorSection
        title="What the agent remembers (durable facts)"
        hint="Long-term facts the agent should keep in mind (entries separated by a line containing only §)."
        value={memory.content}
        charLimit={memory.charLimit}
        placeholder="Durable facts, separated by § on their own line."
        onSave={(content) => window.hermesAPI.writeMemory(content, profile)}
      />

      <div className="settings-section">
        <div className="settings-section-title">Daily context</div>
        <div className="settings-field">
          <label className="settings-field-label">
            Inject today&apos;s date + focus into every chat
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
