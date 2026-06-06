// ResearchProvider.ts — scholarly-search contract for the SPS workspace.
// Mirrors the unfurl/ provider pattern: a Bridge implementation delegates to the
// SSRF-hardened main process (window.hermesAPI.spsResearch*), with a Mock that
// returns canned data offline (and in the Playwright smoke harness).
//
// DTO types are re-exported from the Electron-free shared core so the renderer,
// main process, and MCP server all speak the exact same shapes.
export type {
  WorkSummary,
  WorkDetail,
  SearchOpts,
} from "../../../../../shared/openalex/core";

import type {
  WorkSummary,
  WorkDetail,
  SearchOpts,
} from "../../../../../shared/openalex/core";

export interface ResearchProvider {
  searchWorks(q: string, opts?: SearchOpts): Promise<WorkSummary[]>;
  getWork(id: string): Promise<WorkDetail>;
}
