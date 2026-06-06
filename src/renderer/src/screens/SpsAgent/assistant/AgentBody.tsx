// AgentBody.tsx — assistant chat panel (messages, suggestion chips, composer).
// Ported from agent.jsx AgentBody; reads/acts through the store.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { scrollToProposal } from "../lib/scroll";
import { useDictation } from "../hooks/useDictation";
import {
  getGroundInWorkspace,
  setGroundInWorkspace,
} from "../../../lib/grounding";
import { contextChipLabel } from "./contextChip";

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

  const [val, setVal] = useState("");
  // Trust chips are dismissable per-message (the user can hide "used your …").
  const [dismissedChips, setDismissedChips] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const dismissChip = (id: string): void => {
    setDismissedChips((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Grounding toggle: the co-author reads getGroundInWorkspace() at send time
  // (via BridgeAssistant), so this just persists the shared preference — the
  // same one the Chat header controls. No prop threading needed.
  const [grounded, setGrounded] = useState(getGroundInWorkspace());
  const toggleGrounding = (): void => {
    const next = !grounded;
    setGrounded(next);
    setGroundInWorkspace(next);
  };

  useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, thinking]);

  const submit = () => {
    const v = val.trim();
    if (!v) return;
    onSend(v);
    setVal("");
    if (taRef.current) taRef.current.style.height = "auto";
  };
  const grow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
    setVal(ta.value);
  };
  // Voice dictation (M3 #4): append recognized speech to the composer.
  const dictation = useDictation((text) => {
    setVal((v) => (v ? `${v} ${text}` : text));
    taRef.current?.focus();
  });

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
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
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
            </div>
          </div>
        ))}
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
        <div className="composer">
          <textarea
            ref={taRef}
            rows={1}
            placeholder="Ask, rewrite, or act on the board…"
            value={val}
            onChange={grow}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-row">
            <span className="mini" title="Reference a page">
              <Icon name="doc" size={16} />
            </span>
            <span className="mini" title="Mention">
              <Icon name="comment" size={16} />
            </span>
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
