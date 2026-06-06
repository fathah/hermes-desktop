// research/ — scholarly search provider for the SPS workspace. Default export is
// the bridge (real OpenAlex via main process, Mock fallback offline).
import { BridgeResearch } from "./BridgeResearch";

export const research = new BridgeResearch();
export type { ResearchProvider } from "./ResearchProvider";
export type { WorkSummary, WorkDetail, SearchOpts } from "./ResearchProvider";
