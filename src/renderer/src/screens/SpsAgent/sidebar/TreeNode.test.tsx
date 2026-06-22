import { createEvent, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { TreeNode } from "./TreeNode";
import type { DropWhere } from "../lib/tree";
import type { TreeDnd } from "./dnd";

function rect(top: number, height: number): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 240,
    width: 240,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function Harness({
  onMove,
}: {
  onMove: (dragId: string, targetId: string, where: DropWhere) => void;
}) {
  const [drag, setDrag] = useState<string | null>("dragged");
  const [over, setOver] = useState<TreeDnd["over"]>(null);

  return (
    <TreeNode
      node={{ id: "target", children: [] }}
      depth={0}
      meta={{ target: { title: "Target", icon: "📄", cover: null } }}
      activeId=""
      onSelect={vi.fn()}
      onNewSubPage={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      dnd={{ drag, setDrag, over, setOver, onMove }}
    />
  );
}

describe("TreeNode drag/drop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["before", 10],
    ["inside", 50],
    ["after", 90],
  ] as const)("maps drag position to %s drops", (where, clientY) => {
    const onMove = vi.fn();
    const { container } = render(<Harness onMove={onMove} />);
    const row = container.querySelector(".tree-row") as HTMLElement;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect(0, 100));

    const dragOver = createEvent.dragOver(row);
    Object.defineProperty(dragOver, "clientY", { value: clientY });
    fireEvent(row, dragOver);
    fireEvent.drop(row);

    expect(onMove).toHaveBeenCalledWith("dragged", "target", where);
  });
});
