// tasks.jsx — embedded database: block-controlled, persistent, inline-editable
const { useState: useStateT } = React;

function Avatar({ who, size = 18 }) { const p = PEOPLE[who] || { color: '#888', initials: '?' }; return <span className="av" style={{ background: p.color, width: size, height: size }}>{p.initials}</span>; }
function StatusChip({ s }) { const st = STATUS[s]; return <span className={`chip ${st.cls}`}><span className="pdot" style={{ background: st.dot }}></span>{st.label}</span>; }
function PrioChip({ p }) { const pr = PRIO[p]; return <span className={`chip ${pr.cls}`}>{pr.label}</span>; }

const VIEWS = [['board', 'Board', 'board'], ['table', 'Table', 'table'], ['list', 'List', 'list'], ['gallery', 'Gallery', 'callout'], ['calendar', 'Calendar', 'calendar']];
const SORTS = [['manual', 'Manual'], ['due', 'Due date'], ['prio', 'Priority'], ['title', 'Name']];
const PRIO_RANK = { high: 0, med: 1, low: 2 };

function TasksDB({ block, update, onOpenTask }) {
  const view = block.view || 'board';
  const rows = block.rows || TASKS;
  const fStatus = block.filter || [];
  const sort = block.sort || 'manual';
  const cols = block.cols || [];
  const [fOpen, setFOpen] = useStateT(null);
  const [prop, setProp] = useStateT(null); // {rowId, field, x, y}
  const [drag, setDrag] = useStateT(null);
  const [dropCol, setDropCol] = useStateT(null);

  const setRows = (fn) => update({ rows: fn(rows) });
  const setField = (id, field, val) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  const setCustom = (id, colId, val) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, custom: { ...(r.custom || {}), [colId]: val } } : r)));
  const cycle = (id) => { const order = ['todo', 'doing', 'review', 'done']; setRows((rs) => rs.map((r) => r.id === id ? { ...r, status: order[(order.indexOf(r.status) + 1) % 4] } : r)); };
  const addRow = () => setRows((rs) => [...rs, { id: uid('t'), title: 'New task', status: 'todo', prio: 'med', who: 'maya', due: 'Jun 9', est: '1d' }]);
  const addCol = () => update({ cols: [...cols, { id: uid('col'), name: 'Notes' }] });

  let shown = fStatus.length ? rows.filter((r) => fStatus.includes(r.status)) : rows;
  if (sort !== 'manual') shown = [...shown].sort((a, b) => sort === 'prio' ? PRIO_RANK[a.prio] - PRIO_RANK[b.prio] : sort === 'title' ? a.title.localeCompare(b.title) : parseDue(a.due) - parseDue(b.due));

  const openProp = (e, rowId, field) => { const r = e.currentTarget.getBoundingClientRect(); setProp({ rowId, field, x: r.left, y: r.bottom + 4 }); };

  const shared = { onOpenTask, openProp, cycle };
  return (
    <div className="db">
      <div className="db-head">
        {VIEWS.map(([v, label, icon]) => <div key={v} className={`db-tab ${view === v ? 'active' : ''}`} onClick={() => update({ view: v })}><Icon name={icon} size={15} /> {label}</div>)}
        <div className="db-spacer"></div>
        <div className={`db-tool ${fStatus.length ? 'on' : ''}`} onClick={(e) => setFOpen(fOpen === 'filter' ? null : { kind: 'filter', x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 })}><Icon name="filter" size={14} /> Filter{fStatus.length ? ` (${fStatus.length})` : ''}</div>
        <div className={`db-tool ${sort !== 'manual' ? 'on' : ''}`} onClick={(e) => setFOpen(fOpen === 'sort' ? null : { kind: 'sort', x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 })}><Icon name="sort" size={14} /> Sort</div>
      </div>

      {view === 'table' && <TableView tasks={shown} cols={cols} {...shared} setCustom={setCustom} addRow={addRow} addCol={addCol} />}
      {view === 'board' && <BoardView tasks={shown} onOpenTask={onOpenTask} drag={drag} setDrag={setDrag} dropCol={dropCol} setDropCol={setDropCol} setStatus={(id, s) => setField(id, 'status', s)} addRow={addRow} />}
      {view === 'list' && <ListView tasks={shown} onOpenTask={onOpenTask} cycle={cycle} />}
      {view === 'gallery' && <GalleryView tasks={shown} onOpenTask={onOpenTask} />}
      {view === 'calendar' && <CalendarView tasks={shown} onOpenTask={onOpenTask} />}

      {fOpen && fOpen.kind === 'filter' && (
        <FsPop x={fOpen.x} y={fOpen.y} onClose={() => setFOpen(null)} title="Filter by status">
          <div className="fs-chiprow">
            {Object.entries(STATUS).map(([k, st]) => <div key={k} className={`fs-chip ${fStatus.includes(k) ? 'on' : ''}`} onClick={() => update({ filter: fStatus.includes(k) ? fStatus.filter((x) => x !== k) : [...fStatus, k] })}>{st.label}</div>)}
          </div>
          {fStatus.length > 0 && <div className="fs-row"><button style={{ color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }} onClick={() => update({ filter: [] })}>Clear filter</button></div>}
        </FsPop>
      )}
      {fOpen && fOpen.kind === 'sort' && (
        <FsPop x={fOpen.x} y={fOpen.y} onClose={() => setFOpen(null)} title="Sort by">
          {SORTS.map(([k, label]) => <div key={k} className="menu-mini" onClick={() => { update({ sort: k }); setFOpen(null); }}>{label}{sort === k && <span className="menu-sub-arrow"><Icon name="check" size={14} /></span>}</div>)}
        </FsPop>
      )}
      {prop && <PropMenu prop={prop} onClose={() => setProp(null)} onPick={(val) => { setField(prop.rowId, prop.field, val); setProp(null); }} />}
    </div>
  );
}

