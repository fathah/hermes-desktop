import { describe, expect, it, vi } from "vitest";
import {
  discoverSubstackFeed,
  parseRssArticles,
  parseRssFeedMetadata,
} from "./rss-discovery";

const rssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Lenny's Newsletter</title>
    <link>https://www.lennysnewsletter.com</link>
    <description>Product and growth essays.</description>
    <item>
      <guid>post-1</guid>
      <title>How to build better products</title>
      <link>https://www.lennysnewsletter.com/p/product</link>
      <author>Lenny Rachitsky</author>
      <pubDate>Mon, 15 Jun 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>Useful product advice.</p>]]></description>
    </item>
  </channel>
</rss>`;

function okResponse(body: string, contentType = "application/xml"): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
  } as Response;
}

describe("discoverSubstackFeed", () => {
  it("discovers and parses a publication feed from a homepage URL", async () => {
    const fetcher = vi.fn(async () => okResponse(rssXml));

    const result = await discoverSubstackFeed(
      "https://www.lennysnewsletter.com/p/some-post",
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://www.lennysnewsletter.com/feed",
      expect.any(Object),
    );
    expect(result).toEqual({
      ok: true,
      feedUrl: "https://www.lennysnewsletter.com/feed",
      siteUrl: "https://www.lennysnewsletter.com",
      title: "Lenny's Newsletter",
      description: "Product and growth essays.",
      sourceType: "substack",
    });
  });

  it("returns a user-facing error when no public feed is found", async () => {
    const fetcher = vi.fn(async () =>
      okResponse("<html>No feed</html>", "text/html"),
    );

    await expect(
      discoverSubstackFeed("https://example.com", fetcher),
    ).resolves.toEqual({
      ok: false,
      error:
        "This URL did not expose a public RSS or Atom feed. Try the publication homepage, or confirm the publication has a public /feed URL.",
    });
  });
});

describe("parseRssFeedMetadata", () => {
  it("extracts feed-level metadata", () => {
    expect(parseRssFeedMetadata(rssXml)).toEqual({
      title: "Lenny's Newsletter",
      siteUrl: "https://www.lennysnewsletter.com",
      description: "Product and growth essays.",
    });
  });
});

describe("parseRssArticles", () => {
  it("extracts RSS items as article records", () => {
    expect(parseRssArticles(rssXml)).toEqual([
      {
        guid: "post-1",
        title: "How to build better products",
        author: "Lenny Rachitsky",
        url: "https://www.lennysnewsletter.com/p/product",
        published_at: Date.parse("Mon, 15 Jun 2026 10:00:00 GMT"),
        content_raw: "<p>Useful product advice.</p>",
        content_text: "Useful product advice.",
        summary_excerpt: "Useful product advice.",
        relevance_score: 80,
      },
    ]);
  });
});
