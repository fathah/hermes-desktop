// BlockRow.tsx — block wrapper: indent margin, drag gutter (add + grip), drop guide.
// Ported from editor.jsx BlockRow.
import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import type { Block } from "../types";

interface Props {
  block: Block;
  children: ReactNode;
  dragId: string | null;
  overId: string | null;
  overIndent: number;
  setDragId: (id: string | null) => void;
  setOverId: (id: string | null) => void;
  onDrop: (targetId: string) => void;
  computeIndent: (clientX: number) => void;
  onMenu: (rect: DOMRect) => void;
  onAdd: (rect: DOMRect) => void;
}

export function BlockRow({
  block,
  children,
  dragId,
  overId,
  overIndent,
  setDragId,
  setOverId,
  onDrop,
  computeIndent,
  onMenu,
  onAdd,
}: Props) {
  const pad = (block.indent || 0) * 24;
  const showGutter = block.type !== "divider";
  const isOver = overId === block.id && dragId && dragId !== block.id;
  return (
    <div
      className="block-wrap"
      id={`bw-${block.id}`}
      data-bg={block.bg || undefined}
      data-diff={block.diff ? block.diff.proposalId : undefined}
      style={{ marginLeft: pad }}
      onDragOver={(e) => {
        e.preventDefault();
        setOverId(block.id);
        computeIndent(e.clientX);
      }}
      onDrop={() => onDrop(block.id)}
    >
      {isOver && (
        <div
          className="drop-guide"
          style={{ marginLeft: (overIndent - (block.indent || 0)) * 24 }}
        ></div>
      )}
      <div className="block-row">
        {showGutter && (
          <div className="block-gutter">
            <button
              className="g-btn add"
              title="Add below"
              onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}
            >
              <Icon name="plus" size={16} />
            </button>
            <button
              className="g-btn"
              title="Drag to move · click for menu"
              draggable
              onClick={(e) => onMenu(e.currentTarget.getBoundingClientRect())}
              onDragStart={() => setDragId(block.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              <Icon name="grip" size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
