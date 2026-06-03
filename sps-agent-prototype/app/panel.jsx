// panel.jsx — tabbed right panel: Assistant · Outline · Comments · Info
const { useState: useStateRP } = React;

function RightPanel({ tab, setTab, onClose, agent, blocks, comments, commentApi, pageInfo, onScrollToBlock }) {
  const openCmts = comments.filter((c) => !c.resolved).length;
  const tabs = [
    ['assistant', 'Assistant', 'sparkle', null],
    ['outline', 'Outline', 'list', null],
    ['comments', 'Comments', 'comment', openCmts || null],
    ['info', 'Info', 'clock', null],
  ];
  return (
    <aside className="rp">
      <div className="rp-tabs">
        {tabs.map(([id, label, icon, badge]) => (
          <button key={id} className={`rp-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <Icon name={icon} size={15} /> {label}{badge ? <span className="badge">{badge}</span> : null}
          </button>
        ))}
        <button className="rp-tab rp-close" title="Close" onClick={onClose}><Icon name="panelRight" size={16} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'assistant' && <AgentBody {...agent} />}
        {tab === 'outline' && <Outline blocks={blocks} onScrollToBlock={onScrollToBlock} />}
        {tab === 'comments' && <CommentsPane comments={comments} api={commentApi} onScrollToBlock={onScrollToBlock} />}
        {tab === 'info' && <InfoPane blocks={blocks} info={pageInfo} comments={comments} />}
      </div>
    </aside>
  );
}

function Outline({ blocks, onScrollToBlock }) {
  const heads = blocks.filter((b) => ['h1', 'h2', 'h3'].includes(b.type) && b.text);
  if (!heads.length) return <div className="rp-body scroll"><div className="outline-empty">No headings yet.<br />Add H1–H3 blocks to build an outline.</div></div>;
  return (
    <div className="rp-body scroll"><div className="outline">
      {heads.map((h) => (
        <button key={h.id} className={`outline-item ${h.type === 'h2' ? 'lvl2' : h.type === 'h3' ? 'lvl3' : ''}`} onClick={() => onScrollToBlock(h.id)}>{h.text}</button>
      ))}
    </div></div>
  );
}

function CommentsPane({ comments, api, onScrollToBlock }) {
  if (!comments.length) return <div className="rp-body scroll"><div className="cmts-empty"><Icon name="comment" size={22} style={{ color: 'var(--tx-4)' }} /><div style={{ marginTop: 8 }}>No comments yet.</div><div style={{ fontSize: 12, marginTop: 4 }}>Select text and click the comment icon to start a thread.</div></div></div>;
  return (
    <div className="rp-body scroll"><div className="cmts">
      {comments.map((c) => <CommentThread key={c.id} c={c} api={api} onScrollToBlock={onScrollToBlock} />)}
    </div></div>
  );
}

function CommentThread({ c, api, onScrollToBlock }) {
  const [reply, setReply] = useStateRP('');
  return (
    <div className={`cmt-thread ${c.resolved ? 'resolved' : ''}`}>
      {c.quote && <div className="cmt-quote" onClick={() => api.scrollToAnchor(c.id)} style={{ cursor: 'pointer' }}>“{c.quote}”</div>}
      {c.messages.map((m, i) => (
        <div className="cmt" key={i}>
          <span className="who" style={{ background: m.color }}>{m.initials}</span>
          <div className="cmt-b"><div className="nm">{m.name}<span>{m.time}</span></div><div className="tx">{m.text}</div></div>
        </div>
      ))}
      <div className="cmt-input">
        <textarea rows={1} placeholder="Reply…" value={reply} onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (reply.trim()) { api.reply(c.id, reply.trim()); setReply(''); } } }} />
      </div>
      <div className="cmt-actions" style={{ marginTop: 8 }}>
        <button onClick={() => api.resolve(c.id)}>{c.resolved ? 'Re-open' : 'Resolve'}</button>
        <button onClick={() => api.remove(c.id)}>Delete</button>
      </div>
    </div>
  );
}

function InfoPane({ blocks, info, comments }) {
  const words = blocks.reduce((n, b) => n + (b.text ? b.text.trim().split(/\s+/).filter(Boolean).length : 0), 0);
  const heads = blocks.filter((b) => ['h1', 'h2', 'h3'].includes(b.type)).length;
  const todos = blocks.filter((b) => b.type === 'todo');
  const doneT = todos.filter((b) => b.done).length;
  return (
    <div className="rp-body scroll"><div className="info-pane">
      <div className="info-stat">
        <div><div className="n">{words}</div><div className="l">Words</div></div>
        <div><div className="n">{blocks.length}</div><div className="l">Blocks</div></div>
        <div><div className="n">{heads}</div><div className="l">Headings</div></div>
      </div>
      <div className="field-grid">
        <div className="fk"><Icon name="clock" size={15} /> Created</div><div className="fv">May 21, 2026</div>
        <div className="fk"><Icon name="clock" size={15} /> Edited</div><div className="fv">2m ago</div>
        <div className="fk"><Icon name="home" size={15} /> Owner</div><div className="fv"><span className="person"><Avatar who="maya" />Maya Rao</span></div>
        <div className="fk"><Icon name="checkbox" size={15} /> Tasks</div><div className="fv num">{doneT}/{todos.length} done</div>
        <div className="fk"><Icon name="comment" size={15} /> Comments</div><div className="fv num">{comments.length}</div>
      </div>
      <hr className="b-divider" style={{ margin: '16px 0' }} />
      <div className="type-section-label" style={{ marginBottom: 10 }}>Contributors</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {['maya', 'theo', 'priya', 'sam'].map((w) => (
          <div key={w} className="person" style={{ fontSize: 13.5 }}><Avatar who={w} size={22} />{PEOPLE[w].name}</div>
        ))}
      </div>
    </div></div>
  );
}

Object.assign(window, { RightPanel });
