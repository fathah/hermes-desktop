// agent.jsx — assistant brain (chat / diff / db-action / append) + panel body
const { useState: useStateA, useRef: useRefA, useEffect: useEffectA } = React;

function firstLong(blocks, min = 40) { return blocks.find((b) => b.type === "p" && b.text && b.text.length > min && !b.diff && !b.proposalId); }
function tighten(text) { const s = (text || "").replace(/\s+/g, " ").trim(); const m = s.match(/^(.*?[.!?])(\s|$)/); return m ? m[1] : s.split(" ").slice(0, 16).join(" ") + "."; }
function nameInPrompt(q) { for (const k of Object.keys(PEOPLE)) if (q.includes(k) || q.includes(PEOPLE[k].name.toLowerCase().split(" ")[0])) return k; return null; }

function generateResponse(prompt, blocks) {
  const q = prompt.toLowerCase();

  // database actions
  if (/(mark|set|complete|finish).*(done|complete)|all done|mark everything/.test(q)) {
    const who = nameInPrompt(q);
    return { kind: "db", reply: [who ? `Mark ${PEOPLE[who].name.split(" ")[0]}'s tasks as done?` : "Mark every task on the board as done?"], label: who ? `Complete ${PEOPLE[who].name.split(" ")[0]}'s tasks` : "Complete all tasks", action: { type: "markDone", who } };
  }
  if (/add (a )?task|new task|create task/.test(q)) {
    const title = prompt.replace(/.*task[:\s]*/i, "").trim() || "New task";
    return { kind: "db", reply: [`Add “${title}” to the board?`], label: "Add task", action: { type: "addTask", title } };
  }
  if (/group by|calendar view|board view|gallery view|show.*(calendar|board|gallery)/.test(q)) {
    const view = /calendar/.test(q) ? "calendar" : /gallery/.test(q) ? "gallery" : "board";
    return { kind: "db", reply: [`Switch the task database to ${view} view?`], label: `Switch to ${view}`, action: { type: "view", view } };
  }

  // diff (tracked-change rewrite)
  if (/(tighten|rewrite|shorten|clean|polish|fix|trim|condense)/.test(q)) {
    const target = firstLong(blocks);
    if (!target) return { kind: "chat", reply: ["There's no long paragraph on this page to tighten. Point me at the text and I'll rework it."] };
    return { kind: "diff", reply: ["I tightened the opening paragraph. Review the tracked change in the page — green is new, struck-through is removed."], label: "Tighten paragraph", edits: [{ find: target.text.slice(0, 18), html: escapeHtml(tighten(target.text)) }] };
  }

  // chat (questions)
  if (/^(what|why|how|who|when|where|is |are |should |can |explain|summari[sz]e the status|status)/.test(q) && !/next step|draft|plan/.test(q)) {
    if (/summ|recap|status/.test(q)) return { kind: "chat", reply: ["Status: onboarding redesign is in progress (Maya), analytics migration in progress (Theo), 2.4 changelog and pricing copy still open. Two decisions pending: analytics backfill and pricing sign-off."] };
    return { kind: "chat", reply: ["From what's on this page: the team is mid-cycle on the 2.4 release. I can pull the relevant section into a summary, draft next steps, or open the task board — say which."] };
  }

  // append proposals
  if (/summ|recap|tl;dr/.test(q)) {
    return { kind: "append", reply: ["I read the page and pulled the essentials into a callout, placed up top."], label: "Add summary callout", at: "top",
      blocks: [blk("callout", "This week: ship onboarding to staging, finish the analytics migration, and lock 2.4 scope. Open: analytics backfill and pricing-copy sign-off.", { emoji: "🧭" })] };
  }
  if (/next step|draft|plan/.test(q)) {
    return { kind: "append", reply: ["Based on the decisions and open questions, here are next steps. Accept to add them to the page."], label: "Draft next steps", at: "bottom",
      blocks: [blk("h3", "Next steps"), blk("todo", "Confirm staging deploy window with eng (Thursday)", { done: false }), blk("todo", "Priya circulates the migration guide draft by Friday", { done: false }), blk("todo", "Decide analytics backfill vs. clean start — Theo", { done: false }), blk("todo", "Route pricing copy to Sam for sign-off", { done: false })] };
  }
  if (/task|action item|to-?do/.test(q)) {
    return { kind: "append", reply: ["I scanned the notes for commitments and turned them into action items."], label: "New action items", at: "bottom",
      blocks: [blk("todo", "Backfill decision documented in the roadmap", { done: false }), blk("todo", "Migration guide draft — Priya, Fri", { done: false }), blk("todo", "Pricing copy sign-off — Sam", { done: false })] };
  }
  return { kind: "append", reply: ["I drafted a block you can drop into the page. Want me to expand it or take another angle?"], label: "Suggested block", at: "bottom",
    blocks: [blk("p", "Reminder: keep standup blockers to one line, and link the doc rather than pasting screenshots so search stays useful.")] };
}

