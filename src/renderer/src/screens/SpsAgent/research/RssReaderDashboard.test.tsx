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
  sourceIntakeStatus: vi.fn(),
  sourceIntakePreviewUrl: vi.fn(),
  sourceIntakeInstallInstructions: vi.fn(),
  spsSubstackRadarListRuns: vi.fn(),
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
  api.sourceIntakeStatus.mockResolvedValue({
    checkedAt: 1,
    capabilities: [
      {
        key: "rss",
        label: "RSS and Substack feeds",
        ready: true,
        message: "Built in",
      },
    ],
  });
  api.sourceIntakePreviewUrl.mockResolvedValue({
    ok: true,
    sourceUrl: "https://example.substack.com/p/post",
    canonicalUrl: "https://example.substack.com/feed",
    title: "Example Substack",
    markdown:
      "# Example Substack\n\nSharp notes.\n\n## Sources\n- [Example Substack](https://example.substack.com)",
    excerpt: "Sharp notes.",
    links: [
      "https://example.substack.com/feed",
      "https://example.substack.com",
    ],
    engine: "rss",
    fetchedAt: 1,
  });
  api.sourceIntakeInstallInstructions.mockResolvedValue(
    "pipx install crawl4ai",
  );
  api.spsSubstackRadarListRuns.mockResolvedValue([]);
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("RssReaderDashboard Substack flow", () => {
  it("discovers a public Substack feed, adds it, and syncs", async () => {
    render(<RssReaderDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /sources/i }));
    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://example.substack.com/p/post" },
    });
    fireEvent.click(screen.getByRole("button", { name: /read source/i }));

    expect(await screen.findByText("Example Substack")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.substack.com/feed"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add feed/i }));

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
