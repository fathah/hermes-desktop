import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceIntakePanel } from "./SourceIntakePanel";

const store = vi.hoisted(() => ({
  openContentStudioIdea: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

const api = {
  sourceIntakeStatus: vi.fn(),
  sourceIntakePreviewUrl: vi.fn(),
  sourceIntakeInstallInstructions: vi.fn(),
  spsRssAddFeed: vi.fn(),
  spsRssSyncFeeds: vi.fn(),
  spsFileResearch: vi.fn(),
  spsExportRow: vi.fn(),
  spsSourceStudy: vi.fn(),
  spsSubstackRadarListRuns: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.openContentStudioIdea.mockReset();
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
  api.spsSourceStudy.mockResolvedValue({
    kind: "chat",
    reply: [
      "The corpus argues for slower, source-backed workflows.\n\n## Sources\n- [Second](https://two.example/study)",
    ],
  });
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
    expect(store.openContentStudioIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Example Page",
        sourceUrls: ["https://example.com/page"],
        capturedFrom: "source-preview",
      }),
    );
  });

  it("creates one Content Studio idea from multiple reviewed sources", async () => {
    api.sourceIntakePreviewUrl.mockImplementation((inputUrl: string) =>
      Promise.resolve({
        ok: true,
        sourceUrl: inputUrl,
        canonicalUrl: inputUrl,
        title: inputUrl.includes("two") ? "Second Page" : "First Page",
        markdown: `# Page\n\nBody\n\n## Sources\n- [Page](${inputUrl})`,
        excerpt: inputUrl.includes("two") ? "Second note" : "First note",
        links: [inputUrl],
        engine: "unfurl",
        fetchedAt: 1,
      }),
    );
    render(<SourceIntakePanel />);

    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://one.example/page" },
    });
    fireEvent.click(screen.getByRole("button", { name: /read source/i }));
    expect(await screen.findByText("First Page")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /add to idea sources/i }),
    );

    fireEvent.click(screen.getByRole("tab", { name: /add url/i }));
    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://two.example/page" },
    });
    fireEvent.click(screen.getByRole("button", { name: /read source/i }));
    expect(await screen.findByText("Second Page")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /add to idea sources/i }),
    );

    fireEvent.change(screen.getByLabelText(/content idea title/i), {
      target: { value: "Combined source idea" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create content idea/i }),
    );

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-ideas",
        expect.stringContaining("content-idea-combined-source-idea"),
        expect.stringContaining("https://two.example/page"),
      ),
    );
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2] ?? "");
    expect(markdown).toContain("https://one.example/page");
    expect(markdown).toContain("https://two.example/page");
    expect(store.openContentStudioIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Combined source idea",
        sourceUrls: ["https://one.example/page", "https://two.example/page"],
        capturedFrom: "sources",
      }),
    );
  });

  it("saves a Study sources result as one Content Studio idea with corpus URLs", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /study/i }));
    fireEvent.change(screen.getByLabelText(/study focus/i), {
      target: { value: "Source-backed workflows" },
    });
    fireEvent.change(screen.getByLabelText(/corpus description/i), {
      target: {
        value:
          "Use https://one.example/study and the connected Knowledge Wiki notes.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^study$/i }));

    expect(
      await screen.findByText(/source-backed workflows/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /save study as content idea/i }),
    );

    await waitFor(() =>
      expect(api.spsSourceStudy).toHaveBeenCalledWith(
        "Source-backed workflows",
        "Use https://one.example/study and the connected Knowledge Wiki notes.",
      ),
    );
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2] ?? "");
    expect(markdown).toContain("https://one.example/study");
    expect(markdown).toContain("https://two.example/study");
    expect(markdown).toContain("The corpus argues");
    expect(store.openContentStudioIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Source-backed workflows",
        sourceUrls: ["https://one.example/study", "https://two.example/study"],
        capturedFrom: "source-study",
      }),
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
