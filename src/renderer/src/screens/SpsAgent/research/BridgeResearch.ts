// BridgeResearch.ts — scholarly search via the Electron main process
// (SSRF-hardened OpenAlex client in src/main/openalex.ts). Falls back to
// MockResearch when the bridge is unavailable, exactly like BridgeUnfurl.
import type { ResearchProvider } from "./ResearchProvider";
import type {
  WorkSummary,
  WorkDetail,
  SearchOpts,
} from "../../../../../shared/openalex/core";
import { MockResearch } from "./MockResearch";

export class BridgeResearch implements ResearchProvider {
  private fallback = new MockResearch();

  async searchWorks(q: string, opts?: SearchOpts): Promise<WorkSummary[]> {
    try {
      const results = await window.hermesAPI.spsResearchSearchWorks(q, opts);
      if (!Array.isArray(results)) throw new Error("no data");
      return results;
    } catch {
      return this.fallback.searchWorks(q, opts);
    }
  }

  async getWork(id: string): Promise<WorkDetail> {
    try {
      const work = await window.hermesAPI.spsResearchGetWork(id);
      if (!work || !work.id) throw new Error("no data");
      return work;
    } catch {
      return this.fallback.getWork(id);
    }
  }
}
