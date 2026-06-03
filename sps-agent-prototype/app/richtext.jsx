// richtext.jsx — floating selection toolbar (bold/italic/underline/strike/code/link/color/comment)
const { useState: useStateRT, useEffect: useEffectRT, useRef: useRefRT } = React;

const TEXT_COLORS = [
  ['default', 'inherit'], ['gray', '#6B7079'], ['brown', '#8a6a4a'], ['red', '#A1202C'],
  ['orange', '#9a6212'], ['green', '#1F6B3A'], ['blue', '#1B4F8A'], ['purple', '#5A3A8A'],
];
const HILITES = [
  ['yellow', 'rgba(242,183,5,0.32)'], ['green', 'rgba(31,107,58,0.22)'],
  ['blue', 'rgba(27,79,138,0.20)'], ['red', 'rgba(161,32,44,0.18)'], ['purple', 'rgba(90,58,138,0.20)'],
];

function inEditableBlock(node) {
  let el = node && node.nodeType === 3 ? node.parentElement : node;
  while (el) {
    if (el.classList && (el.classList.contains('block') || el.classList.contains('cap'))) return el;
    if (el.classList && el.classList.contains('doc-title')) return el;
    el = el.parentElement;
  }
  return null;
}

function SelectionToolbar({ onComment, onAsk }) {
  const [box, setBox] = useState(null); // {x,y}
  const [marks, setMarks] = useState({});
  const [pop, setPop] = useState(null); // 'color' | 'link'
  const [linkVal, setLinkVal] = useStateRT('');
  const barRef = useRefRT(null);
  const savedRange = useRefRT(null);

  useEffectRT(() => {
    const update = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setBox(null); setPop(null); return; }
      const range = sel.getRangeAt(0);
      const blk = inEditableBlock(sel.anchorNode);
      if (!blk || !blk.isContentEditable || !sel.toString().trim()) { setBox(null); setPop(null); return; }
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { setBox(null); return; }
      savedRange.current = range.cloneRange();
      setBox({ x: r.left + r.width / 2, y: r.top });
      setMarks({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
      });
    };
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', () => setBox(null), true);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  const restore = () => {
    if (!savedRange.current) return;
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange.current);
  };
  const exec = (cmd, val) => { restore(); document.execCommand(cmd, false, val); setMarks((m) => ({ ...m, [cmd === 'strikeThrough' ? 'strike' : cmd]: !m[cmd === 'strikeThrough' ? 'strike' : cmd] })); };
  const wrapCode = () => {
    restore();
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const txt = sel.toString();
    document.execCommand('insertHTML', false, `<code>${escapeHtml(txt)}</code>`);
  };
  const applyColor = (hex) => { restore(); document.execCommand('foreColor', false, hex); setPop(null); setBox(null); };
  const applyHilite = (rgba) => { restore(); document.execCommand('hiliteColor', false, rgba); setPop(null); setBox(null); };
  const applyLink = () => { if (!linkVal) return; restore(); document.execCommand('createLink', false, linkVal); setPop(null); setBox(null); setLinkVal(''); };
  const doComment = () => {
    restore();
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const txt = sel.toString();
    const cid = uid('cmt');
    document.execCommand('insertHTML', false, `<span class="cmt-anchor" data-cmt="${cid}">${escapeHtml(txt)}</span>`);
    onComment(cid, txt);
    setBox(null);
  };
  const doAsk = () => { const txt = savedRange.current ? savedRange.current.toString() : ''; setBox(null); window.getSelection().removeAllRanges(); if (onAsk && txt) onAsk(txt); };

  if (!box) return null;
  const W = 0; // toolbar centers via transform
  const top = Math.max(box.y - 46, 8);
  return (
    <>
      <div className="sel-toolbar" ref={barRef} style={{ left: box.x, top, transform: 'translateX(-50%)' }}
        onMouseDown={(e) => e.preventDefault()}>
        <button className={`st-btn ${marks.bold ? 'on' : ''}`} onClick={() => exec('bold')}><b>B</b></button>
        <button className={`st-btn ${marks.italic ? 'on' : ''}`} onClick={() => exec('italic')}><i>i</i></button>
        <button className={`st-btn ${marks.underline ? 'on' : ''}`} onClick={() => exec('underline')}><u>U</u></button>
        <button className={`st-btn ${marks.strike ? 'on' : ''}`} onClick={() => exec('strikeThrough')}><s>S</s></button>
        <button className="st-btn" onClick={wrapCode} title="Inline code" style={{ fontFamily: 'var(--font-mono)' }}>{'<>'}</button>
        <span className="st-sep"></span>
        <button className="st-btn" onClick={() => { setPop(pop === 'link' ? null : 'link'); }} title="Link"><Icon name="share" size={15} /></button>
        <button className="st-btn" onClick={() => setPop(pop === 'color' ? null : 'color')} title="Color"><span style={{ fontWeight: 700 }}>A</span><Icon name="chevD" size={11} /></button>
        <span className="st-sep"></span>
        <button className="st-btn" onClick={doAsk} title="Ask the assistant"><Icon name="sparkle" size={15} /> Ask AI</button>
        <button className="st-btn" onClick={doComment} title="Comment"><Icon name="comment" size={15} /></button>
      </div>

      {pop === 'color' && (
        <div className="st-pop" style={{ left: box.x - 90, top: top + 38 }} onMouseDown={(e) => e.preventDefault()}>
          <div className="menu-label">Text</div>
          <div className="sw-row">
            {TEXT_COLORS.map(([name, hex]) => (
              <div key={name} className="sw" title={name} style={{ color: hex === 'inherit' ? 'var(--tx-1)' : hex }} onClick={() => applyColor(hex === 'inherit' ? '#1B1D21' : hex)}>A</div>
            ))}
          </div>
          <div className="menu-label">Highlight</div>
          <div className="sw-row">
            {HILITES.map(([name, rgba]) => (
              <div key={name} className="sw" title={name} style={{ background: rgba }} onClick={() => applyHilite(rgba)}></div>
            ))}
          </div>
        </div>
      )}
      {pop === 'link' && (
        <div className="st-pop" style={{ left: box.x - 120, top: top + 38 }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="st-link-pop">
            <input autoFocus placeholder="Paste a link…" value={linkVal} onChange={(e) => setLinkVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyLink(); if (e.key === 'Escape') setPop(null); }} />
            <button className="pa-btn pa-accept" onMouseDown={(e) => { e.preventDefault(); applyLink(); }}>Link</button>
          </div>
        </div>
      )}
    </>
  );
}

function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

Object.assign(window, { SelectionToolbar, escapeHtml });
