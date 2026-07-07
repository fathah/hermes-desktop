// AgentBody.tsx — assistant chat panel (messages, suggestion chips, composer).
// Ported from agent.jsx AgentBody; reads/acts through the store.
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { scrollToProposal } from "../lib/scroll";
import { useDictation } from "../hooks/useDictation";
import {
  getGroundInWorkspace,
  setGroundInWorkspace,
} from "../../../lib/grounding";
import { useChatSkills, slugifySkill } from "../../../lib/useChatSkills";
import { ActiveSkillChips } from "../../../components/ActiveSkillChips";
import { ApprovalQueue } from "../../Chat/ApprovalQueue";
import { contextChipLabel } from "./contextChip";
import type { AgentMessage } from "./types";

// Slash tokens the SPS composer already routes to its own prompt builders — a
// skill must never shadow these (see store.runAgent).
const SPS_RESERVED_SLASH = ["/plan", "/work", "/research"];

function getPlainEnglishExplanation(m: {
  sshAction?: { action?: string };
  configAction?: { provider?: string };
}): string {
  if (m.sshAction) {
    const act = m.sshAction.action;
    if (act === "start") {
      return "I need your permission to start a secure, private network connection to your remote server so we can use its artificial intelligence model. This connection is private and does not expose your local files to the public internet.";
    } else {
      return "I need your permission to stop the secure, private connection to your remote server.";
    }
  }
  if (m.configAction) {
    const prov = m.configAction.provider ?? "";
    return `I need your permission to save your API key for ${prov.toUpperCase()}. This will allow the assistant to securely communicate with the model provider. The key will be stored locally on your hard drive.`;
  }
  return "";
}

