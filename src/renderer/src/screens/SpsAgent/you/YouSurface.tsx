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
import { MemoryTimeline } from "./MemoryTimeline";
import { SoulEditor } from "./SoulEditor";
import { MemoryProviders } from "./MemoryProviders";
import type { MemoryProviderInfo } from "./memoryProviderTypes";
import {
  parseUserMd,
  serializeUserMd,
  type Rule,
} from "../../../../../shared/userMd";
import { useStore } from "../store";
import { pageFromMarkdown } from "../editor/pageMarkdown";
import { blk } from "../lib/ids";

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
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([]);
  const [memoryProvider, setMemoryProvider] = useState<string | null>(null);
  const [providersAvailable, setProvidersAvailable] = useState(false);

  const selectPage = useStore((s) => s.selectPage);
  const makePage = useStore((s) => s.makePage);
  const setSurface = useStore((s) => s.setSurface);

  async function handleRunAudit() {
    setAuditing(true);
    setAuditError("");
    try {
      const res = await window.hermesAPI.runTelosAudit(profile);
      if (!res.success) {
        setAuditError(res.error || "Alignment audit failed.");
      } else if (res.markdown && res.title) {
        const { blocks } = pageFromMarkdown(res.markdown);
        const docBlocks = blocks.length ? blocks : [blk("p", "")];
        const pageId = makePage(
          {
            icon: "🔍",
            title: res.title,
            ingestedAt: Date.now(),
          },
          docBlocks,
          null,
        );
        selectPage(pageId);
        setSurface("doc");
      } else {
        setAuditError("Audit failed to generate content.");
      }
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Audit failed.");
    } finally {
      setAuditing(false);
    }
  }

  // The optional external memory backend is local-only; in remote/SSH mode the
  // provider IPC throws, so we self-hide that section rather than error the page.
  const loadProviders = useCallback(async () => {
    try {
      const [provs, active] = await Promise.all([
        window.hermesAPI.discoverMemoryProviders(profile),
        window.hermesAPI.getConfig("memory.provider", profile),
      ]);
      setProviders(provs);
      setMemoryProvider(active);
      setProvidersAvailable(true);
    } catch {
      setProvidersAvailable(false);
    }
  }, [profile]);

  const load = useCallback(async () => {
    const [mem, foc, hk] = await Promise.all([
      window.hermesAPI.readMemory(profile),
      window.hermesAPI.readFocus(),
      window.hermesAPI.getDailyContextHookStatus(profile),
    ]);
    const m = mem;
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
    void loadProviders();
  }, [profile, loadProviders]);

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
        <div className="settings-section-title">What the agent has learned</div>
        <p className="settings-field-hint" style={{ marginBottom: 12 }}>
          Memories the agent wrote as it learned about you, in the order it
          learned them. Each links to the session it likely came from — reject
          anything that doesn&apos;t belong.
        </p>
        <MemoryTimeline profile={profile} onRefresh={load} />
      </div>

      <div className="settings-section">
        <SoulEditor profile={profile} />
      </div>

      {providersAvailable && providers.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">Memory provider</div>
          <MemoryProviders
            providers={providers}
            activeProvider={memoryProvider}
            profile={profile}
            onRefresh={loadProviders}
          />
        </div>
      )}

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

      <div className="settings-section">
        <div className="settings-section-title">Telos Alignment Auditor</div>
        <div className="settings-field">
          <p className="settings-field-hint" style={{ marginBottom: 12 }}>
            Compare your recent vault file modifications against your core
            objectives in <strong>TELOS.md</strong> to audit alignment and
            generate a roadmap.
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleRunAudit}
            disabled={auditing}
            style={{ minWidth: 140 }}
          >
            {auditing ? "Auditing..." : "Run Alignment Audit"}
          </button>
          {auditError && (
            <div className="memory-error" style={{ marginTop: 8 }}>
              {auditError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
