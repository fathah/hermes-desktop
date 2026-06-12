import { useCallback, useEffect, useState } from "react";
import type {
  LearningProposal,
  SkillUsageEntry,
} from "../../../../../shared/learning";
import { MemoryTimeline } from "../you/MemoryTimeline";

type Tab = "memories" | "skills" | "curator";

interface SkillRow {
  name: string;
  category: string;
  description: string;
  path: string;
}

interface LocalSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  sourcePath: string;
}

export function LearningSurface({
  profile = "default",
}: {
  profile?: string;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("memories");
  const [proposals, setProposals] = useState<LearningProposal[]>([]);
  const [installed, setInstalled] = useState<SkillRow[]>([]);
  const [disabled, setDisabled] = useState<SkillRow[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [usage, setUsage] = useState<Record<string, SkillUsageEntry>>({});
  const [selectedSkill, setSelectedSkill] = useState<{
    name: string;
    content: string;
  } | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [curatorStatus, setCuratorStatus] = useState("");
  const [archived, setArchived] = useState<string[]>([]);
  const [manualSkill, setManualSkill] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const pendingMemories = proposals.filter(
    (p) => p.kind === "memory" && p.status === "pending",
  );
  const pendingSkills = proposals.filter(
    (p) => p.kind === "skill" && p.status === "pending",
  );

  const loadProposals = useCallback(async () => {
    setProposals(await window.hermesAPI.listLearningProposals(profile));
  }, [profile]);

  const loadSkills = useCallback(async () => {
    const [on, off, local, used] = await Promise.all([
      window.hermesAPI.listInstalledSkills(profile),
      window.hermesAPI.listDisabledSkills(profile),
      window.hermesAPI.discoverLocalSkills(profile).catch(() => []),
      window.hermesAPI.listSkillUsage(profile).catch(() => ({})),
    ]);
    setInstalled(on);
    setDisabled(off);
    setLocalSkills(local);
    setUsage(used);
  }, [profile]);

  const loadCurator = useCallback(async () => {
    const [status, rawArchived] = await Promise.all([
      window.hermesAPI.getCuratorStatus(profile).catch((err) => String(err)),
      window.hermesAPI.listArchivedSkills(profile).catch(() => ""),
    ]);
    setCuratorStatus(status || "No curator status returned.");
    setArchived(parseArchivedSkills(rawArchived));
  }, [profile]);

  useEffect(() => {
    void loadProposals();
    void loadSkills();
    void loadCurator();
  }, [loadProposals, loadSkills, loadCurator]);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(label);
    setNotice("");
    try {
      return await fn();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Action failed.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function accept(id: string): Promise<void> {
    await run("accept", () =>
      window.hermesAPI.acceptLearningProposal(id, profile),
    );
    await loadProposals();
    await loadSkills();
  }

  async function dismiss(id: string): Promise<void> {
    await run("dismiss", () =>
      window.hermesAPI.dismissLearningProposal(id, profile),
    );
    await loadProposals();
  }

  async function proposeMemory(): Promise<void> {
    const body = memoryDraft.trim();
    if (!body) return;
    const res = await run("memory", () =>
      window.hermesAPI.createLearningProposal(
        { kind: "memory", body, source: { type: "manual" } },
        profile,
      ),
    );
    if (res) {
      setMemoryDraft("");
      await loadProposals();
    }
  }

  async function createSkill(): Promise<void> {
    const name = skillName.trim();
    const body = skillBody.trim();
    if (!name || !body) return;
    const res = await run("create-skill", () =>
      window.hermesAPI.createSkill({
        name,
        description: skillDescription,
        body,
        profile,
      }),
    );
    if (res?.success) {
      setSkillName("");
      setSkillDescription("");
      setSkillBody("");
      await loadSkills();
    } else if (res) {
      setNotice(res.error || "Could not create skill.");
    }
  }

  async function generateDraft(): Promise<void> {
    const path = repoPath.trim();
    if (!path) return;
    const res = await run("generate", () =>
      window.hermesAPI.generateSkillFromRepo(path, profile),
    );
    if (!res?.success || !res.draft) {
      setNotice(res?.error || "Could not generate skill draft.");
      return;
    }
    await window.hermesAPI.createLearningProposal(
      {
        kind: "skill",
        draft: { ...res.draft, category: "custom" },
        source: { type: "repo", path },
      },
      profile,
    );
    setRepoPath("");
    await loadProposals();
  }

  async function viewSkill(skill: SkillRow): Promise<void> {
    const content = await run("view-skill", () =>
      window.hermesAPI.getSkillContent(skill.path),
    );
    if (typeof content === "string") setSelectedSkill({ name: skill.name, content });
  }

  async function toggleSkill(skill: SkillRow, enabled: boolean): Promise<void> {
    const res = await run("toggle-skill", () =>
      window.hermesAPI.setSkillEnabled(skill.path, enabled, profile),
    );
    if (res?.success) await loadSkills();
    else if (res) setNotice(res.error || "Could not update skill.");
  }

  async function importSkill(skill: LocalSkill): Promise<void> {
    const res = await run("import-skill", () =>
      window.hermesAPI.importLocalSkill(skill.sourcePath, skill.category, profile),
    );
    if (res?.success) await loadSkills();
    else if (res) setNotice(res.error || "Could not import skill.");
  }

  async function curatorAction(
    label: string,
    action: () => Promise<{ success: boolean; output: string }>,
  ): Promise<void> {
    const res = await run(label, action);
    if (res?.output) setNotice(res.output);
    await loadCurator();
  }

  return (
    <div className="settings-container">
      <header className="memory-header">
        <div>
          <h1 className="settings-header" style={{ marginBottom: 4 }}>
            Learn This
          </h1>
          <p className="memory-subtitle">
            Review what My Assistant should remember, which skills it can use,
            and what the curator has archived.
          </p>
        </div>
      </header>

      <div className="settings-subnav" style={{ marginBottom: 16 }}>
        {(["memories", "skills", "curator"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={`settings-subnav-tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {id === "memories" ? "Memories" : id === "skills" ? "Skills" : "Curator"}
          </button>
        ))}
      </div>

      {notice && (
        <div className="memory-error" style={{ marginBottom: 12 }}>
          {notice}
        </div>
      )}

      {tab === "memories" && (
        <MemoriesTab
          pending={pendingMemories}
          memoryDraft={memoryDraft}
          setMemoryDraft={setMemoryDraft}
          proposeMemory={proposeMemory}
          accept={accept}
          dismiss={dismiss}
          profile={profile}
          refresh={loadProposals}
          busy={busy}
        />
      )}
      {tab === "skills" && (
        <SkillsTab
          pending={pendingSkills}
          installed={installed}
          disabled={disabled}
          localSkills={localSkills}
          usage={usage}
          selectedSkill={selectedSkill}
          skillName={skillName}
          setSkillName={setSkillName}
          skillDescription={skillDescription}
          setSkillDescription={setSkillDescription}
          skillBody={skillBody}
          setSkillBody={setSkillBody}
          repoPath={repoPath}
          setRepoPath={setRepoPath}
          accept={accept}
          dismiss={dismiss}
          viewSkill={viewSkill}
          toggleSkill={toggleSkill}
          createSkill={createSkill}
          generateDraft={generateDraft}
          importSkill={importSkill}
          busy={busy}
        />
      )}
      {tab === "curator" && (
        <CuratorTab
          status={curatorStatus}
          archived={archived}
          manualSkill={manualSkill}
          setManualSkill={setManualSkill}
          busy={busy}
          runNow={() =>
            curatorAction("run-curator", () =>
              window.hermesAPI.runCuratorNow(profile),
            )
          }
          pause={() =>
            curatorAction("pause-curator", () =>
              window.hermesAPI.pauseCurator(profile),
            )
          }
          resume={() =>
            curatorAction("resume-curator", () =>
              window.hermesAPI.resumeCurator(profile),
            )
          }
          restore={(name) =>
            curatorAction(`restore-${name}`, () =>
              window.hermesAPI.restoreArchivedSkill(name, profile),
            )
          }
          pin={(name) =>
            curatorAction(`pin-${name}`, () =>
              window.hermesAPI.pinSkill(name, profile),
            )
          }
          unpin={(name) =>
            curatorAction(`unpin-${name}`, () =>
              window.hermesAPI.unpinSkill(name, profile),
            )
          }
        />
      )}
    </div>
  );
}

function MemoriesTab({
  pending,
  memoryDraft,
  setMemoryDraft,
  proposeMemory,
  accept,
  dismiss,
  profile,
  refresh,
  busy,
}: {
  pending: LearningProposal[];
  memoryDraft: string;
  setMemoryDraft: (value: string) => void;
  proposeMemory: () => void;
  accept: (id: string) => void;
  dismiss: (id: string) => void;
  profile: string;
  refresh: () => void;
  busy: string;
}): React.JSX.Element {
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-title">Pending memories</div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          Review facts before they become durable memory.
        </div>
        <textarea
          className="memory-entry-textarea"
          value={memoryDraft}
          onChange={(e) => setMemoryDraft(e.target.value)}
          placeholder="Add a fact My Assistant should remember."
          rows={2}
        />
        <div className="memory-entry-form-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={proposeMemory}
            disabled={busy === "memory" || !memoryDraft.trim()}
          >
            Propose memory
          </button>
        </div>
        {pending.length === 0 ? (
          <div className="memory-empty" style={{ marginTop: 10 }}>
            No pending memories.
          </div>
        ) : (
          <div className="you-rules-list" style={{ marginTop: 10 }}>
            {pending.map((p) => (
              <div key={p.id} className="memory-entry-card">
                <span className="memory-entry-content">
                  {p.kind === "memory" ? p.body : ""}
                  {p.kind === "memory" && p.reason && (
                    <small style={{ display: "block", opacity: 0.7 }}>
                      {p.reason}
                    </small>
                  )}
                </span>
                <button className="btn btn-primary btn-sm" onClick={() => accept(p.id)}>
                  Accept
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => dismiss(p.id)}>
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Learned memories</div>
        <MemoryTimeline profile={profile} onRefresh={refresh} />
      </section>
    </>
  );
}

function SkillsTab(props: {
  pending: LearningProposal[];
  installed: SkillRow[];
  disabled: SkillRow[];
  localSkills: LocalSkill[];
  usage: Record<string, SkillUsageEntry>;
  selectedSkill: { name: string; content: string } | null;
  skillName: string;
  setSkillName: (value: string) => void;
  skillDescription: string;
  setSkillDescription: (value: string) => void;
  skillBody: string;
  setSkillBody: (value: string) => void;
  repoPath: string;
  setRepoPath: (value: string) => void;
  accept: (id: string) => void;
  dismiss: (id: string) => void;
  viewSkill: (skill: SkillRow) => void;
  toggleSkill: (skill: SkillRow, enabled: boolean) => void;
  createSkill: () => void;
  generateDraft: () => void;
  importSkill: (skill: LocalSkill) => void;
  busy: string;
}): React.JSX.Element {
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-title">Pending skill drafts</div>
        {props.pending.length === 0 ? (
          <div className="memory-empty">No pending skill drafts.</div>
        ) : (
          props.pending.map((p) =>
            p.kind === "skill" ? (
              <div key={p.id} className="memory-entry-card">
                <span className="memory-entry-content">
                  <strong>{p.draft.name}</strong>
                  <small style={{ display: "block", opacity: 0.7 }}>
                    {p.draft.description}
                  </small>
                </span>
                <button className="btn btn-primary btn-sm" onClick={() => props.accept(p.id)}>
                  Accept
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => props.dismiss(p.id)}>
                  Dismiss
                </button>
              </div>
            ) : null,
          )
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Installed skills</div>
        {[...props.installed, ...props.disabled].map((skill) => {
          const enabled = props.installed.some((s) => s.path === skill.path);
          const usage = props.usage[skill.path];
          return (
            <div key={skill.path} className="memory-entry-card">
              <span className="memory-entry-content">
                <strong>{skill.name}</strong>
                <small style={{ display: "block", opacity: 0.7 }}>
                  {usageSummary(usage)}
                </small>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => props.viewSkill(skill)}>
                View
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => props.toggleSkill(skill, !enabled)}
              >
                {enabled ? "Disable" : "Enable"}
              </button>
            </div>
          );
        })}
        {props.selectedSkill && (
          <pre className="config-health-output" style={{ marginTop: 10 }}>
            {props.selectedSkill.content}
          </pre>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Create skill</div>
        <input
          className="inbox-input"
          aria-label="Skill name"
          placeholder="Skill name"
          value={props.skillName}
          onChange={(e) => props.setSkillName(e.target.value)}
        />
        <input
          className="inbox-input"
          aria-label="Skill description"
          placeholder="When should My Assistant use it?"
          value={props.skillDescription}
          onChange={(e) => props.setSkillDescription(e.target.value)}
        />
        <textarea
          className="memory-entry-textarea"
          aria-label="Skill body"
          placeholder="# Skill instructions"
          rows={5}
          value={props.skillBody}
          onChange={(e) => props.setSkillBody(e.target.value)}
        />
        <button className="btn btn-primary btn-sm" onClick={props.createSkill}>
          Create skill
        </button>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Generate from repo</div>
        <input
          className="inbox-input"
          aria-label="Repository path"
          placeholder="/path/to/repo"
          value={props.repoPath}
          onChange={(e) => props.setRepoPath(e.target.value)}
        />
        <button className="btn btn-primary btn-sm" onClick={props.generateDraft}>
          Generate draft
        </button>
      </section>

      {props.localSkills.length > 0 && (
        <section className="settings-section">
          <div className="settings-section-title">Import local skills</div>
          {props.localSkills.map((skill) => (
            <div key={skill.sourcePath} className="memory-entry-card">
              <span className="memory-entry-content">{skill.name}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => props.importSkill(skill)}>
                Import
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function CuratorTab({
  status,
  archived,
  manualSkill,
  setManualSkill,
  runNow,
  pause,
  resume,
  restore,
  pin,
  unpin,
}: {
  status: string;
  archived: string[];
  manualSkill: string;
  setManualSkill: (value: string) => void;
  busy: string;
  runNow: () => void;
  pause: () => void;
  resume: () => void;
  restore: (name: string) => void;
  pin: (name: string) => void;
  unpin: (name: string) => void;
}): React.JSX.Element {
  const clean = manualSkill.trim();
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-title">Curator status</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={runNow}>
            Run now
          </button>
          <button className="btn btn-secondary btn-sm" onClick={pause}>
            Pause
          </button>
          <button className="btn btn-secondary btn-sm" onClick={resume}>
            Resume
          </button>
        </div>
        <pre className="config-health-output">{status}</pre>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Archived skills</div>
        {archived.length === 0 ? (
          <div className="memory-empty">No archived skills found.</div>
        ) : (
          archived.map((name) => (
            <div key={name} className="memory-entry-card">
              <span className="memory-entry-content">{name}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => restore(name)}>
                Restore {name}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => pin(name)}>
                Pin
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => unpin(name)}>
                Unpin
              </button>
            </div>
          ))
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Manual skill action</div>
        <input
          className="inbox-input"
          aria-label="Skill to manage"
          placeholder="Skill name"
          value={manualSkill}
          onChange={(e) => setManualSkill(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" disabled={!clean} onClick={() => restore(clean)}>
            Restore
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!clean} onClick={() => pin(clean)}>
            Pin
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!clean} onClick={() => unpin(clean)}>
            Unpin
          </button>
        </div>
      </section>
    </>
  );
}

function usageSummary(usage?: SkillUsageEntry): string {
  if (!usage || (usage.loadCount === 0 && usage.injectedCount === 0))
    return "Never used";
  const loaded = `Loaded ${usage.loadCount} time${usage.loadCount === 1 ? "" : "s"}`;
  const used =
    usage.injectedCount > 0
      ? `used in chat ${usage.injectedCount} time${usage.injectedCount === 1 ? "" : "s"}`
      : "not used in chat yet";
  return `${loaded}; ${used}.`;
}

function parseArchivedSkills(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(line));
}
