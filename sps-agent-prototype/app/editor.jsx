// editor.jsx — block editor: rich text, markdown, nesting, toggles, mentions, context menu, media
const { useState, useRef, useEffect, useCallback } = React;

const SLASH_ITEMS = [
  { type: 'p',        icon: 'text',     label: 'Text',           desc: 'Plain paragraph' },
  { type: 'h1',       icon: 'h1',       label: 'Heading 1',      desc: 'Big section heading' },
  { type: 'h2',       icon: 'h2',       label: 'Heading 2',      desc: 'Medium heading' },
  { type: 'h3',       icon: 'h3',       label: 'Heading 3',      desc: 'Small heading' },
  { type: 'todo',     icon: 'checkbox', label: 'To-do list',     desc: 'Track with a checkbox' },
  { type: 'li',       icon: 'bullet',   label: 'Bulleted list',  desc: 'Simple bullet' },
  { type: 'numli',    icon: 'numlist',  label: 'Numbered list',  desc: 'Ordered item' },
  { type: 'toggle',   icon: 'chevR',    label: 'Toggle list',    desc: 'Collapsible content' },
  { type: 'quote',    icon: 'quote',    label: 'Quote',          desc: 'Callout a line' },
  { type: 'callout',  icon: 'callout',  label: 'Callout',        desc: 'Highlighted note' },
  { type: 'code',     icon: 'code',     label: 'Code',           desc: 'Monospaced block' },
  { type: 'divider',  icon: 'divider',  label: 'Divider',        desc: 'Visual separator' },
  { type: 'image',    icon: 'doc',      label: 'Image',          desc: 'Upload or drop a file' },
  { type: 'bookmark', icon: 'share',    label: 'Web bookmark',   desc: 'Link preview card' },
  { type: 'page',     icon: 'doc',      label: 'Sub-page',       desc: 'A page inside this page' },
  { type: 'database', icon: 'database', label: 'Task board',     desc: 'Embedded database' },
];
const CARRY = ['todo', 'li', 'numli'];

// ---- one rich-text editable block ----
function Editable({ block, cls, placeholder, phFocus, onInput, onEnter, onBackspaceEmpty, onIndent, onArrow, registerRef, autofocusTrigger, color }) {
  const ref = useRef(null);
  const [empty, setEmpty] = useState(!block.text);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const want = block.html != null ? block.html : escapeHtml(block.text || '');
    if (el.innerHTML !== want) el.innerHTML = want;
    setEmpty(!el.textContent);
  }, [block.id]);
  useEffect(() => { registerRef && registerRef(block.id, ref); }, [block.id]);

  return (
    <div
      ref={ref}
      className={`block ${cls} ${empty ? 'empty' : ''} ${focused ? 'focused' : ''}`}
      contentEditable suppressContentEditableWarning spellCheck={false}
      data-ph={placeholder} data-ph-focus={phFocus || placeholder} data-color={color || undefined}
      onInput={(e) => { const el = e.currentTarget; setEmpty(!el.textContent); onInput(block.id, el.innerHTML, el.textContent); }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPaste={(e) => {
        e.preventDefault();
        const data = (e.clipboardData || window.clipboardData).getData('text/plain');
        const sel = window.getSelection();
        const isUrl = /^https?:\/\/\S+$/.test((data || '').trim());
        if (isUrl && sel && !sel.isCollapsed) document.execCommand('createLink', false, data.trim());
        else document.execCommand('insertText', false, data);
        const el = ref.current; onInput(block.id, el.innerHTML, el.textContent);
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
          e.preventDefault(); document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline');
          const el = ref.current; onInput(block.id, el.innerHTML, el.textContent); return;
        }
        if (e.key === 'Enter' && !e.shiftKey && block.type !== 'code') { e.preventDefault(); onEnter(block.id, ref.current); }
        else if (e.key === 'Tab') { e.preventDefault(); onIndent(block.id, e.shiftKey ? -1 : 1); }
        else if (e.key === 'Backspace' && !ref.current.textContent) { e.preventDefault(); onBackspaceEmpty(block.id); }
        else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && onArrow) {
          const moved = onArrow(block.id, e.key === 'ArrowUp' ? -1 : 1, ref.current);
          if (moved) e.preventDefault();
        }
      }}
    />
  );
}