function AgentBody({ messages, onSend, thinking, onScrollToProposal, onApplyDb, onDismissDb }) {
  const [val, setVal] = useStateA("");
  const bodyRef = useRefA(null); const taRef = useRefA(null);
  useEffectA(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [messages, thinking]);
  const submit = () => { const v = val.trim(); if (!v) return; onSend(v); setVal(""); if (taRef.current) taRef.current.style.height = "auto"; };
  const grow = (e) => { const ta = e.target; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; setVal(ta.value); };
  return (
    <>
      <div className="agent-body scroll" ref={bodyRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <span className="who">{m.role === "user" ? "You" : <Icon name="sparkle" size={13} />}</span>
            <div className="bubble">
              {m.text.map((para, i) => <p key={i}>{para}</p>)}
              {m.proposalId && (
                <div onClick={() => onScrollToProposal(m.proposalId)}>
                  {m.status === "applied" ? <span className="applied-note"><Icon name="check" size={14} /> Applied to page</span>
                    : m.status === "rejected" ? <span className="applied-note rejected-note"><Icon name="x" size={13} /> Discarded</span>
                    : <span className="ref">{m.label} — review in page ↗</span>}
                </div>
              )}
              {m.dbAction && (
                m.status === "applied" ? <span className="applied-note"><Icon name="check" size={14} /> Board updated</span>
                : m.status === "rejected" ? <span className="applied-note rejected-note"><Icon name="x" size={13} /> Dismissed</span>
                : <div className="ai-action"><button className="pa-btn pa-accept" onClick={() => onApplyDb(m.id, m.dbAction)}><Icon name="check" size={13} /> {m.label}</button><button className="pa-btn pa-reject" onClick={() => onDismissDb(m.id)}>Dismiss</button></div>
              )}
            </div>
          </div>
        ))}
        {thinking && <div className="msg bot"><span className="who"><Icon name="sparkle" size={13} /></span><div className="bubble"><div className="thinking"><i></i><i></i><i></i></div></div></div>}
        {messages.length <= 1 && !thinking && (
          <div className="chips" style={{ marginTop: 2 }}>
            <button className="sg-chip" onClick={() => onSend("Summarize this page")}><Icon name="sparkle" size={13} /> Summarize this page</button>
            <button className="sg-chip" onClick={() => onSend("Tighten the opening paragraph")}><Icon name="text" size={13} /> Tighten the intro</button>
            <button className="sg-chip" onClick={() => onSend("Draft next steps")}><Icon name="wand" size={13} /> Draft next steps</button>
            <button className="sg-chip" onClick={() => onSend("Mark all tasks done")}><Icon name="board" size={13} /> Mark all tasks done</button>
          </div>
        )}
      </div>
      <div className="agent-foot">
        <div className="composer">
          <textarea ref={taRef} rows={1} placeholder="Ask, rewrite, or act on the board…" value={val} onChange={grow}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <div className="composer-row">
            <span className="mini" title="Reference a page"><Icon name="doc" size={16} /></span>
            <span className="mini" title="Mention"><Icon name="comment" size={16} /></span>
            <button className="send" disabled={!val.trim()} onClick={submit}><Icon name="arrowUp" size={16} stroke={2.2} /></button>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { AgentBody, generateResponse });
