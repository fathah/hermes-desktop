import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

function makeRun(
  id: string,
  overrides: Partial<typeof latestRun> = {},
): typeof latestRun {
  return {
    ...latestRun,
    id,
    query: id,
    categories: [id],
    startedAt: latestRun.startedAt + (id === "run-2" ? 1_000 : 0),
    candidates: latestRun.candidates.map((candidate) => ({
      ...candidate,
      title: id === "run-2" ? "Fresh Letters" : "Example Letters",
      category: id,
      status: "new" as const,
    })),
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
    added: 0,
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

  it("does not let a slow initial run load overwrite a newly completed discovery", async () => {
    const listRuns = deferred<(typeof latestRun)[]>();
    api.spsSubstackRadarListRuns.mockReturnValue(listRuns.promise);
    api.spsSubstackRadarRun.mockResolvedValue(makeRun("run-2"));

    render(<SubstackRadarPanel />);

    fireEvent.change(screen.getByLabelText(/categories or keywords/i), {
      target: { value: "fresh" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run discovery/i }));

    await waitFor(() => {
      expect(api.spsSubstackRadarRun).toHaveBeenCalledWith({
        categories: ["fresh"],
      });
    });

    listRuns.resolve([makeRun("run-1")]);

    expect(await screen.findByText("Fresh Letters")).toBeInTheDocument();
    expect(screen.queryByText("Example Letters")).not.toBeInTheDocument();
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

  it("approving a candidate calls the status API and enables feed URL preview", async () => {
    api.spsSubstackRadarListRuns.mockResolvedValue([latestRun]);

    render(<SubstackRadarPanel />);

    const addButton = await screen.findByRole("button", {
      name: /preview approved feed urls/i,
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

  it("previews approved feed URLs and displays the result", async () => {
    api.spsSubstackRadarListRuns.mockResolvedValue([
      {
        ...latestRun,
        candidates: [{ ...latestRun.candidates[0], status: "approved" }],
      },
    ]);

    render(<SubstackRadarPanel />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /preview approved feed urls/i,
      }),
    );

    await waitFor(() => {
      expect(api.spsSubstackRadarAddApprovedFeeds).toHaveBeenCalledWith({
        runId: "run-1",
      });
    });
    expect(
      await screen.findByText(/validated 1 approved feed url/i),
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

  it("does not apply a stale status update to a newer active run", async () => {
    const statusUpdate = deferred<{ ok: boolean }>();
    api.spsSubstackRadarListRuns.mockResolvedValue([makeRun("run-1")]);
    api.spsSubstackRadarSetCandidateStatus.mockReturnValue(
      statusUpdate.promise,
    );
    api.spsSubstackRadarRun.mockResolvedValue(makeRun("run-2"));

    render(<SubstackRadarPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      expect(api.spsSubstackRadarSetCandidateStatus).toHaveBeenCalledWith({
        runId: "run-1",
        candidateId: "candidate-1",
        status: "approved",
      });
    });

    fireEvent.change(screen.getByLabelText(/categories or keywords/i), {
      target: { value: "fresh" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run discovery/i }));

    expect(await screen.findByText("Fresh Letters")).toBeInTheDocument();

    await act(async () => {
      statusUpdate.resolve({ ok: true });
    });

    expect(screen.getByText(/status: new/i)).toBeInTheDocument();
  });
});