function Editor({ blocks, setBlocks, onOpenTask, focusReq, clearFocusReq, onProposalDecision, onComment, onToast, api }) {
  const refs = useRef({});
  const [slash, setSlash] = useState(null);
  const [mention, setMention] = useState(null);
  const [bmenu, setBmenu] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [overIndent, setOverIndent] = useState(0);
  const blocksRef = useRef(null);
  const registerRef = useCallback((id, r) => { refs.current[id] = r; }, []);

  useEffect(() => {
    if (focusReq && refs.current[focusReq]) {
      const el = refs.current[focusReq].current;
      if (el) { el.focus(); placeCaretEnd(el); }
      clearFocusReq();
    }
  }, [focusReq]);

  const setType = (id, patch) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const updateBlock = (id, html, text) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, html, text } : b)));
    // markdown shortcuts
    const md = detectMarkdown(text);
    if (md) {
      const el = refs.current[id]?.current;
      if (md.type === 'divider') {
        setType(id, { type: 'divider', html: '', text: '' });
        const nb = blk('p', ''); insertAfter(id, nb); focusSoon(nb.id);
      } else {
        setType(id, { type: md.type, html: '', text: '', done: md.type === 'todo' ? false : undefined, collapsed: md.type === 'toggle' ? false : undefined });
        if (el) { el.innerHTML = ''; requestAnimationFrame(() => el.focus()); }
      }
      setSlash(null); setMention(null);
      return;
    }
    // slash
    if (text === '/' || (text.startsWith('/') && !text.includes(' '))) {
      const r = caretRect();
      if (r) setSlash({ blockId: id, x: r.left, y: r.bottom + 6, query: text.slice(1) });
    } else if (slash && slash.blockId === id) setSlash(null);
    // mention
    const mq = mentionQuery();
    if (mq != null) {
      const r = caretRect();
      if (r) setMention({ blockId: id, x: r.left, y: r.bottom + 6, query: mq });
    } else if (mention) setMention(null);
  };

  const focusSoon = (id) => requestAnimationFrame(() => { const el = refs.current[id]?.current; if (el) el.focus(); });

  const insertAfter = (id, nb) => setBlocks((bs) => {
    const i = bs.findIndex((b) => b.id === id); const next = [...bs];
    const indent = bs[i] ? (bs[i].indent || 0) : 0;
    next.splice(i + 1, 0, { ...nb, indent: nb.indent != null ? nb.indent : indent }); return next;
  });

  const onEnter = (id) => {
    const cur = blocks.find((b) => b.id === id);
    if (cur?.type === 'toggle') { const nb = blk('p', ''); nb.indent = (cur.indent || 0) + 1; insertAfter(id, nb); focusSoon(nb.id); return; }
    const carry = CARRY.includes(cur?.type) && cur.text ? cur.type : 'p';
    const nb = blk(carry, '', carry === 'todo' ? { done: false } : {});
    nb.indent = cur?.indent || 0;
    insertAfter(id, nb); focusSoon(nb.id);
  };

  const onBackspaceEmpty = (id) => {
    const cur = blocks.find((b) => b.id === id);
    if (cur && (cur.indent || 0) > 0) { setType(id, { indent: cur.indent - 1 }); return; }
    if (cur && cur.type !== 'p') { setType(id, { type: 'p' }); return; }
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id); if (i <= 0) return bs;
      const prev = bs[i - 1];
      requestAnimationFrame(() => { const el = refs.current[prev.id]?.current; if (el) { el.focus(); placeCaretEnd(el); } });
      return bs.filter((b) => b.id !== id);
    });
  };

  const onIndent = (id, dir) => setBlocks((bs) => {
    const i = bs.findIndex((b) => b.id === id);
    const maxIndent = i > 0 ? (bs[i - 1].indent || 0) + 1 : 0;
    const cur = Math.max(0, Math.min((bs[i].indent || 0) + dir, dir > 0 ? maxIndent : 99));
    return bs.map((b) => (b.id === id ? { ...b, indent: cur } : b));
  });

  const onArrow = (id, dir) => {
    const i = blocks.findIndex((b) => b.id === id);
    const t = blocks[i + dir];
    if (t && refs.current[t.id]?.current) { refs.current[t.id].current.focus(); placeCaretEnd(refs.current[t.id].current); return true; }
    return false;
  };

  const applySlash = (item) => {
    const id = slash.blockId; setSlash(null);
    if (item.type === 'divider') { setType(id, { type: 'divider', html: '', text: '' }); const nb = blk('p', ''); insertAfter(id, nb); focusSoon(nb.id); return; }
    if (item.type === 'database') { setType(id, { type: 'database', html: '', text: '', view: 'board' }); return; }
    if (item.type === 'image') { setType(id, { type: 'image', html: '', text: '' }); return; }
    if (item.type === 'bookmark') { setType(id, { type: 'bookmark', html: '', text: '', bm: null }); return; }
    if (item.type === 'page') { const pid = api && api.createChildPage && api.createChildPage(); if (pid) setType(id, { type: 'page', pageId: pid, html: '', text: '' }); return; }
    setType(id, { type: item.type, html: '', text: '', done: item.type === 'todo' ? false : undefined, collapsed: item.type === 'toggle' ? false : undefined });
    const el = refs.current[id]?.current; if (el) { el.innerHTML = ''; focusSoon(id); }
  };

  const pickMention = (item) => {
    const id = mention.blockId; const el = refs.current[id]?.current; setMention(null);
    if (!el) return;
    insertMentionChip(el, item, mention.query.length);
    onInputFromDom(id, el);
  };
  const onInputFromDom = (id, el) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, html: el.innerHTML, text: el.textContent } : b)));

  const toggleTodo = (id) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, done: !b.done } : b)));
  const toggleCollapse = (id) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, collapsed: !b.collapsed } : b)));
  const setView = (id, view) => setType(id, { view });

  // block menu actions
  const turnInto = (id, type) => { setType(id, { type, done: type === 'todo' ? false : undefined, collapsed: type === 'toggle' ? false : undefined }); };
  const colorBlock = (id, patch) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, color: 'color' in patch ? patch.color : b.color, bg: 'bg' in patch ? patch.bg : b.bg } : b)));
  const duplicate = (id) => setBlocks((bs) => { const i = bs.findIndex((b) => b.id === id); const copy = { ...bs[i], id: uid('b') }; const n = [...bs]; n.splice(i + 1, 0, copy); return n; });
  const removeBlock = (id) => setBlocks((bs) => bs.filter((b) => b.id !== id));

  // drag reorder + nest
  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    setBlocks((bs) => {
      const from = bs.findIndex((b) => b.id === dragId); const to = bs.findIndex((b) => b.id === targetId);
      const n = [...bs]; const [m] = n.splice(from, 1);
      const insertAt = to > from ? to : to; n.splice(insertAt, 0, m);
      const prev = n[insertAt - 1]; const max = prev ? (prev.indent || 0) + 1 : 0;
      n[insertAt] = { ...m, indent: Math.max(0, Math.min(overIndent, max)) };
      return n;
    });
    setDragId(null); setOverId(null);
  };
  const computeIndent = (clientX) => { const left = blocksRef.current ? blocksRef.current.getBoundingClientRect().left : 0; setOverIndent(Math.max(0, Math.min(Math.round((clientX - left - 2) / 24), 6))); };

  // group proposals + compute toggle visibility
  const rows = [];
  let hideDeeper = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (hideDeeper != null) { if ((b.indent || 0) > hideDeeper) continue; else hideDeeper = null; }
    if (b.proposalId) {
      const group = [b];
      while (i + 1 < blocks.length && blocks[i + 1].proposalId === b.proposalId) { group.push(blocks[i + 1]); i++; }
      rows.push({ kind: 'proposal', proposalId: b.proposalId, label: b.proposalLabel, blocks: group });
    } else {
      rows.push({ kind: 'block', block: b });
      if (b.type === 'toggle' && b.collapsed) hideDeeper = b.indent || 0;
    }
  }

  const innerProps = { updateBlock, onEnter, onBackspaceEmpty, onIndent, onArrow, toggleTodo, toggleCollapse, registerRef, setView, onOpenTask, setType, onInputFromDom: (id) => { const el = refs.current[id]?.current; if (el) onInputFromDom(id, el); }, onDecision: onProposalDecision, onOpenPage: api && api.onOpenPage, pageMeta: api && api.pageMeta };

  return (
    <div className="blocks" ref={blocksRef}>
      {rows.map((row) =>
        row.kind === 'block' ? (
          <BlockRow key={row.block.id} block={row.block} dragId={dragId} overId={overId} overIndent={overIndent}
            setDragId={setDragId} setOverId={setOverId} onDrop={onDrop} computeIndent={computeIndent}
            onMenu={(rect) => setBmenu({ block: row.block, x: rect.right + 4, y: rect.top })}
            onAdd={(rect) => setSlash({ blockId: row.block.id, x: rect.right + 4, y: rect.bottom + 4, query: '' })}>
            <BlockInner block={row.block} {...innerProps} />
          </BlockRow>
        ) : (
          <div className="proposed-group" id={`grp-${row.proposalId}`} key={row.proposalId}>
            <div className="proposed-head">
              <span className="dot"></span><Icon name="sparkle" size={13} /> {row.label || 'Suggested edit'}
              <div className="proposed-actions">
                <button className="pa-btn pa-reject" onClick={() => onProposalDecision(row.proposalId, false)}>Discard</button>
                <button className="pa-btn pa-accept" onClick={() => onProposalDecision(row.proposalId, true)}><Icon name="check" size={13} /> Accept</button>
              </div>
            </div>
            {row.blocks.map((b) => <BlockInner key={b.id} block={b} {...innerProps} />)}
          </div>
        )
      )}

      {slash && <SlashMenu x={slash.x} y={slash.y} query={slash.query} onPick={applySlash} onClose={() => setSlash(null)} />}
      {mention && <MentionMenu x={mention.x} y={mention.y} query={mention.query} onPick={pickMention} onClose={() => setMention(null)} />}
      {bmenu && <BlockMenu x={bmenu.x} y={bmenu.y} block={bmenu.block} onClose={() => setBmenu(null)}
        onTurnInto={turnInto} onColor={colorBlock} onDuplicate={duplicate}
        onCopyLink={() => onToast('Link to block copied')} onDelete={removeBlock} onComment={(id) => onComment(id, bmenu.block.text || 'block')} />}
    </div>
  );
}

