// CockpitSurface.tsx — the customizable "cockpit" home dashboard. An ordered set
// of widgets the user arranges (drag to reorder, 1×/2× width, add/remove). Layout
// lives in the cockpit store slice (localStorage); each widget reads live store
// state. Dependency-free: a CSS grid + HTML5 drag, no react-grid-layout.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/iconPaths";
import { useStore } from "../store";
import type { WidgetKind } from "../store/storeTypes";
import { OPERATOR_GUIDE } from "../../../lib/operatorGuide";

const WIDGET_META: Record<WidgetKind, { title: string; icon: IconName }> = {
  quick: { title: "Quick actions", icon: "wand" },
  glance: { title: "At a glance", icon: "board" },
  notes: { title: "Pinned notes", icon: "comment" },
  pages: { title: "Jump to a page", icon: "doc" },
  ask: { title: "Ask your assistant", icon: "sparkle" },
  recentChats: { title: "Recent chats", icon: "comment" },
  today: { title: "Today", icon: "calendar" },
  agent: { title: "Agent status", icon: "code" },
  guide: { title: "Operator guide", icon: "checkbox" },
  pulse: { title: "Pulse Dashboard", icon: "sparkle" },
};

export function CockpitSurface() {
  const cockpit = useStore((s) => s.cockpit);
  const reorder = useStore((s) => s.reorderCockpit);
  const setSpan = useStore((s) => s.setCockpitSpan);
  const remove = useStore((s) => s.removeCockpitWidget);
  const add = useStore((s) => s.addCockpitWidget);
  const reset = useStore((s) => s.resetCockpit);
  const [drag, setDrag] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const present = new Set(cockpit.map((w) => w.kind));
  const available = (Object.keys(WIDGET_META) as WidgetKind[]).filter(
    (k) => !present.has(k),
  );

  return (
    <div className="ck-wrap">
      <div className="ck-head">
        <div>
          <h1 className="ck-title">Cockpit</h1>
          <div className="ck-sub">
            Your at-a-glance home. Drag to rearrange, resize, or add widgets.
          </div>
        </div>
        <div className="ck-head-actions">
          <div style={{ position: "relative" }}>
            <button
              className="ck-btn"
              onClick={() => setAddOpen((v) => !v)}
              disabled={!available.length}
            >
              <Icon name="plus" size={15} /> Add widget
            </button>
            {addOpen && available.length > 0 && (
              <>
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 63 }}
                  onMouseDown={() => setAddOpen(false)}
                />
                <div
                  className="menu"
                  style={{ right: 0, top: 36, zIndex: 64, minWidth: 200 }}
                >
                  {available.map((k) => (
                    <div
                      key={k}
                      className="menu-mini"
                      onClick={() => {
                        add(k);
                        setAddOpen(false);
                      }}
                    >
                      <Icon name={WIDGET_META[k].icon} size={15} />{" "}
                      {WIDGET_META[k].title}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            className="ck-btn ghost"
            onClick={reset}
            title="Reset to the default layout"
          >
            <Icon name="return" size={15} /> Reset
          </button>
        </div>
      </div>

      {cockpit.length === 0 ? (
        <div className="ck-empty-surface">
          No widgets yet. Click “Add widget” to build your cockpit.
        </div>
      ) : (
        <div className="ck-grid">
          {cockpit.map((w, i) => (
            <div
              key={`${w.kind}-${i}`}
              className={`ck-card span-${w.span} ${drag === i ? "dragging" : ""}`}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null) reorder(drag, i);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <div className="ck-card-head">
                <span className="ck-drag" title="Drag to rearrange">
                  <Icon name="grip" size={14} />
                </span>
                <Icon name={WIDGET_META[w.kind].icon} size={14} />
                <span className="ck-card-title">
                  {WIDGET_META[w.kind].title}
                </span>
                <span className="ck-card-controls">
                  <button
                    className="ck-span"
                    title={
                      w.span === 1 ? "Widen to 2 columns" : "Narrow to 1 column"
                    }
                    onClick={() => setSpan(i, w.span === 1 ? 2 : 1)}
                  >
                    {w.span === 1 ? "1×" : "2×"}
                  </button>
                  <button title="Remove widget" onClick={() => remove(i)}>
                    <Icon name="x" size={13} />
                  </button>
                </span>
              </div>
              <div className="ck-card-body">
                <Widget kind={w.kind} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Widget({ kind }: { kind: WidgetKind }) {
  switch (kind) {
    case "quick":
      return <QuickActions />;
    case "glance":
      return <Glance />;
    case "notes":
      return <PinnedNotes />;
    case "pages":
      return <JumpPages />;
    case "ask":
      return <AskWidget />;
    case "recentChats":
      return <RecentChats />;
    case "today":
      return <Today />;
    case "agent":
      return <AgentStatus />;
    case "guide":
      return <OperatorGuideWidget />;
    case "pulse":
      return <PulseWidget />;
  }
}

function QuickActions() {
  const startNewChat = useStore((s) => s.startNewChat);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setSurface = useStore((s) => s.setSurface);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const actions: { label: string; icon: IconName; on: () => void }[] = [
    { label: "New chat", icon: "sparkle", on: () => startNewChat() },
    {
      label: "New page",
      icon: "plus",
      on: () => setTemplatesOpen({ parent: null }),
    },
    { label: "Ask", icon: "wand", on: () => setSurface("ask") },
    { label: "Search", icon: "search", on: () => setPaletteOpen(true) },
  ];
  return (
    <div className="ck-quick">
      {actions.map((a) => (
        <button key={a.label} className="ck-quick-btn" onClick={a.on}>
          <Icon name={a.icon} size={16} />
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function Glance() {
  const meta = useStore((s) => s.meta);
  const comments = useStore((s) => s.comments);
  const userTemplates = useStore((s) => s.userTemplates);
  const stats: [string, number][] = [
    ["Pages", Object.keys(meta).length],
    ["Notes", comments.length],
    ["Templates", userTemplates.length],
  ];
  return (
    <div className="ck-stats">
      {stats.map(([label, n]) => (
        <div key={label} className="ck-stat">
          <div className="n">{n}</div>
          <div className="l">{label}</div>
        </div>
      ))}
    </div>
  );
}

function PinnedNotes() {
  const comments = useStore((s) => s.comments);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const open = comments.filter((c) => !c.resolved).slice(0, 6);
  if (!open.length)
    return (
      <div className="ck-empty">
        No pinned notes yet. Select text on a page and add a note.
      </div>
    );
  return (
    <div className="ck-list">
      {open.map((c) => {
        const body = c.messages
          .map((m) => m.text)
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={c.id}
            className="ck-row"
            onClick={() => {
              if (c.page) selectPage(c.page);
              setSurface("doc");
            }}
          >
            {c.quote && <span className="ck-row-q">“{c.quote}”</span>}
            <span className="ck-row-t">{body || "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

function JumpPages() {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const items = tree.filter((n) => !meta[n.id]?.journal).slice(0, 8);
  if (!items.length) return <div className="ck-empty">No pages yet.</div>;
  return (
    <div className="ck-list">
      {items.map((n) => (
        <button
          key={n.id}
          className="ck-row ck-row-page"
          onClick={() => {
            selectPage(n.id);
            setSurface("doc");
          }}
        >
          <span className="ck-row-ic">{meta[n.id]?.icon || "📄"}</span>
          {meta[n.id]?.title || "Untitled"}
        </button>
      ))}
    </div>
  );
}

function AskWidget() {
  const startNewChat = useStore((s) => s.startNewChat);
  const [q, setQ] = useState("");
  const go = (): void => {
    const text = q.trim();
    if (!text) return;
    startNewChat(text);
    setQ("");
  };
  return (
    <div className="ck-ask">
      <textarea
        rows={2}
        placeholder="Ask your assistant anything…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            go();
          }
        }}
      />
      <button className="ck-ask-go" onClick={go} disabled={!q.trim()}>
        <Icon name="send" size={15} /> Start chat
      </button>
    </div>
  );
}

interface SessionRow {
  id: string;
  title: string | null;
  preview: string;
}

function RecentChats() {
  const setSurface = useStore((s) => s.setSurface);
  const setActiveChatSession = useStore((s) => s.setActiveChatSession);
  const startNewChat = useStore((s) => s.startNewChat);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.listSessions) return;
    api
      .listSessions(6, 0)
      .then((rows) => {
        if (!cancelled) setSessions((rows as SessionRow[]).slice(0, 6));
      })
      .catch(() => {
        /* offline / no gateway — leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const open = (id: string): void => {
    setSurface("chats");
    setActiveChatSession(id);
  };
  if (!sessions.length)
    return (
      <div className="ck-empty">
        No recent chats.{" "}
        <button className="ck-inline-link" onClick={() => startNewChat()}>
          Start one
        </button>
        .
      </div>
    );
  return (
    <div className="ck-list">
      {sessions.map((sn) => (
        <button key={sn.id} className="ck-row" onClick={() => open(sn.id)}>
          <span className="ck-row-t">{sn.title || "Untitled chat"}</span>
          {sn.preview && <span className="ck-row-q">{sn.preview}</span>}
        </button>
      ))}
    </div>
  );
}

function Today() {
  const openJournal = useStore((s) => s.openJournal);
  // Renderer context — new Date() is fine here (the no-clock rule is workflow-only).
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const date = now.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div className="ck-today">
      <div className="ck-today-day">{weekday}</div>
      <div className="ck-today-date">{date}</div>
      <button className="ck-today-go" onClick={() => openJournal()}>
        <Icon name="calendar" size={14} /> Open today’s journal
      </button>
    </div>
  );
}

interface AgentInfo {
  name: string;
  model: string;
  running: boolean;
}

function AgentStatus() {
  const setSurface = useStore((s) => s.setSurface);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.listProfiles) return;
    api
      .listProfiles()
      .then((rows) => {
        const active = rows.find((r) => r.isActive) ?? rows[0];
        if (active && !cancelled)
          setInfo({
            name: active.name,
            model: active.model,
            running: active.gatewayRunning,
          });
      })
      .catch(() => {
        /* offline — leave null */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!info)
    return (
      <div className="ck-empty">
        No agent connected.{" "}
        <button
          className="ck-inline-link"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("hermes:open-settings"))
          }
        >
          Set one up
        </button>
        .
      </div>
    );
  return (
    <button className="ck-agent" onClick={() => setSurface("agent")}>
      <span className={`ck-agent-dot ${info.running ? "on" : ""}`} />
      <span className="ck-agent-body">
        <span className="ck-agent-name">{info.name}</span>
        <span className="ck-agent-meta">
          {info.model} · {info.running ? "running" : "stopped"}
        </span>
      </span>
    </button>
  );
}

function OperatorGuideWidget() {
  // Surface the most-used checklist (daily ops) inline; the full guide —
  // automation-trust + skill-install checklists — prints via `/guide` in chat.
  const daily = OPERATOR_GUIDE[0];
  return (
    <div className="ck-guide">
      <div className="ck-guide-head">{daily.title}</div>
      <ul className="ck-guide-list">
        {daily.items.map((item) => (
          <li key={item} className="ck-guide-item">
            <Icon name="checkbox" size={13} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className="ck-guide-foot">
        Type <code>/guide</code> in chat for the automation &amp; skill-install
        checklists.
      </div>
    </div>
  );
}

function PulseWidget() {
  const [focus, setFocus] = useState("");
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusInput, setFocusInput] = useState("");
  const meta = useStore((s) => s.meta);
  const docs = useStore((s) => s.docs);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const makePage = useStore((s) => s.makePage);
  const flash = useStore((s) => s.flash);

  useEffect(() => {
    window.hermesAPI.readFocus().then((f) => {
      setFocus(f);
      setFocusInput(f);
    });
  }, []);

  const saveFocus = async () => {
    const res = await window.hermesAPI.writeFocus(focusInput);
    if (res.success) {
      setFocus(focusInput);
      setEditingFocus(false);
      flash("Daily Focus updated");
    } else {
      flash(res.error || "Failed to save focus", { tone: "warn" });
    }
  };

  // Find TELOS page
  const telosPageId = Object.keys(meta).find(
    (id) => meta[id]?.title?.toUpperCase() === "TELOS" || meta[id]?.title?.toUpperCase() === "TELOS.MD"
  );

  const createTelosPage = () => {
    const initialTelosBlocks = [
      { id: "b1", type: "h2", text: "Mission" },
      { id: "b2", type: "p", text: "To align efforts, optimize focus, and build systems that magnify potential." },
      { id: "b3", type: "h2", text: "Goals" },
      { id: "b4", type: "todo", text: "Define core life priorities.", done: false },
      { id: "b5", type: "todo", text: "Verify local Hermes models are running at peak throughput.", done: false },
      { id: "b6", type: "h2", text: "KPIs" },
      { id: "b7", type: "li", text: "Daily focused hours: 4+" },
      { id: "b8", type: "li", text: "Weekly active sprint tasks completed: 85%+" },
      { id: "b9", type: "h2", text: "Problems" },
      { id: "b10", type: "li", text: "Information fragmentation across tabs." },
    ] as any[];

    const id = makePage({ icon: "🎯", title: "TELOS" }, initialTelosBlocks, null);
    selectPage(id);
    setSurface("doc");
    flash("TELOS page created in your vault!");
  };

  const telosData = { mission: "", goals: [] as string[], kpis: [] as string[], problems: [] as string[] };
  if (telosPageId) {
    const blocks = docs[telosPageId] || [];
    let currentSection: "mission" | "goals" | "kpis" | "problems" | null = null;
    for (const b of blocks) {
      if (b.type === "h1" || b.type === "h2" || b.type === "h3") {
        const heading = b.text.toLowerCase();
        if (heading.includes("mission")) {
          currentSection = "mission";
        } else if (heading.includes("goal")) {
          currentSection = "goals";
        } else if (heading.includes("kpi")) {
          currentSection = "kpis";
        } else if (heading.includes("problem")) {
          currentSection = "problems";
        } else {
          currentSection = null;
        }
      } else if (b.text.trim()) {
        if (currentSection === "mission") {
          telosData.mission += (telosData.mission ? "\n" : "") + b.text;
        } else if (currentSection === "goals") {
          telosData.goals.push(b.text);
        } else if (currentSection === "kpis") {
          telosData.kpis.push(b.text);
        } else if (currentSection === "problems") {
          telosData.problems.push(b.text);
        }
      }
    }
  }

  return (
    <div className="ck-pulse">
      {/* Daily Focus Section */}
      <div className="ck-pulse-section">
        <div className="ck-pulse-title-row">
          <span className="ck-pulse-sect-title">Daily Focus</span>
          {!editingFocus ? (
            <button className="ck-pulse-link-btn" onClick={() => setEditingFocus(true)}>Edit</button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ck-pulse-link-btn" onClick={saveFocus}>Save</button>
              <button className="ck-pulse-link-btn cancel" onClick={() => { setFocusInput(focus); setEditingFocus(false); }}>Cancel</button>
            </div>
          )}
        </div>
        {!editingFocus ? (
          <p className="ck-pulse-focus-text">{focus || "No daily focus set. Click Edit to focus your day."}</p>
        ) : (
          <textarea
            className="ck-pulse-focus-input"
            value={focusInput}
            onChange={(e) => setFocusInput(e.target.value)}
            rows={2}
            placeholder="Focusing on..."
          />
        )}
      </div>

      <div style={{ borderBottom: "1px solid var(--border-color)", margin: "12px 0" }} />

      {/* Telos Alignment Section */}
      <div className="ck-pulse-section">
        {telosPageId ? (
          <div>
            <div className="ck-pulse-title-row">
              <span className="ck-pulse-sect-title">Mission</span>
              <button
                className="ck-pulse-link-btn"
                onClick={() => {
                  selectPage(telosPageId);
                  setSurface("doc");
                }}
              >
                Go to TELOS
              </button>
            </div>
            <p className="ck-pulse-mission-text">
              {telosData.mission || "No mission statement written yet."}
            </p>
            
            {telosData.goals.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <span className="ck-pulse-sect-title">Key Goals</span>
                <ul className="ck-pulse-list" style={{ marginTop: 6, paddingLeft: 16, listStyleType: "disc" }}>
                  {telosData.goals.slice(0, 3).map((goal, idx) => (
                    <li key={idx} className="ck-pulse-item" style={{ marginBottom: 4 }}>{goal}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="ck-pulse-empty">
            <p>No <code>TELOS.md</code> found in your vault. Create one to track your mission, goals, and KPIs.</p>
            <button className="ck-btn" onClick={createTelosPage} style={{ marginTop: 8 }}>
              <Icon name="plus" size={14} /> Initialize TELOS.md
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
