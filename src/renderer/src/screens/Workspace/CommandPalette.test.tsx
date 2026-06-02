import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette";

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  Object.defineProperty(window, "hermesAPI", {
    value: {
      searchWorkspaceAndSessions: vi.fn().mockResolvedValue([
        {
          kind: "workspace",
          path: "index.md",
          title: "Home",
          snippet: "Welcome",
        },
        {
          kind: "session",
          sessionId: "session-1",
          title: "Planning chat",
          snippet: "Next steps",
        },
        { kind: "admin", view: "settings", title: "Settings" },
        { kind: "command", command: "new-page", title: "New page" },
      ]),
    },
    configurable: true,
  });
});

describe("CommandPalette", () => {
  it("runs command results", async () => {
    const onRunCommand = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        profile="default"
        onClose={onClose}
        onSelectWorkspace={() => undefined}
        onSelectAdmin={() => undefined}
        onSelectSession={() => undefined}
        onRunCommand={onRunCommand}
      />,
    );

    fireEvent.click(await screen.findByText("new-page"));

    expect(onRunCommand).toHaveBeenCalledWith("new-page");
    expect(onClose).toHaveBeenCalled();
  });

  it("filters results and opens workspace pages in a tab", async () => {
    const onOpenWorkspaceInTab = vi.fn();
    render(
      <CommandPalette
        open
        profile="default"
        onClose={() => undefined}
        onSelectWorkspace={() => undefined}
        onSelectAdmin={() => undefined}
        onSelectSession={() => undefined}
        onOpenWorkspaceInTab={onOpenWorkspaceInTab}
      />,
    );

    expect(await screen.findByText("Home")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    await waitFor(() => expect(screen.queryByText("Home")).toBeNull());
    expect(screen.getByText("Planning chat")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pages" }));
    fireEvent.click(screen.getByRole("button", { name: "Open tab" }));

    expect(onOpenWorkspaceInTab).toHaveBeenCalledWith("index.md");
  });

  it("copies workspace links and opens pages in a new window", async () => {
    const onOpenWorkspaceInWindow = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        profile="default"
        onClose={onClose}
        onSelectWorkspace={() => undefined}
        onSelectAdmin={() => undefined}
        onSelectSession={() => undefined}
        onOpenWorkspaceInWindow={onOpenWorkspaceInWindow}
      />,
    );

    expect(await screen.findByText("Home")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "hermes-workspace://index.md",
    );

    fireEvent.click(screen.getByRole("button", { name: "Open window" }));
    expect(onOpenWorkspaceInWindow).toHaveBeenCalledWith("index.md");
    expect(onClose).toHaveBeenCalled();
  });
});
