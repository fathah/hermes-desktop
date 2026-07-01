import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DelegationTree } from "./DelegationTree";
import type { DelegateNode } from "../../lib/delegation";

const tree: DelegateNode[] = [
  {
    id: "root",
    goal: "Coordinate analysis",
    status: "running",
    depth: 0,
    tool: "planner",
    children: [
      {
        id: "child-1",
        parentId: "root",
        goal: "Search project",
        status: "running",
        depth: 1,
        tool: "ripgrep",
        children: [],
      },
      {
        id: "child-2",
        parentId: "root",
        goal: "Open docs",
        status: "done",
        depth: 1,
        tool: "reader",
        children: [],
      },
      {
        id: "child-3",
        parentId: "root",
        goal: "Check runtime",
        status: "error",
        depth: 1,
        tool: "smoke",
        children: [],
      },
    ],
  },
];

describe("DelegationTree", () => {
  it("renders nothing for an empty tree", () => {
    const { container } = render(<DelegationTree tree={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a compact live summary while details stay collapsed by default", () => {
    render(<DelegationTree tree={tree} />);

    const summary = screen.getByText("Delegated work").closest("summary");

    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent(
      /Delegated work\s*· 2 running, 1 done, 1 error/,
    );
    expect(summary).toBeVisible();
    expect(screen.getByText("Search project")).not.toBeVisible();
    expect(screen.getByText("ripgrep")).not.toBeVisible();
  });

  it("reveals the existing node rows when expanded", () => {
    render(<DelegationTree tree={tree} />);
    const summary = screen.getByText("Delegated work").closest("summary");

    expect(summary).not.toBeNull();
    fireEvent.click(summary!);

    expect(screen.getByText("Coordinate analysis")).toBeVisible();
    expect(screen.getByText("Search project")).toBeVisible();
    expect(screen.getByText("Open docs")).toBeVisible();
    expect(screen.getByText("Check runtime")).toBeVisible();
    expect(screen.getByText("ripgrep")).toBeVisible();
  });
});
