// sidebar.jsx — workspace rail: state-driven page tree with drag reorder/nest
const { useState: useStateS } = React;

function Sidebar({ tree, meta, activeId, pathIds, onSelect, onOpenPalette, onNewPage, onNewSubPage, onRename, onDelete, onMove, onTrash }) {
  const [drag, setDrag] = useStateS(null);
  const [over, setOver] = useStateS(null); // {id, where}
  const dnd = { drag, setDrag, over, setOver, onMove };
  return (
    <nav className="rail">
      <div className="rail-top">
        <span className="wmark"><span>S</span></span>
        <span className="wname">SPS Agent</span>
        <span className="rail-chev"><Icon name="chevD" size={15} /></span>
      </div>
      <div className="rail-scroll scroll">
        <div className="nav-item" onClick={onOpenPalette}><Icon name="search" size={17} /><span className="nav-label">Search</span><span className="nav-kbd">⌘K</span></div>
        <div className={`nav-item ${activeId === "home" ? "active" : ""}`} onClick={() => onSelect("home")}><Icon name="home" size={17} /><span className="nav-label">Home</span></div>
        <div className="nav-item" onClick={onOpenPalette}><Icon name="inbox" size={17} /><span className="nav-label">Inbox</span><span className="nav-kbd">3</span></div>

        <div className="sec"><span className="sec-label">Workspace</span><span className="sec-add" title="New page" onClick={onNewPage}><Icon name="plus" size={15} /></span></div>
        {tree.map((n) => <TreeNode key={n.id} node={n} depth={0} meta={meta} activeId={activeId} pathIds={pathIds} onSelect={onSelect} onNewSubPage={onNewSubPage} onRename={onRename} onDelete={onDelete} dnd={dnd} />)}
        {tree.length === 0 && <div className="tree-row" style={{ color: "var(--tx-4)", cursor: "default" }}><span className="tree-toggle leaf"></span>No pages</div>}

        <div className="sec"><span className="sec-label">More</span></div>
        <div className="nav-item" onClick={onNewPage}><Icon name="plus" size={17} /><span className="nav-label">New page</span></div>
        <div className="nav-item" onClick={onTrash}><Icon name="trash" size={17} /><span className="nav-label">Trash</span></div>
      </div>
      <div className="rail-foot">
        <span className="avatar">MR</span>
        <span className="rail-foot-name">Maya Rao<small>Product · Acme</small></span>
        <Icon name="settings" size={16} style={{ color: "var(--tx-3)" }} />
      </div>
    </nav>
  );
}

function TreeNode({ node, depth, meta, activeId, pathIds, onSelect, onNewSubPage, onRename, onDelete, dnd }) {
  const m = meta[node.id] || { icon: "📄", title: "Untitled" };
  const hasKids = node.children && node.children.length > 0;
  const [open, setOpen] = useStateS(depth === 0);
  const [menu, setMenu] = useStateS(false);
  const isOver = dnd.over && dnd.over.id === node.id;

  const onDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const where = y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    dnd.setOver({ id: node.id, where });
  };
  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (dnd.drag && dnd.over) { onMoveSafe(dnd, node.id); if (dnd.over.where === "inside") setOpen(true); }
    dnd.setDrag(null); dnd.setOver(null);
  };

  return (
    <div>
      <div className={`tree-row ${activeId === node.id ? "active" : ""} ${isOver ? "dnd-" + dnd.over.where : ""}`}
        draggable onDragStart={(e) => { e.stopPropagation(); dnd.setDrag(node.id); }} onDragEnd={() => { dnd.setDrag(null); dnd.setOver(null); }}
        onDragOver={onDragOver} onDrop={onDrop} onClick={() => onSelect(node.id)}>
        <span className={`tree-toggle ${hasKids ? "" : "leaf"} ${open ? "open" : ""}`} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}><Icon name="chevR" size={13} /></span>
        <span className="tree-emoji">{m.icon}</span>
        <span className="tree-label">{m.title}</span>
        <span className="tree-add" title="Add sub-page" onClick={(e) => { e.stopPropagation(); onNewSubPage(node.id); }}><Icon name="plus" size={14} /></span>
        <span className="tree-add" title="More" onClick={(e) => { e.stopPropagation(); setMenu(true); }}><Icon name="dots" size={14} /></span>
      </div>
      {menu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 63 }} onMouseDown={() => setMenu(false)} />
          <div className="menu" style={{ left: 60 + depth * 14, marginTop: -4, zIndex: 64, minWidth: 180 }}>
            <div className="menu-mini" onClick={() => { setMenu(false); const t = prompt("Rename page", m.title); if (t != null && t.trim()) onRename(node.id, t.trim()); }}><Icon name="text" size={15} /> Rename</div>
            <div className="menu-mini" onClick={() => { setMenu(false); onNewSubPage(node.id); }}><Icon name="plus" size={15} /> Add sub-page</div>
            <div className="menu-divider"></div>
            <div className="menu-mini danger" onClick={() => { setMenu(false); onDelete(node.id); }}><Icon name="trash" size={15} /> Delete</div>
          </div>
        </>
      )}
      {hasKids && open && <div className="tree-children">{node.children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} meta={meta} activeId={activeId} pathIds={pathIds} onSelect={onSelect} onNewSubPage={onNewSubPage} onRename={onRename} onDelete={onDelete} dnd={dnd} />)}</div>}
    </div>
  );
}

function onMoveSafe(dnd, targetId) { try { dnd.onMove(dnd.drag, targetId, dnd.over.where); } catch (e) {} }

Object.assign(window, { Sidebar });
