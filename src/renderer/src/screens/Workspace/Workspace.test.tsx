import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace from "./Workspace";

vi.mock("../Chat/Chat", () => ({
  default: () => <div data-testid="workspace-chat">Chat</div>,
}));

const fileChangedListeners: Array<
  (event: { path: string; content: string }) => void
> = [];

beforeEach(() => {
  fileChangedListeners.length = 0;
  const hermesAPI = {
    getHermesHome: vi.fn().mockResolvedValue("/tmp/hermes"),
    getWorkspaceTree: vi
      .fn()
      .mockResolvedValue([
        { name: "index.md", path: "index.md", kind: "file" },
      ]),
    readWorkspaceFile: vi.fn().mockResolvedValue("# Home\n\nWelcome"),
    writeWorkspaceFile: vi.fn().mockResolvedValue(true),
    getWorkspaceMetadata: vi.fn().mockResolvedValue({
      version: 1,
      pages: {
        "index.md": {
          id: "page-index",
          path: "index.md",
          displayName: "index.md",
          parentPath: null,
          childOrder: [],
          favorite: false,
          trashed: false,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      rootOrder: ["index.md"],
      favorites: [],
      recentVisits: [],
    }),
    getWorkspacePageGraph: vi.fn().mockResolvedValue({
      version: 2,
      pages: {
        "index.md": {
          id: "page-index",
          path: "index.md",
          displayName: "index.md",
          parentPath: null,
          childOrder: [],
          favorite: false,
          trashed: false,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      rootOrder: ["index.md"],
      childOrder: { __root__: ["index.md"] },
      favorites: [],
      recentVisits: [],
      backlinks: {},
      sidebar: {
        collapsedSections: [],
        width: 280,
        collapsed: false,
      },
    }),
    updateWorkspaceSidebarState: vi.fn().mockResolvedValue({
      version: 2,
      pages: {},
      rootOrder: [],
      childOrder: { __root__: [] },
      favorites: [],
      recentVisits: [],
      backlinks: {},
      sidebar: {
        collapsedSections: [],
        width: 320,
        collapsed: false,
      },
    }),
    getWorkspaceBacklinks: vi.fn().mockResolvedValue([]),
    createWorkspacePage: vi.fn().mockResolvedValue({
      id: "page-research",
      path: "research-note.md",
      displayName: "Research Note",
      parentPath: null,
      childOrder: [],
      favorite: false,
      trashed: false,
      createdAt: 1,
      updatedAt: 1,
    }),
    renameWorkspacePage: vi.fn().mockResolvedValue({
      id: "page-index",
      path: "home-base.md",
      displayName: "Home Base",
      parentPath: null,
      childOrder: [],
      favorite: false,
      trashed: false,
      createdAt: 1,
      updatedAt: 2,
    }),
    duplicateWorkspacePage: vi.fn().mockResolvedValue({
      id: "page-copy",
      path: "index-copy.md",
      displayName: "index.md Copy",
      parentPath: null,
      childOrder: [],
      favorite: false,
      trashed: false,
      createdAt: 1,
      updatedAt: 1,
    }),
    trashWorkspacePage: vi.fn().mockResolvedValue(true),
    restoreWorkspacePage: vi.fn().mockResolvedValue(true),
    favoriteWorkspacePage: vi.fn().mockResolvedValue({
      id: "page-index",
      path: "index.md",
      displayName: "index.md",
      parentPath: null,
      childOrder: [],
      favorite: true,
      trashed: false,
      createdAt: 1,
      updatedAt: 2,
    }),
    moveWorkspacePage: vi.fn().mockResolvedValue({
      id: "page-index",
      path: "index.md",
      displayName: "index.md",
      parentPath: null,
      childOrder: [],
      favorite: false,
      trashed: false,
      createdAt: 1,
      updatedAt: 2,
    }),
    recordWorkspaceVisit: vi.fn().mockResolvedValue(true),
    listWorkspaceHistory: vi.fn().mockResolvedValue([]),
    restoreWorkspaceVersion: vi.fn().mockResolvedValue("# Home\n\nWelcome"),
    listAgentWorkspaceProposals: vi.fn().mockResolvedValue([]),
    createAgentWorkspaceProposal: vi.fn().mockResolvedValue({
      id: "proposal-1",
      path: "index.md",
      baseContent: "# Home\n\nWelcome",
      proposedContent: "# Home\n\nAgent edit",
      createdAt: 1,
      status: "pending",
    }),
    acceptAgentWorkspaceProposal: vi.fn().mockResolvedValue(true),
    rejectAgentWorkspaceProposal: vi.fn().mockResolvedValue(true),
    searchWorkspaceAndSessions: vi.fn().mockResolvedValue([]),
    onWorkspaceFileChanged: vi.fn((callback) => {
      fileChangedListeners.push(callback);
      return () => undefined;
    }),
  } as Partial<typeof window.hermesAPI>;
  Object.defineProperty(window, "hermesAPI", {
    value: hermesAPI,
    configurable: true,
  });
});

describe("Workspace", () => {
  it("loads index.md into the workspace canvas", async () => {
    render(<Workspace profile="default" onOpenAdmin={() => undefined} />);

    expect((await screen.findAllByText("index.md")).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(window.hermesAPI.readWorkspaceFile).toHaveBeenCalledWith(
        "index.md",
        "default",
      ),
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-chat")).toBeInTheDocument();
  });

  it("shows a conflict prompt when an external update arrives with unsaved edits", async () => {
    render(<Workspace profile="default" onOpenAdmin={() => undefined} />);

    const editor = await screen.findByRole("textbox", {
      name: "Workspace editor",
    });
    fireEvent.input(editor, { target: { textContent: "local edit" } });
    fileChangedListeners[0]({
      path: "index.md",
      content: "# Home\n\nAgent edit",
    });

    expect(
      await screen.findByText("Workspace file changed externally."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload file" }));
    expect(screen.getByText("Agent edit")).toBeInTheDocument();
  });

  it("creates and renames pages through dialogs instead of browser prompts", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    render(<Workspace profile="default" onOpenAdmin={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "New page" }));
    fireEvent.change(screen.getByLabelText("Page name"), {
      target: { value: "Research Note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create page" }));

    await waitFor(() =>
      expect(window.hermesAPI.createWorkspacePage).toHaveBeenCalledWith(
        { title: "Research Note", parentPath: null },
        "default",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename page" }));
    fireEvent.change(screen.getByLabelText("Page name"), {
      target: { value: "Home Base" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save page name" }));

    await waitFor(() =>
      expect(window.hermesAPI.renameWorkspacePage).toHaveBeenCalledWith(
        "index.md",
        "Home Base",
        "default",
      ),
    );
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("persists sidebar width and collapsed state through the page graph API", async () => {
    render(<Workspace profile="default" onOpenAdmin={() => undefined} />);

    fireEvent.change(await screen.findByLabelText("Sidebar width"), {
      target: { value: "320" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    await waitFor(() =>
      expect(window.hermesAPI.updateWorkspaceSidebarState).toHaveBeenCalledWith(
        { width: 320, collapsed: true },
        "default",
      ),
    );
  });
});
