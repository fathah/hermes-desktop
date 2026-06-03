// palette.jsx — Cmd-K command palette (quick switch + actions + content search)
const { useState: useStateP, useEffect: useEffectP, useRef: useRefP } = React;

function flattenTree(nodes, acc = []) {
  for (const n of nodes) { acc.push(n); if (n.children) flattenTree(n.children, acc); }
  return acc;
}

function CommandPalette({ onClose, onSelectPage, actions, searchContent }) {
  const [q, setQ] = useStateP('');
  const [sel, setSel] = useStateP(0);
  const inputRef = useRefP(null);
  useEffectP(() => { inputRef.current?.focus(); }, []);

  const pages = flattenTree(TREE).map((n) => ({ kind: 'page', id: n.id, emoji: n.emoji, label: n.label }));
  const acts = actions.map((a) => ({ kind: 'action', ...a }));
  const ql = q.toLowerCase();
  const fActs = q ? acts.filter((i) => i.label.toLowerCase().includes(ql)) : acts;
  const fPages = q ? pages.filter((i) => i.label.toLowerCase().includes(ql)) : pages;
  const content = q && searchContent ? searchContent(q) : [];

  const grouped = [
    { label: 'Actions', items: fActs },
    { label: 'Jump to', items: fPages },
    { label: 'In pages', items: content.map((c) => ({ kind: 'content', id: c.pageId + c.snippet.slice(0, 8), pageId: c.pageId, label: c.title, snippet: c.snippet, emoji: c.emoji })) },
  ].filter((g) => g.items.length);
  const flat = grouped.flatMap((g) => g.items);

  useEffectP(() => { setSel(0); }, [q]);
  useEffectP(() => {
    const h = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(flat[sel]); }
      else if (e.key === 'Escape') { onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [flat, sel]);

  const pick = (item) => {
    if (!item) return;
    if (item.kind === 'action') item.run();
    else if (item.kind === 'content') onSelectPage(item.pageId);
    else onSelectPage(item.id);
    onClose();
  };

  let idx = -1;
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <Icon name="search" size={18} style={{ color: 'var(--tx-3)' }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, content, or run a command…" />
          <span className="kbd">esc</span>
        </div>
        <div className="pal-list scroll">
          {grouped.length === 0 && <div className="pal-group">No results for “{q}”</div>}
          {grouped.map((g) => (
            <div key={g.label}>
              <div className="pal-group">{g.label}</div>
              {g.items.map((item) => {
                idx++; const here = idx;
                return (
                  <div key={item.kind + item.id} className={`pal-item ${here === sel ? 'sel' : ''}`}
                    onMouseEnter={() => setSel(here)} onMouseDown={() => pick(item)}>
                    <Icon name={item.kind === 'action' ? item.icon : 'doc'} size={17} />
                    {item.kind !== 'action' && <span style={{ marginLeft: -4 }}>{item.emoji}</span>}
                    <span className="label">{item.label}{item.kind === 'content' && <small style={{ display: 'block', color: 'var(--tx-3)', fontSize: 12 }}>{item.snippet}</small>}</span>
                    {item.hint && <span className="hint">{item.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="pal-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CommandPalette });
