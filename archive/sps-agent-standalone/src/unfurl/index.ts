// unfurl/index.ts — the active unfurl provider. EndpointUnfurl hits /api/unfurl
// for real metadata and falls back to MockUnfurl when the endpoint is unavailable.
import { EndpointUnfurl } from "./EndpointUnfurl";
import type { UnfurlProvider } from "./UnfurlProvider";

export const unfurl: UnfurlProvider = new EndpointUnfurl();
export type { UnfurlProvider };
