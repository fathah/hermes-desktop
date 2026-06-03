// pickers.jsx — emoji picker, mention menu, cover picker
const { useState: useStateP2, useEffect: useEffectP2, useRef: useRefP2 } = React;

const EMOJI = {
  'Suggested': ['📄','🏠','🎯','🚀','📌','✅','💡','🔥','⭐','📊','🗓️','🧭','🛠️','📝','🔔','🧪'],
  'Objects': ['📁','📦','📈','📉','💼','🔖','📎','🗂️','📋','🗒️','📌','✏️','🖊️','📐','🔑','🧱','⚙️','🔧','🧰','💾'],
  'Symbols': ['✅','❇️','⚡','💠','🔷','🔶','🟢','🟡','🔴','🔵','🟣','⬛','⬜','♻️','🆕','🔝'],
  'Nature': ['🌱','🌿','🍃','🌲','🌳','⛰️','🌊','☀️','🌙','⭐','🔥','❄️','🌸','🍂','🌼','🪴'],
  'People': ['👥','🧑‍💻','👩‍💼','🧑‍🔧','🙋','🤝','💬','🧠','👀','✋','👍','🙌'],
  'Travel': ['🚢','✈️','🗺️','🧭','🏗️','🏢','🏠','🚀','🛰️','🛣️','🏁','📍'],
};

function EmojiPicker({ x, y, onPick, onRemove, onClose }) {
  const [q, setQ] = useStateP2('');
  const ql = q.toLowerCase();
  const left = Math.min(x, window.innerWidth - 336);
  const top = Math.min(y, window.innerHeight - 320);
  const cats = Object.entries(EMOJI);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 74 }} onMouseDown={onClose} />
      <div className="emoji-pop" style={{ left, top }}>
        <input className="emoji-search" autoFocus placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="emoji-grid scroll">
          {q
            ? cats.flatMap(([, arr]) => arr).filter((e, i, a) => a.indexOf(e) === i)
                .map((e, i) => <div key={i} className="emoji-cell" onClick={() => onPick(e)}>{e}</div>)
            : cats.map(([cat, arr]) => (
              <React.Fragment key={cat}>
                <div className="emoji-cat">{cat}</div>
                {arr.map((e, i) => <div key={cat + i} className="emoji-cell" onClick={() => onPick(e)}>{e}</div>)}
              </React.Fragment>
            ))}
        </div>
        <div className="emoji-foot">
          <button className="cover-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(randomEmoji()); }}><Icon name="sparkle" size={13} /> Random</button>
          <button className="cover-btn" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </>
  );
}
function randomEmoji() { const all = Object.values(EMOJI).flat(); return all[Math.floor(Math.random() * all.length)]; }

// ---- mention menu (@) ----
function MentionMenu({ x, y, query, onPick, onClose }) {
  const [sel, setSel] = useStateP2(0);
  const ql = (query || '').toLowerCase();
  const people = Object.entries(PEOPLE).map(([k, p]) => ({ kind: 'person', id: k, label: p.name, color: p.color, initials: p.initials }));
  const pages = flattenTree(TREE).map((n) => ({ kind: 'page', id: n.id, label: n.label, emoji: n.emoji }));
  const dates = [
    { kind: 'date', id: 'today', label: 'Today (Jun 2, 2026)' },
    { kind: 'date', id: 'tomorrow', label: 'Tomorrow (Jun 3, 2026)' },
    { kind: 'date', id: 'friday', label: 'Friday (Jun 5, 2026)' },
  ];
  const all = [...people, ...pages, ...dates].filter((i) => !ql || i.label.toLowerCase().includes(ql));
  useEffectP2(() => { setSel(0); }, [query]);
  useEffectP2(() => {
    const h = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, all.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); all[sel] && onPick(all[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [all, sel]);
  if (!all.length) return null;
  const top = Math.min(y, window.innerHeight - Math.min(all.length * 40 + 30, 320) - 10);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onMouseDown={onClose} />
      <div className="menu scroll" style={{ left: x, top, minWidth: 250 }}>
        {people.length > 0 && !ql && <div className="menu-label">People</div>}
        {all.map((it, i) => (
          <div key={it.kind + it.id} className={`menu-mini ${i === sel ? 'sel' : ''}`}
            onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); onPick(it); }}>
            {it.kind === 'person' && <span className="mention" style={{ background: 'transparent', padding: 0 }}><span className="pico" style={{ background: it.color }}>{it.initials[0]}</span></span>}
            {it.kind === 'page' && <span>{it.emoji}</span>}
            {it.kind === 'date' && <Icon name="calendar" size={15} />}
            <span style={{ flex: 1 }}>{it.label}</span>
            <span style={{ color: 'var(--tx-4)', fontSize: 11 }}>{it.kind}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- cover color picker ----
const COVERS = [
  ['Ochre', 'var(--accent)'], ['Navy', '#1B4F8A'], ['Brick', '#A1202C'], ['Green', '#1F6B3A'],
  ['Slate', '#44484F'], ['Sand', '#C9C1AE'], ['Plum', '#5A3A8A'], ['Ink', '#161511'],
];
function CoverPicker({ x, y, onPick, onImage, onRemove, onClose }) {
  const left = Math.min(x, window.innerWidth - 280);
  const top = Math.min(y, window.innerHeight - 200);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 74 }} onMouseDown={onClose} />
      <div className="emoji-pop" style={{ left, top, width: 256 }}>
        <div className="menu-label">Cover color</div>
        <div className="sw-row">
          {COVERS.map(([name, col]) => (
            <div key={name} className="sw" title={name} style={{ background: col, width: 44, height: 30 }} onClick={() => onPick(col)}></div>
          ))}
        </div>
        <div className="emoji-foot">
          <button className="cover-btn" onClick={onImage}><Icon name="doc" size={13} /> Upload image</button>
          <button className="cover-btn" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { EmojiPicker, MentionMenu, CoverPicker, randomEmoji });
