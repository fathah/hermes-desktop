import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace from "./Workspace";

vi.mock("../Chat/Chat", () => ({
  default: () => <div data-testid="workspace-chat">Chat</div>,
}));

const fileChangedListeners: Array<
  (event: { path: string; content: string }) => void
> = [];
const obsidianChangedListeners: Array<
  (event: { path: string; content: string }) => void
> = [];

beforeEach(() => {
  fileChangedListeners.length = 0;
  obsidianChangedListeners.length = 0;
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
    getObsidianConfig: vi.fn().mockResolvedValue({
      enabled: true,
      vaultPath: "/tmp/notes",
      vaultName: "Notes",
      vaultId: "",
      bridgeUrl: "http://127.0.0.1:27124",
      hasBridgeToken: true,
    }),
    setObsidianConfig: vi.fn().mockResolvedValue({
      enabled: true,
      vaultPath: "/tmp/notes",
      vaultName: "Notes",
      vaultId: "",
      bridgeUrl: "http://127.0.0.1:27124",
      hasBridgeToken: true,
    }),
    getObsidianTree: vi
      .fn()
      .mockResolvedValue([
        { name: "daily.md", path: "daily.md", kind: "file" },
      ]),
    readObsidianFile: vi.fn().mockResolvedValue("# Daily\n\nFrom vault"),
    writeObsidianFile: vi.fn().mockResolvedValue(true),
    searchObsidian: vi.fn().mockResolvedValue([]),
    openObsidianNote: vi.fn().mockResolvedValue(true),
    callObsidianFunction: vi.fn().mockResolvedValue({ ok: true }),
    onObsidianFileChanged: vi.fn((callback) => {
      obsidianChangedListeners.push(callback);
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

  it("switches to an Obsidian vault backend and opens the selected note in Obsidian", async () => {
    render(<Workspace profile="default" onOpenAdmin={() => undefined} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Obsidian Vault" }),
    );

    await waitFor(() =>
      expect(window.hermesAPI.readObsidianFile).toHaveBeenCalledWith(
        "daily.md",
        "default",
      ),
    );
    expect(screen.getByText("Daily")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open in Obsidian" }));
    expect(window.hermesAPI.openObsidianNote).toHaveBeenCalledWith(
      "daily.md",
      "default",
    );
  });
});