function BlockRow({ block, children, dragId, overId, overIndent, setDragId, setOverId, onDrop, computeIndent, onMenu, onAdd }) {
  const pad = (block.indent || 0) * 24;
  const showGutter = block.type !== 'divider';
  const isOver = overId === block.id && dragId && dragId !== block.id;
  return (
    <div className={`block-wrap`} id={`bw-${block.id}`} data-bg={block.bg || undefined} data-diff={block.diff ? block.diff.proposalId : undefined}
      style={{ marginLeft: pad }}
      onDragOver={(e) => { e.preventDefault(); setOverId(block.id); computeIndent && computeIndent(e.clientX); }} onDrop={() => onDrop(block.id)}>
      {isOver && <div className="drop-guide" style={{ marginLeft: (overIndent - (block.indent || 0)) * 24 }}></div>}
      <div className="block-row">
        {showGutter && (
          <div className="block-gutter">
            <button className="g-btn add" title="Add below" onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}><Icon name="plus" size={16} /></button>
            <button className="g-btn" title="Drag to move · click for menu" draggable
              onClick={(e) => onMenu(e.currentTarget.getBoundingClientRect())}
              onDragStart={() => setDragId(block.id)} onDragEnd={() => { setDragId(null); setOverId(null); }}><Icon name="grip" size={16} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function BlockInner({ block, updateBlock, onEnter, onBackspaceEmpty, onIndent, onArrow, toggleTodo, toggleCollapse, registerRef, setView, onOpenTask, setType, onInputFromDom, onDecision, onOpenPage, pageMeta }) {
  if (block.diff) return <DiffBlock block={block} onDecision={onDecision} />;
  const common = { block, onInput: updateBlock, onEnter, onBackspaceEmpty, onIndent, onArrow, registerRef, color: block.color };
  switch (block.type) {
    case 'h1': return <Editable {...common} cls="b-h1" placeholder="Heading 1" />;
    case 'h2': return <Editable {...common} cls="b-h2" placeholder="Heading 2" />;
    case 'h3': return <Editable {...common} cls="b-h3" placeholder="Heading 3" />;
    case 'quote': return <Editable {...common} cls="b-quote" placeholder="Quote" />;
    case 'code': return <Editable {...common} cls="b-code" placeholder="Code" />;
    case 'divider': return <div className="b-divider-wrap"><hr className="b-divider" /></div>;
    case 'toggle': return (
      <div className="b-toggle-row">
        <span className={`toggle-tri ${block.collapsed ? '' : 'open'}`} onClick={() => toggleCollapse(block.id)}><Icon name="chevR" size={14} /></span>
        <Editable {...common} cls="" placeholder="Toggle" />
      </div>
    );
    case 'callout': return (
      <div className="b-callout"><span className="emoji">{block.emoji || '💡'}</span><Editable {...common} cls="" placeholder="Type something…" /></div>
    );
    case 'todo': return (
      <div className={`b-todo ${block.done ? 'done' : ''}`}>
        <div className={`check ${block.done ? 'done' : ''}`} onClick={() => toggleTodo(block.id)}>{block.done && <Icon name="check" size={13} stroke={2.4} />}</div>
        <Editable {...common} cls="" placeholder="To-do" />
      </div>
    );
    case 'li': return <div className="b-li"><span className="marker bullet">•</span><Editable {...common} cls="" placeholder="List item" /></div>;
    case 'numli': return <div className="b-li"><span className="marker num">1.</span><Editable {...common} cls="" placeholder="List item" /></div>;
    case 'image': return <ImageBlock block={block} setType={setType} onInputFromDom={onInputFromDom} />;
    case 'bookmark': return <BookmarkBlock block={block} setType={setType} />;
    case 'page': return <PageLinkBlock block={block} pageMeta={pageMeta} onOpenPage={onOpenPage} />;
    case 'database': return <TasksDB block={block} update={(patch) => setType(block.id, patch)} onOpenTask={onOpenTask} />;
    default: return <Editable {...common} cls="" placeholder="Write something, or press '/' for commands…" />;
  }
}

function DiffBlock({ block, onDecision }) {
  return (
    <div className="diff-block">
      <div className="diff-head"><Icon name="sparkle" size={12} /> {block.diff.label || 'Tracked change'}
        <div className="proposed-actions">
          <button className="pa-btn pa-reject" onClick={() => onDecision(block.diff.proposalId, false)}>Reject</button>
          <button className="pa-btn pa-accept" onClick={() => onDecision(block.diff.proposalId, true)}><Icon name="check" size={12} /> Accept</button>
        </div>
      </div>
      <div className="diff-old" dangerouslySetInnerHTML={{ __html: block.diff.oldHtml }} />
      <div className="diff-new" dangerouslySetInnerHTML={{ __html: block.diff.newHtml }} />
    </div>
  );
}

function PageLinkBlock({ block, pageMeta, onOpenPage }) {
  const m = (pageMeta && pageMeta[block.pageId]) || { icon: '📄', title: 'Untitled' };
  return (
    <div className="b-page" onClick={() => onOpenPage && onOpenPage(block.pageId)}>
      <span className="b-page-ic">{m.icon}</span><span className="b-page-title">{m.title}</span>
      <Icon name="chevR" size={14} style={{ color: 'var(--tx-4)', marginLeft: 'auto' }} />
    </div>
  );
}

function ImageBlock({ block }) {
  return (
    <div className="b-image">
      <image-slot id={`img-${block.id}`} shape="rounded" radius="8" placeholder="Drop an image, or click to upload"></image-slot>
      <div className="cap" contentEditable suppressContentEditableWarning spellCheck={false}></div>
    </div>
  );
}

function BookmarkBlock({ block, setType }) {
  const [url, setUrl] = useState('');
  if (block.bm) {
    return (
      <a className="b-bookmark" href={block.bm.url} target="_blank" rel="noreferrer" onClick={(e) => e.preventDefault()}>
        <div className="bm-main">
          <div className="bm-title">{block.bm.title}</div>
          <div className="bm-desc">{block.bm.desc}</div>
          <div className="bm-url"><span className="fav"></span>{block.bm.url}</div>
        </div>
        <div className="bm-thumb"><Icon name="share" size={22} /></div>
      </a>
    );
  }
  const commit = () => {
    if (!url.trim()) return;
    let host = url; try { host = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace('www.', ''); } catch (e) {}
    setType(block.id, { bm: { url: url.startsWith('http') ? url : 'https://' + url, title: host.split('.')[0].replace(/^\w/, (c) => c.toUpperCase()) + ' — link preview', desc: 'A saved bookmark. In a live workspace this card shows the page title, description, and favicon.' } });
  };
  return (
    <div className="st-link-pop" style={{ padding: 0, margin: '4px 0' }}>
      <input autoFocus placeholder="Paste a link to bookmark…" value={url} onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} style={{ width: 320 }} />
      <button className="pa-btn pa-accept" onClick={commit}>Create</button>
    </div>
  );
}

// ---- slash menu ----
function SlashMenu({ x, y, query, onPick, onClose }) {
  const [sel, setSel] = useState(0);
  const items = SLASH_ITEMS.filter((it) => !query || it.label.toLowerCase().includes(query.toLowerCase()) || it.type.includes(query.toLowerCase()));
  useEffect(() => { setSel(0); }, [query]);
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); items[sel] && onPick(items[sel]); }
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [items, sel]);
  if (!items.length) return null;
  const top = Math.min(y, window.innerHeight - 340);
  const left = Math.min(x, window.innerWidth - 300);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onMouseDown={onClose} />
      <div className="menu scroll" style={{ left, top }}>
        <div className="menu-label">Basic blocks</div>
        {items.map((it, i) => (
          <div key={it.type} className={`menu-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); onPick(it); }}>
            <div className="menu-ic"><Icon name={it.icon} size={17} /></div>
            <div className="menu-tx"><b>{it.label}</b><small>{it.desc}</small></div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- helpers ----
function detectMarkdown(text) {
  const map = { '# ': 'h1', '## ': 'h2', '### ': 'h3', '- ': 'li', '* ': 'li', '1. ': 'numli', '> ': 'quote', '[] ': 'todo', '[ ] ': 'todo', '```': 'code', '--- ': 'divider', '> ': 'quote' };
  for (const k of Object.keys(map)) if (text === k || text === k.trimEnd()) { if (k === '```' && text !== '```') continue; return { type: map[k] }; }
  if (text === '```') return { type: 'code' };
  if (text === '>' + ' ') return { type: 'quote' };
  return null;
}
function caretRect() {
  const s = window.getSelection(); if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0).cloneRange(); r.collapse(true);
  let rect = r.getBoundingClientRect();
  if ((!rect || (rect.left === 0 && rect.top === 0)) && r.startContainer.getBoundingClientRect) rect = r.startContainer.getBoundingClientRect();
  return rect;
}
function mentionQuery() {
  const s = window.getSelection(); if (!s || !s.rangeCount || !s.isCollapsed) return null;
  const node = s.anchorNode; if (!node || node.nodeType !== 3) return null;
  const before = node.textContent.slice(0, s.anchorOffset);
  const m = before.match(/(?:^|\s)@(\w{0,20})$/);
  return m ? m[1] : null;
}
function insertMentionChip(el, item, queryLen) {
  const s = window.getSelection(); if (!s.rangeCount) return;
  const range = s.getRangeAt(0);
  // delete '@' + query
  range.setStart(range.startContainer, Math.max(0, range.startOffset - queryLen - 1));
  range.deleteContents();
  const span = document.createElement('span');
  span.contentEditable = 'false';
  if (item.kind === 'person') { span.className = 'mention'; span.innerHTML = `<span class="pico" style="background:${item.color}">${item.initials[0]}</span>${item.label}`; }
  else if (item.kind === 'page') { span.className = 'mention page'; span.textContent = `${item.emoji} ${item.label}`; }
  else { span.className = 'mention date'; span.textContent = '📅 ' + item.label.replace(/\s*\(.*\)/, ''); }
  range.insertNode(span);
  const space = document.createTextNode('\u00A0');
  span.after(space);
  const nr = document.createRange(); nr.setStartAfter(space); nr.collapse(true);
  s.removeAllRanges(); s.addRange(nr);
}
function placeCaretEnd(el) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }

Object.assign(window, { Editor, SLASH_ITEMS });
