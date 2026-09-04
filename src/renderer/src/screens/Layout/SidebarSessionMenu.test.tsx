import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SidebarSessionMenu from "./SidebarSessionMenu";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string =>
      key === "navigation.sessionMenu.copySessionId" ? "Copy session ID" : key,
  }),
}));

describe("SidebarSessionMenu", () => {
  it("offers a Copy session ID action for the selected row", () => {
    const onCopySessionId = vi.fn();

    render(
      <SidebarSessionMenu
        target={{
          id: "session-123",
          title: "Conversation",
          contextFolder: null,
          x: 20,
          y: 20,
        }}
        isPinned={false}
        projects={[]}
        onClose={vi.fn()}
        onTogglePin={vi.fn()}
        onRename={vi.fn()}
        onCopySessionId={onCopySessionId}
        onMoveToProject={vi.fn()}
        onPickNewFolder={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }));

    expect(onCopySessionId).toHaveBeenCalledWith("session-123");
  });
});
