import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubstackRadarPanel } from "./SubstackRadarPanel";

const latestRun = {
  id: "run-1",
  query: "AI agents, markets",
  categories: ["AI agents", "markets"],
  status: "complete" as const,
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_000,
  sourceUrls: ["https://substack.com/discover/ai-agents"],
  candidates: [
    {
      id: "candidate-1",
      publicationUrl: "https://example.substack.com",
      feedUrl: "https://example.substack.com/feed",
      title: "Example Letters",
      description: "Useful field notes on practical AI agents.",
      author: "A. Writer",
      category: "AI agents",
      visibleSignals: {
        subscriberText: "12K subscribers",
        badgeText: "Featured",
      },
      sourcePageUrl: "https://substack.com/discover/ai-agents",
      discoveredAt: 1_700_000_000_500,
      score: 86,
      status: "new" as const,
    },
  ],
};

const api = {
  spsSubstackRadarRun: vi.fn(),
  spsSubstackRadarListRuns: vi.fn(),
  spsSubstackRadarSetCandidateStatus: vi.fn(),
  spsSubstackRadarAddApprovedFeeds: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
  api.spsSubstackRadarListRuns.mockResolvedValue([]);
  api.spsSubstackRadarRun.mockResolvedValue(latestRun);
  api.spsSubstackRadarSetCandidateStatus.mockResolvedValue({ ok: true });
  api.spsSubstackRadarAddApprovedFeeds.mockResolvedValue({
    added: 1,
    feeds: [
      {
        candidateId: "candidate-1",
        feed: {
          ok: true,
          feedUrl: "https://example.substack.com/feed",
          siteUrl: "https://example.substack.com",
          title: "Example Letters",
          description: "Useful field notes on practical AI agents.",
          sourceType: "substack" as const,
        },
      },
    ],
  });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("SubstackRadarPanel", () => {
  it("renders public-boundary copy and can run discovery from comma-separated categories", async () => {
    render(<SubstackRadarPanel />);

    expect(
      screen.getByText(
        /browser discovery uses public substack pages; posts are ingested via rss after approval/i,
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/categories or keywords/i), {
      target: { value: "AI agents, markets, AI agents" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run discovery/i }));

    await waitFor(() => {
      expect(api.spsSubstackRadarRun).toHaveBeenCalledWith({
        categories: ["AI agents", "markets"],
      });
    });
  });

  it("loads existing runs and displays returned candidate details", async () => {
    api.spsSubstackRadarListRuns.mockResolvedValue([latestRun]);

    render(<SubstackRadarPanel />);

    expect(await screen.findByText("Example Letters")).toBeInTheDocument();
    expect(
      screen.getByText("Useful field notes on practical AI agents."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/publication: https:\/\/example\.substack\.com/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/score: 86/i)).toBeInTheDocument();
    expect(screen.getByText(/category: AI agents/i)).toBeInTheDocument();
    expect(screen.getByText("12K subscribers")).toBeInTheDocument();
    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(
      screen.getByText(/source: https:\/\/substack\.com\/discover\/ai-agents/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/status: new/i)).toBeInTheDocument();
  });

  it("approving a candidate calls the status API and enables Add Approved Feeds", async () => {
    api.spsSubstackRadarListRuns.mockResolvedValue([latestRun]);

    render(<SubstackRadarPanel />);

    const addButton = await screen.findByRole("button", {
      name: /add approved feeds/i,
    });
    expect(addButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      expect(api.spsSubstackRadarSetCandidateStatus).toHaveBeenCalledWith({
        runId: "run-1",
        candidateId: "candidate-1",
        status: "approved",
      });
    });
    expect(addButton).toBeEnabled();
  });

  it("adds approved feeds and displays the result", async () => {
    api.spsSubstackRadarListRuns.mockResolvedValue([
      {
        ...latestRun,
        candidates: [{ ...latestRun.candidates[0], status: "approved" }],
      },
    ]);

    render(<SubstackRadarPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: /add approved feeds/i }),
    );

    await waitFor(() => {
      expect(api.spsSubstackRadarAddApprovedFeeds).toHaveBeenCalledWith({
        runId: "run-1",
      });
    });
    expect(
      await screen.findByText(/added 1 approved feed/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("https://example.substack.com/feed"),
    ).toBeInTheDocument();
  });

  it("rejecting a candidate calls the status API and updates the status", async () => {
    api.spsSubstackRadarListRuns.mockResolvedValue([latestRun]);

    render(<SubstackRadarPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /reject/i }));

    await waitFor(() => {
      expect(api.spsSubstackRadarSetCandidateStatus).toHaveBeenCalledWith({
        runId: "run-1",
        candidateId: "candidate-1",
        status: "rejected",
      });
    });
    expect(screen.getByText(/status: rejected/i)).toBeInTheDocument();
  });
});
