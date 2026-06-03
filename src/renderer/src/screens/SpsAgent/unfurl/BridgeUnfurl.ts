// BridgeUnfurl.ts — link metadata via the Electron main process (IP-pinned,
// SSRF-hardened fetch in src/main/sps-agent.ts). Falls back to MockUnfurl if the
// bridge is unavailable.
import type { BookmarkMeta } from "../types";
import type { UnfurlProvider } from "./UnfurlProvider";
import { MockUnfurl } from "./MockUnfurl";

export class BridgeUnfurl implements UnfurlProvider {
  private fallback = new MockUnfurl();

  async fetch(raw: string): Promise<BookmarkMeta> {
    try {
      const data = await window.hermesAPI.spsUnfurl(raw);
      if (!data || !data.url) throw new Error("no data");
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
