import { describe, expect, it } from "vitest";
import { getSubstackFeedCandidates } from "./substack";

describe("getSubstackFeedCandidates", () => {
  it("turns Substack publication and post URLs into the publication feed", () => {
    expect(getSubstackFeedCandidates("example.substack.com")).toEqual({
      ok: true,
      siteUrl: "https://example.substack.com",
      feedUrls: ["https://example.substack.com/feed"],
    });
    expect(
      getSubstackFeedCandidates("https://example.substack.com/p/post-title"),
    ).toEqual({
      ok: true,
      siteUrl: "https://example.substack.com",
      feedUrls: ["https://example.substack.com/feed"],
    });
  });

  it("turns custom-domain publication URLs into /feed candidates", () => {
    expect(
      getSubstackFeedCandidates("https://www.lennysnewsletter.com/p/abc"),
    ).toEqual({
      ok: true,
      siteUrl: "https://www.lennysnewsletter.com",
      feedUrls: ["https://www.lennysnewsletter.com/feed"],
    });
  });

  it("keeps an explicit feed URL as the first candidate", () => {
    expect(
      getSubstackFeedCandidates("https://example.substack.com/feed"),
    ).toEqual({
      ok: true,
      siteUrl: "https://example.substack.com",
      feedUrls: ["https://example.substack.com/feed"],
    });
  });

  it("rejects unsafe or empty URLs", () => {
    expect(getSubstackFeedCandidates("")).toEqual({
      ok: false,
      error: "Enter a Substack publication or article URL.",
    });
    expect(getSubstackFeedCandidates("file:///Users/amar/private.xml")).toEqual(
      {
        ok: false,
        error: "Only http and https URLs can be used for public feeds.",
      },
    );
    expect(getSubstackFeedCandidates("javascript:alert(1)")).toEqual({
      ok: false,
      error: "Only http and https URLs can be used for public feeds.",
    });
  });
});
