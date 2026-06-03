// AgentBody.tsx — assistant chat panel (messages, suggestion chips, composer).
// Ported from agent.jsx AgentBody; reads/acts through the store.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { scrollToProposal } from "../lib/scroll";

export function AgentBody() {
  const messages = useStore((s) => s.messages);
  const thinking = useStore((s) => s.thinking);
  const onSend = useStore((s) => s.runAgent);
  const onApplyDb = useStore((s) => s.applyDbAction);
  const onDismissDb = useStore((s) => s.dismissDbAction);

  const [val, setVal] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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

  return (
    <>
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
            <button className="send" disabled={!val.trim()} onClick={submit}>
              <Icon name="arrowUp" size={16} stroke={2.2} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
