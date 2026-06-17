import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchModal } from "./ResearchModal";

const store = vi.hoisted(() => ({
  setResearchOpen: vi.fn(),
  setScheduledOpen: vi.fn(),
  importResearchWork: vi.fn(),
  runResearch: vi.fn(),
  saveStudyToWiki: vi.fn(),
  flash: vi.fn(),
  openContentStudioIdea: vi.fn(),
}));

const api = vi.hoisted(() => ({
  spsResearchEnsureAgentTool: vi.fn(),
  getToolsets: vi.fn(),
  getResearchReachStatus: vi.fn(),
  spsResearchGetConfig: vi.fn(),
  spsNotebookLmStatus: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
  store.runResearch.mockResolvedValue({
    ok: true,
    summary: "Sourced summary for operators.",
    undo: vi.fn(),
  });
  api.getToolsets.mockResolvedValue([{ key: "web", enabled: true }]);
  api.getResearchReachStatus.mockResolvedValue({
    installed: false,
    channels: [],
  });
  api.spsResearchGetConfig.mockResolvedValue({ mailto: "", hasApiKey: false });
  api.spsNotebookLmStatus.mockResolvedValue({
    registered: false,
    alreadyPresent: false,
    commandFound: true,
    command: "notebooklm-mcp",
    args: [],
    source: "path",
    nlmCommand: "nlm",
    restarted: false,
    message: "NotebookLM can connect through the local MCP server.",
  });
});

describe("ResearchModal", () => {
  it("opens Content Studio from saved research", async () => {
    render(<ResearchModal />);

    fireEvent.change(screen.getByPlaceholderText(/research any topic/i), {
      target: { value: "Research-backed content idea" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Research$/ }));

    expect(
      await screen.findByText("Sourced summary for operators."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /save as content idea/i }),
    );

    await waitFor(() =>
      expect(store.openContentStudioIdea).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Research-backed content idea",
          capturedFrom: "research-reach",
        }),
      ),
    );
  });
});
