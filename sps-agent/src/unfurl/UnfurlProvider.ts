// UnfurlProvider.ts — link-metadata contract. The browser cannot fetch arbitrary
// cross-origin pages (CORS), so a real unfurl must be a server endpoint; until then
// MockUnfurl returns a host-derived placeholder. Phase 9 adds GET /api/unfurl?url=.
import type { BookmarkMeta } from "../types";

export interface UnfurlProvider {
  fetch(url: string): Promise<BookmarkMeta>;
}
