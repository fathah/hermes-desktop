import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchModal } from "./ResearchModal";

const store = vi.hoisted(() => ({
  setResearchOpen: vi.fn(),
  setScheduledOpen: vi.fn(),
  setScheduledDraftTopic: vi.fn(),
  importResearchWork: vi.fn(),
  runResearch: vi.fn(),
  saveStudyToWiki: vi.fn(),
  flash: vi.fn(),
  openContentStudioIdea: vi.fn(),
  openDeckStudioInput: vi.fn(),
}));

const api = vi.hoisted(() => ({
  spsResearchEnsureAgentTool: vi.fn(),
  getToolsets: vi.fn(),
  getResearchReachStatus: vi.fn(),
  spsResearchGetConfig: vi.fn(),
  spsNotebookLmStatus: vi.fn(),
  spsCuratedBrief: vi.fn(),
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
  store.saveStudyToWiki.mockResolvedValue({
    ok: true,
    summary: "Saved curated brief.",
    undo: vi.fn(),
  });
  api.spsCuratedBrief.mockResolvedValue({
    kind: "chat",
    reply: [
      [
        "## Perspectives",
        "Operators need grounded pre-writing.",
        "",
        "## Brief",
        "Curated briefs help teams draft from sources.",
        "",
        "## Sources",
        "- [Brief](https://brief.example/source)",
      ].join("\n"),
    ],
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

  it("runs a Curated Brief, saves it to the wiki, and opens Content Studio", async () => {
    render(<ResearchModal />);

    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));
    fireEvent.change(screen.getByPlaceholderText(/topic or decision/i), {
      target: { value: "Source-backed product research" },
    });
    fireEvent.change(screen.getByTitle("Corpus description"), {
      target: { value: "Use https://one.example/source." },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(await screen.findByText(/curated briefs help/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save to wiki/i }));

    await waitFor(() => {
      expect(api.spsCuratedBrief).toHaveBeenCalledWith(
        "Source-backed product research",
        "Use https://one.example/source.",
      );
      expect(store.saveStudyToWiki).toHaveBeenCalledWith(
        "Source-backed product research",
        expect.stringContaining("## Sources"),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: /save as content idea/i }),
    );

    await waitFor(() =>
      expect(store.openContentStudioIdea).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Source-backed product research",
          capturedFrom: "curated-brief",
        }),
      ),
    );
  });

  it("does not save a Curated Brief without usable sources", async () => {
    api.spsCuratedBrief.mockResolvedValue({
      kind: "chat",
      reply: ["## Brief\nUnsupported.\n\n## Sources\n- Internal notes"],
    });
    render(<ResearchModal />);

    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));
    fireEvent.change(screen.getByPlaceholderText(/topic or decision/i), {
      target: { value: "Unsourced curated brief" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(await screen.findByText(/unsupported/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save to wiki/i }));

    expect(store.saveStudyToWiki).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/could not find usable source links/i),
    ).toBeInTheDocument();
  });

  it("opens Deck Studio from a Curated Brief", async () => {
    render(<ResearchModal />);

    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));
    fireEvent.change(screen.getByPlaceholderText(/topic or decision/i), {
      target: { value: "Deckable curated brief" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(await screen.findByText(/curated briefs help/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /deck from brief/i }));

    expect(store.openDeckStudioInput).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Deckable curated brief",
        notes: expect.stringContaining("## Perspectives"),
        theme: "research",
      }),
    );
  });
});
