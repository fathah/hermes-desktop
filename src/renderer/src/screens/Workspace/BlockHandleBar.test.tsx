import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BlockHandleBar from "./BlockHandleBar";

describe("BlockHandleBar", () => {
  it("exposes block duplicate, delete, move, turn, and color actions", () => {
    const onAction = vi.fn();
    render(<BlockHandleBar blockId="block-a" onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate block" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete block" }));
    fireEvent.click(screen.getByRole("button", { name: "Move block up" }));
    fireEvent.change(screen.getByLabelText("Turn block into"), {
      target: { value: "todo" },
    });
    fireEvent.change(screen.getByLabelText("Block color"), {
      target: { value: "yellow" },
    });

    expect(onAction).toHaveBeenCalledWith({
      type: "duplicate",
      blockId: "block-a",
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "delete",
      blockId: "block-a",
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "move-up",
      blockId: "block-a",
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "turn",
      blockId: "block-a",
      blockType: "todo",
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "color",
      blockId: "block-a",
      color: "yellow",
    });
  });
});
