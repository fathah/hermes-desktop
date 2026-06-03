// Sidebar.tsx — workspace rail: state-driven page tree with drag reorder/nest.
// Ported from sidebar.jsx; reads tree/meta from the store.
import { useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { DropWhere } from "../lib/tree";
import type { TreeDnd } from "./dnd";
import { TreeNode } from "./TreeNode";

export function Sidebar() {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const activeId = useStore((s) => s.page);
  const surface = useStore((s) => s.surface);
  const setSurface = useStore((s) => s.setSurface);
  const selectPage = useStore((s) => s.selectPage);
  // Selecting a page always returns to the document surface.
  const selectDoc = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };
  const newSubPage = useStore((s) => s.newSubPage);
  const renamePage = useStore((s) => s.renamePage);
  const deletePage = useStore((s) => s.deletePage);
  const movePage = useStore((s) => s.movePage);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setTrashOpen = useStore((s) => s.setTrashOpen);
  const setTweaksOpen = useStore((s) => s.setTweaksOpen);

  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: DropWhere } | null>(
    null,
  );
  const dnd: TreeDnd = { drag, setDrag, over, setOver, onMove: movePage };

  const openPalette = () => setPaletteOpen(true);
  const newPage = () => setTemplatesOpen({ parent: null });

  return (
    <nav className="rail">
      <div className="rail-top">
        <span className="wmark">
          <span>S</span>
        </span>
        <span className="wname">SPS Agent</span>
        <span className="rail-chev">
          <Icon name="chevD" size={15} />
        </span>
      </div>
      <div className="rail-scroll scroll">
        <div className="nav-item" onClick={openPalette}>
          <Icon name="search" size={17} />
          <span className="nav-label">Search</span>
          <span className="nav-kbd">⌘K</span>
        </div>
        <div
          className={`nav-item ${activeId === "home" && surface === "doc" ? "active" : ""}`}
          onClick={() => selectDoc("home")}
        >
          <Icon name="home" size={17} />
          <span className="nav-label">Home</span>
        </div>
        <div className="nav-item" onClick={openPalette}>
          <Icon name="inbox" size={17} />
          <span className="nav-label">Inbox</span>
          <span className="nav-kbd">3</span>
        </div>
        <div
          className={`nav-item ${surface === "ask" ? "active" : ""}`}
          onClick={() => setSurface("ask")}
        >
          <Icon name="sparkle" size={17} />
          <span className="nav-label">Ask</span>
        </div>
        <div
          className={`nav-item ${surface === "insights" ? "active" : ""}`}
          onClick={() => setSurface("insights")}
        >
          <Icon name="board" size={17} />
          <span className="nav-label">Insights</span>
        </div>
        <div
          className={`nav-item ${surface === "memory" ? "active" : ""}`}
          onClick={() => setSurface("memory")}
        >
          <Icon name="clock" size={17} />
          <span className="nav-label">Memory</span>
        </div>
        <div
          className={`nav-item ${surface === "agent" ? "active" : ""}`}
          onClick={() => setSurface("agent")}
        >
          <Icon name="code" size={17} />
          <span className="nav-label">Agent Console</span>
        </div>

        <div className="sec">
          <span className="sec-label">Workspace</span>
          <span className="sec-add" title="New page" onClick={newPage}>
            <Icon name="plus" size={15} />
          </span>
        </div>
        {tree.map((n) => (
          <TreeNode
            key={n.id}
            node={n}
            depth={0}
            meta={meta}
            activeId={activeId}
            onSelect={selectDoc}
            onNewSubPage={newSubPage}
            onRename={renamePage}
            onDelete={deletePage}
            dnd={dnd}
          />
        ))}
        {tree.length === 0 && (
          <div
            className="tree-row"
            style={{ color: "var(--tx-4)", cursor: "default" }}
          >
            <span className="tree-toggle leaf"></span>No pages
          </div>
        )}

        <div className="sec">
          <span className="sec-label">More</span>
        </div>
        <div className="nav-item" onClick={newPage}>
          <Icon name="plus" size={17} />
          <span className="nav-label">New page</span>
        </div>
        <div className="nav-item" onClick={() => setTrashOpen(true)}>
          <Icon name="trash" size={17} />
          <span className="nav-label">Trash</span>
        </div>
      </div>
      <div className="rail-foot">
        <span className="avatar">MR</span>
        <span className="rail-foot-name">
          Maya Rao<small>Product · Acme</small>
        </span>
        <span
          title="Tweaks"
          style={{ cursor: "pointer", display: "inline-flex" }}
          onClick={() => setTweaksOpen(true)}
        >
          <Icon name="settings" size={16} style={{ color: "var(--tx-3)" }} />
        </span>
      </div>
    </nav>
  );
}
