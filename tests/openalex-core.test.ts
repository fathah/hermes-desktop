import { describe, it, expect, vi } from "vitest";
import {
  createOpenAlexClient,
  type FetchLike,
} from "../src/shared/openalex/core";

/** A FetchLike that records the URL it was called with and returns `payload`. */
function stubFetch(payload: unknown): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetch, urls };
}

describe("createOpenAlexClient — URL construction", () => {
  it("appends mailto and api_key when configured", () => {
    const { fetch } = stubFetch({});
    const client = createOpenAlexClient({
      fetchImpl: fetch,
      apiKey: "secret",
      mailto: "a@b.com",
    });
    const url = new URL(client.buildUrl("/works", { search: "x" }));
    expect(url.searchParams.get("mailto")).toBe("a@b.com");
    expect(url.searchParams.get("api_key")).toBe("secret");
    expect(url.searchParams.get("search")).toBe("x");
  });

  it("omits mailto/api_key and empty params when not configured", () => {
    const { fetch } = stubFetch({});
    const client = createOpenAlexClient({ fetchImpl: fetch });
    const url = new URL(client.buildUrl("/works", { search: "", filter: "f" }));
    expect(url.searchParams.has("mailto")).toBe(false);
    expect(url.searchParams.has("api_key")).toBe(false);
    expect(url.searchParams.has("search")).toBe(false); // empty dropped
    expect(url.searchParams.get("filter")).toBe("f");
  });

  it("clamps per_page to [1,100] and selects trimmed fields on search", async () => {
    const { fetch, urls } = stubFetch({ results: [] });
    const client = createOpenAlexClient({ fetchImpl: fetch });
    await client.searchWorks("graphene", { perPage: 999 });
    const url = new URL(urls[0]);
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(url.searchParams.get("search")).toBe("graphene");
    expect(url.searchParams.get("select")).toContain("display_name");
  });
});

describe("createOpenAlexClient — normalization", () => {
  const rawWork = {
    id: "https://openalex.org/W42",
    display_name: "On Widgets",
    publication_year: 2021,
    authorships: [
      { author: { display_name: "Ada Lovelace" } },
      { raw_author_name: "Anon" },
    ],
    primary_location: { source: { display_name: "J. Widgets" } },
    best_oa_location: { pdf_url: "https://x/y.pdf" },
    open_access: { is_oa: true, oa_url: "https://x/landing" },
    cited_by_count: 7,
    topics: [{ display_name: "Widgetry" }, { display_name: "" }],
    doi: "https://doi.org/10.1/abc",
  };

  it("maps a raw work to a WorkSummary with bare id and clean fields", async () => {
    const { fetch } = stubFetch({ results: [rawWork] });
    const client = createOpenAlexClient({ fetchImpl: fetch });
    const [w] = await client.searchWorks("widgets");
    expect(w).toMatchObject({
      id: "W42",
      title: "On Widgets",
      year: 2021,
      authors: ["Ada Lovelace", "Anon"],
      venue: "J. Widgets",
      citedByCount: 7,
      isOA: true,
      oaUrl: "https://x/y.pdf",
      topics: ["Widgetry"],
      doi: "10.1/abc",
    });
  });

  it("getWork reconstructs the abstract and counts references", async () => {
    const detail = {
      ...rawWork,
      abstract_inverted_index: { Hello: [0], world: [1] },
      referenced_works: ["https://openalex.org/W1", "https://openalex.org/W2"],
      related_works: ["https://openalex.org/W9"],
    };
    const { fetch } = stubFetch(detail);
    const client = createOpenAlexClient({ fetchImpl: fetch });
    const w = await client.getWork("W42");
    expect(w.abstract).toBe("Hello world");
    expect(w.referencedCount).toBe(2);
    expect(w.relatedIds).toEqual(["W9"]);
  });

  it("groupBy maps meta.group_by buckets", async () => {
    const { fetch, urls } = stubFetch({
      group_by: [
        { key: "2021", key_display_name: "2021", count: 5 },
        { key: "2020", count: 3 },
      ],
    });
    const client = createOpenAlexClient({ fetchImpl: fetch });
    const buckets = await client.groupBy("is_oa:true", "publication_year");
    expect(buckets).toEqual([
      { key: "2021", keyDisplayName: "2021", count: 5 },
      { key: "2020", keyDisplayName: "2020", count: 3 },
    ]);
    expect(new URL(urls[0]).searchParams.get("group_by")).toBe(
      "publication_year",
    );
  });

  it("throws on a non-ok response", async () => {
    const fetch: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    }));
    const client = createOpenAlexClient({ fetchImpl: fetch });
    await expect(client.searchWorks("x")).rejects.toThrow(/429/);
  });
});
