// MockUnfurl.ts — host-derived placeholder preview. Ported from editor.jsx
// BookmarkBlock.commit(). Swapped for a real endpoint-backed provider in Phase 9.
import type { BookmarkMeta } from "../types";
import type { UnfurlProvider } from "./UnfurlProvider";

export class MockUnfurl implements UnfurlProvider {
  async fetch(raw: string): Promise<BookmarkMeta> {
    const url = raw.startsWith("http") ? raw : "https://" + raw;
    let host = url;
    try {
      host = new URL(url).hostname.replace("www.", "");
    } catch {
      /* keep raw */
    }
    const name = host.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
    return {
      url,
      title: `${name} — link preview`,
      desc: "A saved bookmark. In a live workspace this card shows the page title, description, and favicon.",
    };
  }
}
