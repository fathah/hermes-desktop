import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceCommentsPanel from "./WorkspaceCommentsPanel";
import WorkspaceOfflinePanel from "./WorkspaceOfflinePanel";
import WorkspaceSyncedBlocksPanel from "./WorkspaceSyncedBlocksPanel";

describe("Workspace panels", () => {
  it("shows local offline status", () => {
    render(
      <WorkspaceOfflinePanel
        dirty
        conflictPending={false}
        proposalCount={2}
        lastSavedLabel="10:00"
      />,
    );

    expect(screen.getByText("Unsaved edits")).toBeInTheDocument();
    expect(screen.getByText("2 agent proposals")).toBeInTheDocument();
    expect(screen.getByText("Last saved 10:00")).toBeInTheDocument();
  });

  it("creates comments and resolves existing comments", () => {
    const onCreate = vi.fn();
    const onResolve = vi.fn();
    render(
      <WorkspaceCommentsPanel
        comments={[
          {
            id: "comment-1",
            body: "Review this",
            status: "open",
            createdAt: 1,
          },
        ]}
        onCreate={onCreate}
        onResolve={onResolve}
      />,
    );

    fireEvent.change(screen.getByLabelText("New comment"), {
      target: { value: "Follow up" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve comment" }));

    expect(onCreate).toHaveBeenCalledWith("Follow up");
    expect(onResolve).toHaveBeenCalledWith("comment-1");
  });

  it("creates synced blocks and lists existing references", () => {
    const onCreate = vi.fn();
    render(
      <WorkspaceSyncedBlocksPanel
        blocks={[
          {
            id: "synced-1",
            sourcePath: "a.md",
            sourceBlockId: "block-a",
            content: "Shared",
            references: [{ path: "b.md", blockId: "block-b" }],
            updatedAt: 1,
          },
        ]}
        onCreate={onCreate}
      />,
    );

    fireEvent.change(screen.getByLabelText("Synced block content"), {
      target: { value: "New shared" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create synced block" }),
    );

    expect(screen.getByText("a.md -> 1 reference")).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledWith("New shared");
  });
});
