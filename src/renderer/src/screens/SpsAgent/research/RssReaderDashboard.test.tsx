import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  openContentStudioIdea: vi.fn(),
  openDeckStudioInput: vi.fn(),
  setSurface: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

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
  spsExportRow: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.openContentStudioIdea.mockReset();
  store.openDeckStudioInput.mockReset();
  store.setSurface.mockReset();
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
  api.spsExportRow.mockResolvedValue(true);
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

  it("opens Content Studio after saving an RSS article as a content idea", async () => {
    api.spsRssGetArticles.mockResolvedValue([
      {
        id: "rss-article-1",
        feed_id: "feed-1",
        feed_title: "Operator Feed",
        guid: "guid-1",
        title: "RSS Field Notes",
        author: "A. Writer",
        url: "https://example.com/rss-field-notes",
        published_at: 1_797_000_000_000,
        content_text: "Longer article body for operators.",
        summary_excerpt: "A practical note from RSS.",
        read_status: 1,
        star_status: 1,
        relevance_score: 91,
      },
    ]);
    render(<RssReaderDashboard />);

    fireEvent.click(await screen.findByText("RSS Field Notes"));
    fireEvent.click(
      screen.getByRole("button", { name: /save as content idea/i }),
    );

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-ideas",
        "content-idea-rss-field-notes",
        expect.stringContaining('type: "content-idea"'),
      ),
    );
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2] ?? "");
    expect(markdown).toContain("https://example.com/rss-field-notes");
    expect(markdown).toContain('capturedFrom: "rss-reader"');
    expect(store.openContentStudioIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "RSS Field Notes",
        sourceUrls: ["https://example.com/rss-field-notes"],
        angle: "A practical note from RSS.",
        capturedFrom: "rss-reader",
      }),
    );
  });
});
