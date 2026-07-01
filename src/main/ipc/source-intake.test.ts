import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCrawlStatus,
  mockCrawlPublicUrl,
  mockUnfurl,
  mockDiscoverSubstack,
  mockPublicFetch,
} = vi.hoisted(() => ({
  mockCrawlStatus: vi.fn(),
  mockCrawlPublicUrl: vi.fn(),
  mockUnfurl: vi.fn(),
  mockDiscoverSubstack: vi.fn(),
  mockPublicFetch: vi.fn(),
}));

vi.mock("../crawl4ai", () => ({
  getCrawl4AiStatus: mockCrawlStatus,
  crawlPublicUrl: mockCrawlPublicUrl,
  getCrawl4AiInstallInstructions: () => "install crawl4ai",
}));

vi.mock("../sps-agent", () => ({
  spsUnfurl: mockUnfurl,
}));

vi.mock("../rss-discovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rss-discovery")>();
  return {
    ...actual,
    discoverSubstackFeed: mockDiscoverSubstack,
  };
});

vi.mock("../security/network-policy", () => ({
  publicFetch: mockPublicFetch,
}));

import { getSourceIntakeStatus, previewSourceUrl } from "./source-intake";

beforeEach(() => {
  vi.clearAllMocks();
  mockCrawlStatus.mockResolvedValue({
    installed: false,
    version: null,
    doctorOk: false,
    checkedAt: 1,
    error: "Crawl4AI CLI is not installed.",
  });
  mockUnfurl.mockResolvedValue({
    url: "https://example.com/page",
    title: "Example",
    desc: "Preview text.",
  });
  mockDiscoverSubstack.mockResolvedValue({
    ok: true,
    feedUrl: "https://example.substack.com/feed",
    siteUrl: "https://example.substack.com",
    title: "Example Substack",
    description: "Sharp notes.",
    sourceType: "substack",
  });
  mockPublicFetch.mockResolvedValue(
    new Response(
      `<?xml version="1.0"?><rss><channel><title>Feed Title</title><description>Feed notes.</description><link>https://example.com</link></channel></rss>`,
      { status: 200 },
    ),
  );
});

describe("getSourceIntakeStatus", () => {
  it("reports RSS and optional Crawl4AI capabilities", async () => {
    mockCrawlStatus.mockResolvedValue({
      installed: true,
      version: "0.8.9",
      doctorOk: true,
      checkedAt: 1,
    });

    const status = await getSourceIntakeStatus();

    expect(status.capabilities).toEqual([
      expect.objectContaining({ key: "rss", ready: true }),
      expect.objectContaining({
        key: "crawl4ai",
        ready: true,
        message: "Crawl4AI v0.8.9 ready",
      }),
    ]);
  });
});

describe("previewSourceUrl", () => {
  it("returns a structured blocked result without throwing", async () => {
    const result = await previewSourceUrl("file:///etc/passwd");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Only public HTTPS source URLs can be imported.");
    expect(mockCrawlPublicUrl).not.toHaveBeenCalled();
  });

  it("previews Substack URLs through feed discovery", async () => {
    const result = await previewSourceUrl(
      "https://example.substack.com/p/post",
    );

    expect(result).toMatchObject({
      ok: true,
      canonicalUrl: "https://example.substack.com/feed",
      title: "Example Substack",
      engine: "rss",
    });
    expect(result.markdown).toContain("## Sources");
  });

  it("uses Crawl4AI for generic public pages when ready", async () => {
    mockCrawlStatus.mockResolvedValue({
      installed: true,
      version: "0.8.9",
      doctorOk: true,
      checkedAt: 1,
    });
    mockCrawlPublicUrl.mockResolvedValue({
      ok: true,
      sourceUrl: "https://example.com/page",
      canonicalUrl: "https://example.com/page",
      title: "Crawled",
      markdown: "# Crawled",
      excerpt: "Crawled",
      links: [],
      engine: "crawl4ai",
      fetchedAt: 1,
    });

    const result = await previewSourceUrl("https://example.com/page");

    expect(result.engine).toBe("crawl4ai");
    expect(mockUnfurl).not.toHaveBeenCalled();
  });

  it("falls back to SSRF-hardened unfurl when Crawl4AI is unavailable", async () => {
    const result = await previewSourceUrl("https://example.com/page");

    expect(result).toMatchObject({
      ok: true,
      title: "Example",
      engine: "unfurl",
    });
    expect(result.markdown).toContain("## Sources");
  });

  it("previews RSS URLs through the public SSRF-hardened fetch helper", async () => {
    const result = await previewSourceUrl("https://example.com/feed.xml");

    expect(mockPublicFetch).toHaveBeenCalledWith(
      "https://example.com/feed.xml",
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: expect.stringContaining("application/rss+xml"),
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      title: "Feed Title",
      engine: "rss",
    });
  });
});
