import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BlockCommandMenu from "./BlockCommandMenu";

describe("BlockCommandMenu", () => {
  it("filters commands and returns the selected snippet", () => {
    const onSelect = vi.fn();
    render(<BlockCommandMenu query="todo" onSelect={onSelect} />);

    expect(screen.getByRole("menuitem", { name: "Todo" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Callout" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Todo" }));

    expect(onSelect).toHaveBeenCalledWith("- [ ] Task\n");
  });
});
