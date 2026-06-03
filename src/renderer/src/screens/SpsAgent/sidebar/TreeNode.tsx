// TreeNode.tsx — one row of the sidebar page tree with drag reorder/nest + menu.
// Ported from sidebar.jsx TreeNode.
import { useState } from "react";
import { Icon } from "../components/Icon";
import type { DropWhere } from "../lib/tree";
import type { PageMeta, TreeNode as TreeNodeT } from "../types";
import type { TreeDnd } from "./dnd";

interface Props {
  node: TreeNodeT;
  depth: number;
  meta: Record<string, PageMeta>;
  activeId: string;
  onSelect: (id: string) => void;
  onNewSubPage: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  dnd: TreeDnd;
}

export function TreeNode({
  node,
  depth,
  meta,
  activeId,
  onSelect,
  onNewSubPage,
  onRename,
  onDelete,
  dnd,
}: Props) {
  const m = meta[node.id] || { icon: "📄", title: "Untitled", cover: null };
  const hasKids = node.children && node.children.length > 0;
  const [open, setOpen] = useState(depth === 0);
  const [menu, setMenu] = useState(false);
  const isOver = dnd.over && dnd.over.id === node.id;

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const where: DropWhere =
      y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    dnd.setOver({ id: node.id, where });
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dnd.drag && dnd.over) {
      try {
        dnd.onMove(dnd.drag, node.id, dnd.over.where);
      } catch {
        /* ignore invalid drop */
      }
      if (dnd.over.where === "inside") setOpen(true);
    }
    dnd.setDrag(null);
    dnd.setOver(null);
  };

  return (
    <div>
      <div
        className={`tree-row ${activeId === node.id ? "active" : ""} ${isOver ? "dnd-" + dnd.over!.where : ""}`}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          dnd.setDrag(node.id);
        }}
        onDragEnd={() => {
          dnd.setDrag(null);
          dnd.setOver(null);
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => onSelect(node.id)}
      >
        <span
          className={`tree-toggle ${hasKids ? "" : "leaf"} ${open ? "open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <Icon name="chevR" size={13} />
        </span>
        <span className="tree-emoji">{m.icon}</span>
        <span className="tree-label">{m.title}</span>
        <span
          className="tree-add"
          title="Add sub-page"
          onClick={(e) => {
            e.stopPropagation();
            onNewSubPage(node.id);
          }}
        >
          <Icon name="plus" size={14} />
        </span>
        <span
          className="tree-add"
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            setMenu(true);
          }}
        >
          <Icon name="dots" size={14} />
        </span>
      </div>
      {menu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 63 }}
            onMouseDown={() => setMenu(false)}
          />
          <div
            className="menu"
            style={{
              left: 60 + depth * 14,
              marginTop: -4,
              zIndex: 64,
              minWidth: 180,
            }}
          >
            <div
              className="menu-mini"
              onClick={() => {
                setMenu(false);
                const tt = prompt("Rename page", m.title);
                if (tt != null && tt.trim()) onRename(node.id, tt.trim());
              }}
            >
              <Icon name="text" size={15} /> Rename
            </div>
            <div
              className="menu-mini"
              onClick={() => {
                setMenu(false);
                onNewSubPage(node.id);
              }}
            >
              <Icon name="plus" size={15} /> Add sub-page
            </div>
            <div className="menu-divider"></div>
            <div
              className="menu-mini danger"
              onClick={() => {
                setMenu(false);
                onDelete(node.id);
              }}
            >
              <Icon name="trash" size={15} /> Delete
            </div>
          </div>
        </>
      )}
      {hasKids && open && (
        <div className="tree-children">
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              meta={meta}
              activeId={activeId}
              onSelect={onSelect}
              onNewSubPage={onNewSubPage}
              onRename={onRename}
              onDelete={onDelete}
              dnd={dnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}
