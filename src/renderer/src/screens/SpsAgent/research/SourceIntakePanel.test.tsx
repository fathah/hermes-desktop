import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceIntakePanel } from "./SourceIntakePanel";

const api = {
  sourceIntakeStatus: vi.fn(),
  sourceIntakePreviewUrl: vi.fn(),
  sourceIntakeInstallInstructions: vi.fn(),
  spsRssAddFeed: vi.fn(),
  spsRssSyncFeeds: vi.fn(),
  spsFileResearch: vi.fn(),
  spsExportRow: vi.fn(),
  spsSubstackRadarListRuns: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
  api.sourceIntakeStatus.mockResolvedValue({
    checkedAt: 1,
    capabilities: [
      {
        key: "rss",
        label: "RSS and Substack feeds",
        ready: true,
        message: "Built in",
      },
      {
        key: "crawl4ai",
        label: "Public webpage extraction",
        ready: false,
        message: "Crawl4AI is optional and not ready.",
      },
    ],
  });
  api.sourceIntakePreviewUrl.mockResolvedValue({
    ok: true,
    sourceUrl: "https://example.com/page",
    canonicalUrl: "https://example.com/page",
    title: "Example Page",
    markdown:
      "# Example Page\n\nBody\n\n## Sources\n- [Example Page](https://example.com/page)",
    excerpt: "Body",
    links: ["https://example.com/page"],
    engine: "unfurl",
    fetchedAt: 1,
  });
  api.sourceIntakeInstallInstructions.mockResolvedValue(
    "pipx install crawl4ai",
  );
  api.spsFileResearch.mockResolvedValue({ ok: true, captureCount: 0 });
  api.spsExportRow.mockResolvedValue(true);
  api.spsRssAddFeed.mockResolvedValue("feed-1");
  api.spsRssSyncFeeds.mockResolvedValue({ success: true, count: 1 });
  api.spsSubstackRadarListRuns.mockResolvedValue([]);
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("SourceIntakePanel", () => {
  it("reads a generic URL, shows preview, and saves to the Knowledge Base", async () => {
    render(<SourceIntakePanel />);

    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://example.com/page" },
    });
    fireEvent.click(screen.getByRole("button", { name: /read source/i }));

    expect(await screen.findByText("Example Page")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/page")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save to kb/i }));

    await waitFor(() => {
      expect(api.spsFileResearch).toHaveBeenCalledWith(
        "Example Page",
        expect.stringContaining("## Sources"),
      );
      expect(screen.getByText("Saved to Knowledge Base.")).toBeInTheDocument();
    });
  });

  it("saves a preview as a Content Studio idea", async () => {
    render(<SourceIntakePanel />);

    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://example.com/page" },
    });
    fireEvent.click(screen.getByRole("button", { name: /read source/i }));

    expect(await screen.findByText("Example Page")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /save as content idea/i }),
    );

    expect(
      await screen.findByText("Saved as content idea."),
    ).toBeInTheDocument();
    expect(api.spsExportRow).toHaveBeenCalledWith(
      "content-ideas",
      expect.stringContaining("content-idea-example-page"),
      expect.stringContaining('type: "content-idea"'),
    );
  });

  it("shows Crawl4AI setup guidance when extraction is unavailable", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("button", { name: /show setup/i }));

    expect(
      await screen.findByText(/pipx install crawl4ai/i),
    ).toBeInTheDocument();
  });

  it("adds RSS previews as feeds and syncs", async () => {
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

    render(<SourceIntakePanel />);

    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://example.substack.com/p/post" },
    });
    fireEvent.click(screen.getByRole("button", { name: /read source/i }));

    expect(await screen.findByText("Example Substack")).toBeInTheDocument();
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