export function AgentBody() {
  // Parallel conversations (M3 #5): the panel renders the ACTIVE tab; each tab is
  // an independent run so several can stream at once.
  const conversations = useStore((s) => s.conversations);
  const activeConvId = useStore((s) => s.activeConvId);
  const newConversation = useStore((s) => s.newConversation);
  const selectConversation = useStore((s) => s.selectConversation);
  const closeConversation = useStore((s) => s.closeConversation);
  const active =
    conversations.find((c) => c.id === activeConvId) ?? conversations[0];
  const messages = active.messages;
  const thinking = active.thinking;
  const onSend = useStore((s) => s.runAgent);
  const onApplyDb = useStore((s) => s.applyDbAction);
  const onDismissDb = useStore((s) => s.dismissDbAction);
  const onApplySsh = useStore((s) => s.applySshAction);
  const onApplyConfig = useStore((s) => s.applyConfigAction);
  const fileAnswerToWiki = useStore((s) => s.fileAnswerToWiki);
  const flash = useStore((s) => s.flash);
  const workApprovals = useStore((s) => s.workApprovals);
  const workApprovalTimeout = useStore((s) => s.workApprovalTimeout);
  const workApprovalNow = useStore((s) => s.workApprovalNow);
  const respondWorkApproval = useStore((s) => s.respondWorkApproval);
  const tickWorkApprovalTimeouts = useStore((s) => s.tickWorkApprovalTimeouts);

  const [val, setVal] = useState("");
  // Trust chips are dismissable per-message (the user can hide "used your …").
  const [dismissedChips, setDismissedChips] = useState<Set<string>>(new Set());
  // Query-that-compounds: per-message filing state for "Save to wiki".
  const [filing, setFiling] = useState<Set<string>>(new Set());
  const [filed, setFiled] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally left outside React Compiler memoization.
  const messageVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => 128,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  // `/skill-name` loading. SPS is single-profile, so profile is left undefined —
  // the main process resolves it the same way the SPS send path does, so the
  // active set the assistant shows matches what gets injected.
  const skills = useChatSkills({
    profile: undefined,
    reservedSlashNames: SPS_RESERVED_SLASH,
  });
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);

  // Menu entries: each installed skill as `/<slug>`, plus the generic verbs.
  const slashEntries = (() => {
    if (!slashOpen) return [] as Array<{ token: string; label: string }>;
    const needle = val.toLowerCase();
    const base: Array<{ token: string; label: string }> = [
      { token: "/skill", label: "Load a skill by name" },
      { token: "/unload", label: "Unload a loaded skill" },
    ];
    const skillItems = skills.installed
      .map((s) => ({ slug: slugifySkill(s.name), name: s.name }))
      .filter(({ slug }) => slug && !SPS_RESERVED_SLASH.includes(`/${slug}`))
      .map(({ slug, name }) => ({ token: `/${slug}`, label: name }));
    return [...base, ...skillItems].filter((e) =>
      e.token.toLowerCase().startsWith(needle),
    );
  })();

  const runSkillCommand = async (text: string): Promise<void> => {
    const msg = await skills.run(text);
    if (msg) flash(msg.replace(/\*\*/g, ""));
  };

  const dismissChip = (id: string): void => {
    setDismissedChips((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const onFileToWiki = async (id: string): Promise<void> => {
    setFiling((prev) => new Set(prev).add(id));
    const res = await fileAnswerToWiki(id);
    setFiling((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (res.ok) {
      setFiled((prev) => new Set(prev).add(id));
      const n = res.pages ?? 1;
      flash(`Filed to wiki — ${n} page${n === 1 ? "" : "s"}`);
    } else {
      flash(res.error ?? "Couldn't file to wiki", { tone: "warn" });
    }
  };

  // Grounding toggle: the co-author reads getGroundInWorkspace() at send time
  // (via BridgeAssistant), so this just persists the shared preference — the
  // same one the Chat header controls. No prop threading needed.
  const [grounded, setGrounded] = useState(getGroundInWorkspace());
  const toggleGrounding = (): void => {
    const next = !grounded;
    setGrounded(next);
    setGroundInWorkspace(next);
    flash(
      next
        ? "Grounding on — answers use your workspace"
        : "Grounding off — answers ignore your workspace",
    );
  };

  useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, thinking]);

  useEffect(() => {
    if (workApprovalTimeout <= 0 || workApprovals.queue.length === 0) return;
    const tick = (): void => tickWorkApprovalTimeouts(Date.now());
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [
    tickWorkApprovalTimeouts,
    workApprovalTimeout,
    workApprovals.queue.length,
  ]);

  const clearComposer = (): void => {
    setVal("");
    setSlashOpen(false);
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const pickSlash = (token: string): void => {
    // Skill slugs load immediately; the arg-taking verbs wait for the name.
    if (token === "/skill" || token === "/unload") {
      setVal(token + " ");
      setSlashOpen(false);
      taRef.current?.focus();
      return;
    }
    void runSkillCommand(token);
    clearComposer();
  };

  const submit = () => {
    const v = val.trim();
    if (!v) return;
    // `/skill <name>`, `/unload [name]`, or a bare `/<skill-slug>` — load/unload
    // instead of sending to the model. Falls through for everything else.
    if (skills.match(v)) {
      void runSkillCommand(v);
      clearComposer();
      return;
    }
    onSend(v);
    clearComposer();
  };
  const grow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    const next = ta.value;
    setVal(next);
    const opening = next.startsWith("/") && !next.includes(" ");
    setSlashOpen(opening);
    setSlashIdx(0);
  };
  // Voice dictation (M3 #4): append recognized speech to the composer.
  const dictation = useDictation((text) => {
    setVal((v) => (v ? `${v} ${text}` : text));
    taRef.current?.focus();
  });

  const renderMessage = (m: AgentMessage): React.JSX.Element => (
    <div className={`msg ${m.role}`}>
      <span className="who">
        {m.role === "user" ? "You" : <Icon name="sparkle" size={13} />}
      </span>
      <div className="bubble">
        {m.text.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
        {m.context &&
          !dismissedChips.has(m.id) &&
          contextChipLabel(m.context) && (
            <div
              className="ctx-chip"
              title="This reply was grounded in your own workspace — your standing rules, saved memory, and related notes."
            >
              <Icon name="sparkle" size={11} />
              <span>Used your {contextChipLabel(m.context)}</span>
              <button
                className="ctx-chip-x"
                title="Dismiss"
                onClick={() => dismissChip(m.id)}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          )}
        {/* Query-that-compounds: file a grounded informational answer back
            as a durable wiki page (Karpathy's `outputs/` layer). Not shown
            for action proposals (diff/db/ssh/config). */}
        {m.role === "bot" &&
          m.context &&
          !m.proposalId &&
          !m.dbAction &&
          !m.sshAction &&
          !m.configAction &&
          (filed.has(m.id) ? (
            <div className="applied-note">
              <Icon name="check" size={13} /> Filed to wiki
            </div>
          ) : (
            <div className="ai-action" style={{ marginTop: 4 }}>
              <button
                className="sg-chip"
                disabled={filing.has(m.id)}
                title="Synthesize this answer into a durable, cross-linked wiki page"
                onClick={() => onFileToWiki(m.id)}
              >
                <Icon name="sparkle" size={12} />{" "}
                {filing.has(m.id) ? "Filing…" : "Save to wiki"}
              </button>
            </div>
          ))}
        {m.proposalId && (
          <div onClick={() => scrollToProposal(m.proposalId!)}>
            {m.status === "applied" ? (
              <span className="applied-note">
                <Icon name="check" size={14} /> Applied to page
              </span>
            ) : m.status === "rejected" ? (
              <span className="applied-note rejected-note">
                <Icon name="x" size={13} /> Discarded
              </span>
            ) : (
              <span className="ref">{m.label} — review in page ↗</span>
            )}
          </div>
        )}
        {m.dbAction &&
          (m.status === "applied" ? (
            <span className="applied-note">
              <Icon name="check" size={14} /> Board updated
            </span>
          ) : m.status === "rejected" ? (
            <span className="applied-note rejected-note">
              <Icon name="x" size={13} /> Dismissed
            </span>
          ) : (
            <div className="ai-action">
              <button
                className="pa-btn pa-accept"
                onClick={() => onApplyDb(m.id, m.dbAction!)}
              >
                <Icon name="check" size={13} /> {m.label}
              </button>
              <button
                className="pa-btn pa-reject"
                onClick={() => onDismissDb(m.id)}
              >
                Dismiss
              </button>
            </div>
          ))}
        {m.sshAction &&
          (m.status === "applied" ? (
            <span className="applied-note">
              <Icon name="check" size={14} /> SSH tunnel updated
            </span>
          ) : m.status === "rejected" ? (
            <span className="applied-note rejected-note">
              <Icon name="x" size={13} /> Connection request canceled
            </span>
          ) : (
            <div
              className="security-consent-box"
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                background: "rgba(255, 100, 100, 0.08)",
                border: "1px solid rgba(255, 100, 100, 0.2)",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  color: "var(--tx-1)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <Icon
                  name="settings"
                  size={14}
                  style={{ color: "var(--warn, #e65100)" }}
                />{" "}
                Security Permission Required
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--tx-2)",
                  lineHeight: 1.4,
                  margin: "0 0 8px 0",
                }}
              >
                {getPlainEnglishExplanation(m)}
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="pa-btn pa-accept"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  onClick={() => onApplySsh(m.id, m.sshAction!.action)}
                >
                  Approve & Execute
                </button>
                <button
                  className="pa-btn pa-reject"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  onClick={() => onDismissDb(m.id)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        {m.configAction &&
          (m.status === "applied" ? (
            <span className="applied-note">
              <Icon name="check" size={14} /> Credentials saved
            </span>
          ) : m.status === "rejected" ? (
            <span className="applied-note rejected-note">
              <Icon name="x" size={13} /> Key save request canceled
            </span>
          ) : (
            <div
              className="security-consent-box"
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                background: "rgba(255, 100, 100, 0.08)",
                border: "1px solid rgba(255, 100, 100, 0.2)",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  color: "var(--tx-1)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <Icon
                  name="settings"
                  size={14}
                  style={{ color: "var(--warn, #e65100)" }}
                />{" "}
                Security Permission Required
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--tx-2)",
                  lineHeight: 1.4,
                  margin: "0 0 8px 0",
                }}
              >
                {getPlainEnglishExplanation(m)}
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="pa-btn pa-accept"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  onClick={() =>
                    onApplyConfig(
                      m.id,
                      m.configAction!.provider,
                      m.configAction!.key,
                    )
                  }
                >
                  Approve & Save
                </button>
                <button
                  className="pa-btn pa-reject"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  onClick={() => onDismissDb(m.id)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <>
      {/* Tab strip (M3 #5) — one tab per concurrent conversation. */}
      <div
        className="agent-tabs"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 6px",
          borderBottom: "1px solid var(--bd-1, rgba(0,0,0,0.08))",
          overflowX: "auto",
        }}
      >
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => selectConversation(c.id)}
            title={c.title}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 6,
              cursor: "pointer",
              maxWidth: 160,
              fontSize: 12,
              background:
                c.id === activeConvId
                  ? "var(--bg-2, rgba(0,0,0,0.06))"
                  : "transparent",
              fontWeight: c.id === activeConvId ? 600 : 400,
            }}
          >
            {c.thinking && <span aria-label="running">●</span>}
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.title}
            </span>
            {conversations.length > 1 && (
              <button
                className="btn-ghost"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeConversation(c.id);
                }}
                style={{ lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="btn-ghost"
          title="New conversation"
          onClick={newConversation}
          style={{ padding: "2px 6px" }}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="agent-body scroll" ref={bodyRef}>
        <div
          className="agent-message-virtual-list"
          style={{ height: `${messageVirtualizer.getTotalSize()}px` }}
        >
          {messageVirtualizer.getVirtualItems().map((virtualRow) => {
            const message = messages[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                className="agent-message-virtual-row"
                data-index={virtualRow.index}
                ref={messageVirtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {renderMessage(message)}
              </div>
            );
          })}
        </div>
        {thinking && (
          <div className="msg bot">
            <span className="who">
              <Icon name="sparkle" size={13} />
            </span>
            <div className="bubble">
              <div className="thinking">
                <i></i>
                <i></i>
                <i></i>
              </div>
            </div>
          </div>
        )}
        <ApprovalQueue
          state={workApprovals}
          onRespond={respondWorkApproval}
          timeoutSeconds={workApprovalTimeout}
          now={workApprovalNow}
        />
        {messages.length <= 1 && !thinking && (
          <div className="chips" style={{ marginTop: 2 }}>
            <button
              className="sg-chip"
              onClick={() => onSend("Summarize this page")}
            >
              <Icon name="sparkle" size={13} /> Summarize this page
            </button>
            <button
              className="sg-chip"
              onClick={() => onSend("Tighten the opening paragraph")}
            >
              <Icon name="text" size={13} /> Tighten the intro
            </button>
            <button
              className="sg-chip"
              onClick={() => onSend("Draft next steps")}
            >
              <Icon name="wand" size={13} /> Draft next steps
            </button>
            <button
              className="sg-chip"
              onClick={() => onSend("Mark all tasks done")}
            >
              <Icon name="board" size={13} /> Mark all tasks done
            </button>
          </div>
        )}
      </div>
      <div className="agent-foot">
        <ActiveSkillChips
          skills={skills.active}
          onUnload={skills.unloadByName}
        />
        <div className="composer" style={{ position: "relative" }}>
          {slashOpen && slashEntries.length > 0 && (
            <div
              role="listbox"
              style={{
                position: "absolute",
                bottom: "calc(100% + 4px)",
                left: 0,
                right: 0,
                maxHeight: 220,
                overflowY: "auto",
                background: "var(--bg-1, #fff)",
                border: "1px solid var(--bd-1, rgba(0,0,0,0.12))",
                borderRadius: 8,
                boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
                zIndex: 20,
                padding: 4,
              }}
            >
              {slashEntries.map((entry, i) => (
                <button
                  key={entry.token}
                  role="option"
                  aria-selected={i === slashIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSlash(entry.token);
                  }}
                  onMouseEnter={() => setSlashIdx(i)}
                  style={{
                    display: "flex",
                    width: "100%",
                    gap: 8,
                    alignItems: "baseline",
                    textAlign: "left",
                    padding: "5px 8px",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    background:
                      i === slashIdx
                        ? "var(--row-hover, rgba(0,0,0,0.06))"
                        : "transparent",
                    color: "var(--tx-1, inherit)",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {entry.token}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--tx-3, #888)" }}>
                    {entry.label}
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            placeholder="Ask My Assistant, rewrite, or act on the board…  (try /skill)"
            value={val}
            onChange={grow}
            onKeyDown={(e) => {
              if (slashOpen && slashEntries.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIdx((i) => (i + 1) % slashEntries.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIdx(
                    (i) => (i - 1 + slashEntries.length) % slashEntries.length,
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickSlash(slashEntries[slashIdx].token);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSlashOpen(false);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-row">
            {dictation.supported && (
              <button
                className={`mini${dictation.listening ? " on" : ""}`}
                title={dictation.listening ? "Stop dictation" : "Dictate"}
                aria-pressed={dictation.listening}
                onClick={dictation.toggle}
              >
                <Icon name="mic" size={16} />
              </button>
            )}
            <button
              type="button"
              className="mini"
              aria-pressed={grounded}
              title={
                grounded
                  ? "Grounding answers in your workspace — on"
                  : "Grounding answers in your workspace — off"
              }
              onClick={toggleGrounding}
              style={{
                border: "none",
                padding: 0,
                cursor: "pointer",
                background: grounded ? "var(--row-hover)" : "none",
                color: grounded ? "var(--tx-1)" : "var(--tx-3)",
              }}
            >
              <Icon name="database" size={16} />
            </button>
            <button className="send" disabled={!val.trim()} onClick={submit}>
              <Icon name="arrowUp" size={16} stroke={2.2} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
