import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceIntakePanel } from "./SourceIntakePanel";

const ocr = vi.hoisted(() => ({
  ocrImageBlobToText: vi.fn(),
}));

vi.mock("../lib/ocr", () => ocr);

const store = vi.hoisted(() => ({
  openContentStudioIdea: vi.fn(),
  openDeckStudioInput: vi.fn(),
  setSurface: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

const api = {
  sourceIntakeStatus: vi.fn(),
  sourceIntakePreviewUrl: vi.fn(),
  sourceIntakeInstallInstructions: vi.fn(),
  spsListRecentScreenshots: vi.fn(),
  spsRssAddFeed: vi.fn(),
  spsRssSyncFeeds: vi.fn(),
  spsFileResearch: vi.fn(),
  spsExportRow: vi.fn(),
  spsReadRow: vi.fn(),
  spsImportRecentScreenshot: vi.fn(),
  spsImportClipboardScreenshot: vi.fn(),
  spsSourceStudy: vi.fn(),
  spsCuratedBrief: vi.fn(),
  spsSubstackRadarListRuns: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.openContentStudioIdea.mockReset();
  store.openDeckStudioInput.mockReset();
  store.setSurface.mockReset();
  ocr.ocrImageBlobToText.mockReset();
  ocr.ocrImageBlobToText.mockResolvedValue("OCR text from screenshot.");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    }),
  );
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
  api.spsReadRow.mockResolvedValue(
    '---\ntitle: "Screenshot"\nsource: "screenshot"\n---\n\n![Screenshot](../_assets/a.png)\n',
  );
  api.spsListRecentScreenshots.mockResolvedValue([
    {
      id: "shot-new",
      originalName: "Screenshot 2026-06-18 at 10.00.00.png",
      modifiedAt: 1_797_000_100_000,
      size: 1024,
      previewDataUrl: "data:image/png;base64,cHJldmlldw==",
    },
  ]);
  api.spsImportRecentScreenshot.mockResolvedValue({
    ok: true,
    captureId: "cap-shot",
    assetPath: "a".repeat(64) + ".png",
    originalName: "Screenshot 2026-06-18 at 09.00.00.png",
    modifiedAt: 1_797_000_000_000,
    source: "recent-file",
  });
  api.spsImportClipboardScreenshot.mockResolvedValue({
    ok: true,
    captureId: "cap-clipboard",
    assetPath: "b".repeat(64) + ".png",
    originalName: "Clipboard screenshot.png",
    modifiedAt: 1_797_000_000_001,
    source: "clipboard",
  });
  api.spsSourceStudy.mockResolvedValue({
    kind: "chat",
    reply: [
      "The corpus argues for slower, source-backed workflows.\n\n## Sources\n- [Second](https://two.example/study)",
    ],
  });
  api.spsCuratedBrief.mockResolvedValue({
    kind: "chat",
    reply: [
      [
        "## Perspectives",
        "Operators care about verifiable workflows.",
        "",
        "## Brief",
        "The corpus argues for curated, source-backed pre-writing.",
        "",
        "## Sources",
        "- [Curated](https://brief.example/source)",
      ].join("\n"),
    ],
  });
  api.spsRssAddFeed.mockResolvedValue("feed-1");
  api.spsRssSyncFeeds.mockResolvedValue({ success: true, count: 1 });
  api.spsSubstackRadarListRuns.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("SourceIntakePanel", () => {
  it("renders recent screenshot candidates and imports the selected one with a note", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /screenshot/i }));
    expect(
      await screen.findByText("Screenshot 2026-06-18 at 10.00.00.png"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/screenshot note/i), {
      target: { value: "Use this in the QA pass." },
    });
    fireEvent.click(screen.getByRole("button", { name: /import to inbox/i }));

    await waitFor(() => {
      expect(api.spsImportRecentScreenshot).toHaveBeenCalledWith({
        candidateId: "shot-new",
        note: "Use this in the QA pass.",
      });
      expect(screen.getByText("Imported to Inbox.")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Screenshot 2026-06-18 at 09.00.00.png"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open inbox/i }));

    expect(store.setSurface).toHaveBeenCalledWith("inbox");
  });

  it("imports a screenshot image from the clipboard", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /screenshot/i }));
    fireEvent.change(await screen.findByLabelText(/screenshot note/i), {
      target: { value: "Clipboard note." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /import from clipboard/i }),
    );

    await waitFor(() => {
      expect(api.spsImportClipboardScreenshot).toHaveBeenCalledWith({
        note: "Clipboard note.",
      });
      expect(screen.getByText("Imported to Inbox.")).toBeInTheDocument();
    });
    expect(screen.getByText("Clipboard screenshot.png")).toBeInTheDocument();
  });

  it("shows a clipboard-empty message when clipboard import has no image", async () => {
    api.spsImportClipboardScreenshot.mockResolvedValue({
      ok: false,
      reason: "clipboard-empty",
      error: "No screenshot image found on the clipboard.",
    });
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /screenshot/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /import from clipboard/i }),
    );

    expect(
      await screen.findByText("No screenshot image found on the clipboard."),
    ).toBeInTheDocument();
  });

  it("imports a screenshot and prepares the Study tab without claiming visual understanding", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /screenshot/i }));
    expect(
      await screen.findByText("Screenshot 2026-06-18 at 10.00.00.png"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^study$/i }));

    await waitFor(() => {
      expect(api.spsImportRecentScreenshot).toHaveBeenCalledWith({
        candidateId: "shot-new",
        note: "",
      });
      expect(screen.getByLabelText(/study focus/i)).toHaveValue(
        "Study this screenshot capture",
      );
    });
    expect(screen.getByLabelText(/corpus description/i)).toHaveValue(
      "Screenshot Inbox capture: cap-shot\nOriginal file name: Screenshot 2026-06-18 at 09.00.00.png\nStored asset: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png\n\nOCR has not been run yet, so study should use this as a screenshot capture reference and avoid text-grounded claims until text is extracted.",
    );
  });

  it("imports a recent screenshot and opens Deck Studio without using Study", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /screenshot/i }));
    expect(
      await screen.findByText("Screenshot 2026-06-18 at 10.00.00.png"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^deck$/i }));

    await waitFor(() => {
      expect(api.spsImportRecentScreenshot).toHaveBeenCalledWith({
        candidateId: "shot-new",
        note: "",
      });
      expect(store.openDeckStudioInput).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Screenshot: Screenshot 2026-06-18 at 09.00.00.png",
          theme: "research",
          goal: "turn this screenshot capture into a deck brief",
          notes: expect.stringContaining("Screenshot Inbox capture: cap-shot"),
          sourceRefs: [
            expect.objectContaining({
              kind: "research",
              label: "Screenshot: Screenshot 2026-06-18 at 09.00.00.png",
              locator: "Inbox capture cap-shot",
            }),
          ],
        }),
      );
    });
    const deckInput = store.openDeckStudioInput.mock.calls.at(-1)?.[0];
    expect(deckInput.notes).toContain(
      "Original file name: Screenshot 2026-06-18 at 09.00.00.png",
    );
    expect(deckInput.notes).toContain(
      "Stored asset: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    );
    expect(deckInput.notes).toContain("OCR has not been run yet");
    expect(api.spsSourceStudy).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Opened Deck Studio with this screenshot."),
    ).toBeInTheDocument();
  });

  it("extracts local OCR text and appends it to the imported Inbox capture", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /screenshot/i }));
    expect(
      await screen.findByText("Screenshot 2026-06-18 at 10.00.00.png"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /import to inbox/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /extract text/i }),
    );

    await waitFor(() => {
      expect(ocr.ocrImageBlobToText).toHaveBeenCalled();
      expect(api.spsReadRow).toHaveBeenCalledWith("_inbox", "cap-shot");
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "_inbox",
        "cap-shot",
        expect.stringContaining("## OCR Text\n\nOCR text from screenshot."),
      );
      expect(
        String(
          (screen.getByLabelText(/corpus description/i) as HTMLTextAreaElement)
            .value,
        ),
      ).toContain("OCR text from screenshot.");
    });
  });

  it("shows a no-screenshot message when there is nothing recent to import", async () => {
    api.spsListRecentScreenshots.mockResolvedValue([]);
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /screenshot/i }));

    expect(
      await screen.findByText("No recent screenshots found."),
    ).toBeInTheDocument();
  });

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

  it("opens Deck Studio from a reviewed source", async () => {
    render(<SourceIntakePanel />);

    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://example.com/page" },
    });
    fireEvent.click(screen.getByRole("button", { name: /read source/i }));

    expect(await screen.findByText("Example Page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /deck from source/i }));

    expect(store.openDeckStudioInput).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: expect.stringContaining("# Example Page"),
        title: "Example Page",
        theme: "research",
        sourceRefs: [
          expect.objectContaining({
            kind: "research",
            label: "Example Page",
            locator: "https://example.com/page",
          }),
        ],
      }),
    );
    expect(
      await screen.findByText("Opened Deck Studio with this source."),
    ).toBeInTheDocument();
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

  it("opens Deck Studio from a study result", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /study/i }));
    fireEvent.change(screen.getByLabelText(/study focus/i), {
      target: { value: "Source-backed workflows" },
    });
    fireEvent.change(screen.getByLabelText(/corpus description/i), {
      target: { value: "Use https://one.example/study." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^study$/i }));

    expect(
      await screen.findByText(/source-backed workflows/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /deck from study/i }));

    expect(store.openDeckStudioInput).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Source-backed workflows",
        notes: expect.stringContaining("The corpus argues"),
        theme: "research",
      }),
    );
    expect(
      await screen.findByText("Opened Deck Studio with this study."),
    ).toBeInTheDocument();
  });

  it("runs a Curated Brief and saves source-backed output to the Knowledge Base", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /study/i }));
    fireEvent.change(screen.getByLabelText(/study focus/i), {
      target: { value: "Source-backed workflows" },
    });
    fireEvent.change(screen.getByLabelText(/corpus description/i), {
      target: { value: "Use https://one.example/study." },
    });
    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));

    expect(
      await screen.findByText(/curated, source-backed/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save brief to kb/i }));

    await waitFor(() => {
      expect(api.spsCuratedBrief).toHaveBeenCalledWith(
        "Source-backed workflows",
        "Use https://one.example/study.",
      );
      expect(api.spsFileResearch).toHaveBeenCalledWith(
        "Source-backed workflows",
        expect.stringContaining("## Sources"),
      );
      expect(
        screen.getByText("Saved brief to Knowledge Base."),
      ).toBeInTheDocument();
    });
  });

  it("does not file a Curated Brief without usable sources", async () => {
    api.spsCuratedBrief.mockResolvedValue({
      kind: "chat",
      reply: [
        "## Brief\nUnsupported synthesis.\n\n## Sources\n- Internal memory",
      ],
    });
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /study/i }));
    fireEvent.change(screen.getByLabelText(/study focus/i), {
      target: { value: "Unsourced brief" },
    });
    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));

    expect(
      await screen.findByText(/unsupported synthesis/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save brief to kb/i }));

    expect(api.spsFileResearch).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/could not find usable source links/i),
    ).toBeInTheDocument();
  });

  it("saves a Curated Brief as a Content Studio idea and opens Deck Studio", async () => {
    render(<SourceIntakePanel />);

    fireEvent.click(screen.getByRole("tab", { name: /study/i }));
    fireEvent.change(screen.getByLabelText(/study focus/i), {
      target: { value: "Curated brief content" },
    });
    fireEvent.change(screen.getByLabelText(/corpus description/i), {
      target: { value: "Use https://one.example/study." },
    });
    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));

    expect(
      await screen.findByText(/curated, source-backed/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /save brief as content idea/i }),
    );

    await waitFor(() =>
      expect(store.openContentStudioIdea).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Curated brief content",
          sourceUrls: [
            "https://one.example/study",
            "https://brief.example/source",
          ],
          capturedFrom: "curated-brief",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /deck from brief/i }));

    expect(store.openDeckStudioInput).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Curated brief content",
        notes: expect.stringContaining("## Perspectives"),
        theme: "research",
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