function PropMenu({ prop, onPick, onClose }) {
  const opts = prop.field === 'status' ? Object.entries(STATUS).map(([k, v]) => [k, v.label]) : prop.field === 'prio' ? Object.entries(PRIO).map(([k, v]) => [k, v.label]) : Object.entries(PEOPLE).map(([k, v]) => [k, v.name]);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 64 }} onMouseDown={onClose} />
      <div className="menu" style={{ left: Math.min(prop.x, window.innerWidth - 200), top: prop.y, zIndex: 65, minWidth: 170 }}>
        <div className="menu-label">Set {prop.field}</div>
        {opts.map(([k, label]) => (
          <div key={k} className="menu-mini" onClick={() => onPick(k)}>
            {prop.field === 'status' && <span className="pdot" style={{ background: STATUS[k].dot, width: 8, height: 8, borderRadius: 9 }}></span>}
            {prop.field === 'who' && <Avatar who={k} size={16} />}
            {label}
          </div>
        ))}
      </div>
    </>
  );
}

function TableView({ tasks, cols, onOpenTask, openProp, setCustom, addRow, addCol }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl">
        <thead><tr>
          <th style={{ minWidth: 220 }}><Icon name="text" size={13} />Task</th>
          <th><Icon name="board" size={13} />Status</th><th><Icon name="flag" size={13} />Priority</th>
          <th><Icon name="home" size={13} />Owner</th><th><Icon name="calendar" size={13} />Due</th>
          {cols.map((c) => <th key={c.id}>{c.name}</th>)}
          <th style={{ width: 34 }}><span className="db-tool" style={{ padding: 3 }} onClick={addCol} title="Add property"><Icon name="plus" size={14} /></span></th>
        </tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="c-name" onClick={() => onOpenTask(t)}>{t.title}</td>
              <td style={{ cursor: 'pointer' }} onClick={(e) => openProp(e, t.id, 'status')}><StatusChip s={t.status} /></td>
              <td style={{ cursor: 'pointer' }} onClick={(e) => openProp(e, t.id, 'prio')}><PrioChip p={t.prio} /></td>
              <td style={{ cursor: 'pointer' }} onClick={(e) => openProp(e, t.id, 'who')}><span className="person"><Avatar who={t.who} />{PEOPLE[t.who].name}</span></td>
              <td className="num">{t.due}</td>
              {cols.map((c) => (
                <td key={c.id}><span className="cell-edit" contentEditable suppressContentEditableWarning spellCheck={false}
                  onBlur={(e) => setCustom(t.id, c.id, e.currentTarget.textContent)} dangerouslySetInnerHTML={{ __html: (t.custom && t.custom[c.id]) || '' }} /></td>
              ))}
              <td></td>
            </tr>
          ))}
          <tr className="db-addrow"><td colSpan={6 + cols.length} onClick={addRow}><Icon name="plus" size={14} style={{ verticalAlign: -3, marginRight: 6 }} />New task</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function BoardView({ tasks, onOpenTask, drag, setDrag, dropCol, setDropCol, setStatus, addRow }) {
  const cols = ['todo', 'doing', 'review', 'done'];
  return (
    <div className="board scroll">
      {cols.map((c) => {
        const items = tasks.filter((t) => t.status === c);
        return (
          <div className={`board-col ${dropCol === c ? 'drop-target' : ''}`} key={c}
            onDragOver={(e) => { e.preventDefault(); setDropCol(c); }} onDrop={() => { if (drag) setStatus(drag, c); setDrag(null); setDropCol(null); }}>
            <div className="board-col-head"><span className="dot" style={{ background: STATUS[c].dot }}></span>{STATUS[c].label} <span className="count">{items.length}</span></div>
            {items.map((t) => (
              <div className={`card ${drag === t.id ? 'dragging' : ''}`} key={t.id} draggable
                onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setDropCol(null); }} onClick={() => onOpenTask(t)}>
                <div className="card-title">{t.title}</div>
                <div className="card-foot"><PrioChip p={t.prio} /><span style={{ flex: 1 }}></span><span className="num" style={{ fontSize: 12, color: 'var(--tx-3)' }}>{t.due}</span><Avatar who={t.who} /></div>
              </div>
            ))}
            <div className="card-add" onClick={addRow}><Icon name="plus" size={14} /> New</div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ tasks, onOpenTask, cycle }) {
  return (
    <div className="lst">
      {tasks.map((t) => (
        <div className="lst-row" key={t.id}>
          <div className={`check ${t.status === 'done' ? 'done' : ''}`} onClick={(e) => { e.stopPropagation(); cycle(t.id); }}>{t.status === 'done' && <Icon name="check" size={13} stroke={2.4} />}</div>
          <span className="c-name" onClick={() => onOpenTask(t)} style={t.status === 'done' ? { color: 'var(--tx-3)', textDecoration: 'line-through' } : {}}>{t.title}</span>
          <StatusChip s={t.status} /><span className="person"><Avatar who={t.who} /></span>
          <span className="num" style={{ fontSize: 12, color: 'var(--tx-3)', width: 52, textAlign: 'right' }}>{t.due}</span>
        </div>
      ))}
    </div>
  );
}

function GalleryView({ tasks, onOpenTask }) {
  return (
    <div className="gallery">
      {tasks.map((t) => (
        <div className="gal-card" key={t.id} onClick={() => onOpenTask(t)}>
          <div className="gal-cover" style={{ background: STATUS[t.status].dot }}>{t.title.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</div>
          <div className="gal-body"><div className="gal-title">{t.title}</div><div className="gal-foot"><StatusChip s={t.status} /><span style={{ flex: 1 }}></span><Avatar who={t.who} /></div></div>
        </div>
      ))}
    </div>
  );
}

function CalendarView({ tasks, onOpenTask }) {
  const year = 2026, month = 5;
  const first = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const evByDay = {};
  tasks.forEach((t) => { const p = parseDueParts(t.due); if (p && p.mon === 5) (evByDay[p.day] = evByDay[p.day] || []).push(t); });
  return (
    <div className="cal">
      <div className="cal-head">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}</div>
      <div className="cal-grid">
        {cells.map((d, i) => (
          <div key={i} className={`cal-day ${d == null ? 'out' : ''} ${d === 3 ? 'today' : ''}`}>
            {d != null && <div className="cal-dn">{d}</div>}
            {(evByDay[d] || []).map((t) => <div key={t.id} className="cal-ev" style={{ background: STATUS[t.status].dot + '22', borderLeftColor: STATUS[t.status].dot }} onClick={() => onOpenTask(t)}>{t.title}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function FsPop({ x, y, title, children, onClose }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 64 }} onMouseDown={onClose} />
      <div className="fs-pop" style={{ left: Math.min(x, window.innerWidth - 240), top: y, zIndex: 65 }}><div className="menu-label">{title}</div>{children}</div>
    </>
  );
}

function parseDueParts(due) { const m = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }; const [mon, day] = (due || '').split(' '); return mon in m ? { mon: m[mon], day: parseInt(day, 10) } : null; }
function parseDue(due) { const p = parseDueParts(due); return p ? p.mon * 100 + p.day : 9999; }

Object.assign(window, { TasksDB, Avatar, StatusChip, PrioChip });
