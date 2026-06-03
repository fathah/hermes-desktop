// unfurl/index.ts — the active unfurl provider. In the Electron app this is the
// main-process bridge (real IP-pinned fetch); MockUnfurl is the offline fallback.
import { BridgeUnfurl } from "./BridgeUnfurl";
import type { UnfurlProvider } from "./UnfurlProvider";

export const unfurl: UnfurlProvider = new BridgeUnfurl();
export type { UnfurlProvider };
