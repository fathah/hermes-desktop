import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RssReaderDashboard } from "./RssReaderDashboard";

const api = {
  spsRssGetFeeds: vi.fn(),
  spsRssGetArticles: vi.fn(),
  spsRssDiscoverSubstack: vi.fn(),
  spsRssAddFeed: vi.fn(),
  spsRssSyncFeeds: vi.fn(),
  spsRssDeleteFeed: vi.fn(),
  spsRssMarkArticleRead: vi.fn(),
  spsRssToggleArticleStar: vi.fn(),
  spsFileResearch: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
  api.spsRssGetFeeds.mockResolvedValue([]);
  api.spsRssGetArticles.mockResolvedValue([]);
  api.spsRssDiscoverSubstack.mockResolvedValue({
    ok: true,
    feedUrl: "https://example.substack.com/feed",
    siteUrl: "https://example.substack.com",
    title: "Example Substack",
    description: "Sharp notes.",
    sourceType: "substack",
  });
  api.spsRssAddFeed.mockResolvedValue("feed-1");
  api.spsRssSyncFeeds.mockResolvedValue({ success: true, count: 2 });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("RssReaderDashboard Substack flow", () => {
  it("discovers a public Substack feed, adds it, and syncs", async () => {
    render(<RssReaderDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /add feed/i }));
    fireEvent.change(
      screen.getByLabelText(/substack publication or article url/i),
      {
        target: { value: "https://example.substack.com/p/post" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /find feed/i }));

    expect(await screen.findByText("Example Substack")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.substack.com/feed"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add and sync/i }));

    await waitFor(() => {
      expect(api.spsRssAddFeed).toHaveBeenCalledWith({
        url: "https://example.substack.com/feed",
        site_url: "https://example.substack.com",
        title: "Example Substack",
        description: "Sharp notes.",
        category: "Substack",
      });
      expect(api.spsRssSyncFeeds).toHaveBeenCalled();
    });
  });
});
