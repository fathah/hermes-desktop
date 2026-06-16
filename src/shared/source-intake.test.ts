import { describe, expect, it } from "vitest";
import { routeSourceInput } from "./source-intake";

describe("routeSourceInput", () => {
  it("routes Substack URLs to RSS discovery", () => {
    expect(
      routeSourceInput("https://example.substack.com/p/post"),
    ).toMatchObject({
      kind: "substack",
      engine: "rss",
      normalizedUrl: "https://example.substack.com/p/post",
    });
  });

  it("routes RSS-like URLs to RSS intake", () => {
    expect(routeSourceInput("https://example.com/feed")).toMatchObject({
      kind: "rss",
      engine: "rss",
      normalizedUrl: "https://example.com/feed",
    });
  });

  it("routes generic HTTPS URLs to public webpage extraction", () => {
    expect(routeSourceInput("example.com/article")).toMatchObject({
      kind: "webpage",
      engine: "crawl4ai",
      normalizedUrl: "https://example.com/article",
    });
  });

  it("blocks non-HTTPS URLs", () => {
    expect(routeSourceInput("http://example.com/feed")).toMatchObject({
      kind: "blocked",
      error: "Only public HTTPS source URLs can be imported.",
    });
  });

  it("blocks local and private URLs", () => {
    expect(routeSourceInput("https://localhost:3000")).toMatchObject({
      kind: "blocked",
      error: "Private, local, or credential-bearing URLs cannot be imported.",
    });
    expect(routeSourceInput("https://192.168.1.10/page")).toMatchObject({
      kind: "blocked",
      error: "Private, local, or credential-bearing URLs cannot be imported.",
    });
  });

  it("blocks file URLs", () => {
    expect(routeSourceInput("file:///etc/passwd")).toMatchObject({
      kind: "blocked",
      error: "Only public HTTPS source URLs can be imported.",
    });
  });
});
