import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PageMentionMenu from "./PageMentionMenu";

describe("PageMentionMenu", () => {
  it("filters pages and inserts a wiki link", () => {
    const onSelect = vi.fn();
    render(
      <PageMentionMenu
        query="road"
        pages={[
          { path: "roadmap.md", title: "Roadmap" },
          { path: "notes.md", title: "Notes" },
        ]}
        onSelect={onSelect}
      />,
    );

    expect(
      screen.getByRole("menuitem", { name: "Roadmap" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Notes" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Roadmap" }));

    expect(onSelect).toHaveBeenCalledWith("[[Roadmap]]");
  });

  it("offers date and reminder insertions", () => {
    const onSelect = vi.fn();
    render(<PageMentionMenu query="remind" pages={[]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("menuitem", { name: "Reminder" }));

    expect(onSelect).toHaveBeenCalledWith("@remind ");
  });
});
