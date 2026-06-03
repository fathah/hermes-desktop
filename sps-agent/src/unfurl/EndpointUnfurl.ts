// EndpointUnfurl.ts — real link metadata via the /api/unfurl server endpoint
// (vite-plugins/unfurl.ts in dev). Falls back to MockUnfurl if the endpoint is
// unavailable or errors, so bookmarks always render something.
import type { BookmarkMeta } from "../types";
import type { UnfurlProvider } from "./UnfurlProvider";
import { MockUnfurl } from "./MockUnfurl";

export class EndpointUnfurl implements UnfurlProvider {
  private fallback = new MockUnfurl();

  async fetch(raw: string): Promise<BookmarkMeta> {
    try {
      const res = await fetch(`/api/unfurl?url=${encodeURIComponent(raw)}`);
      if (!res.ok) throw new Error(`unfurl ${res.status}`);
      const data = (await res.json()) as Partial<BookmarkMeta> & {
        error?: string;
      };
      if (data.error || !data.url) throw new Error(data.error || "no data");
      return {
        url: data.url,
        title: data.title || data.url,
        desc: data.desc || "",
        favicon: data.favicon,
        image: data.image,
      };
    } catch {
      return this.fallback.fetch(raw);
    }
  }
}
