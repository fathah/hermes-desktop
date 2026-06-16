import { ipcRenderer } from "electron";
import type { SubstackRadarVisibleSignals } from "../../shared/substack-radar";

export type { SubstackRadarVisibleSignals } from "../../shared/substack-radar";

export type SubstackRadarRunStatus = "running" | "complete" | "failed";
export type SubstackRadarCandidateStatus = "new" | "approved" | "rejected";

export interface SubstackRadarCandidate {
  id: string;
  publicationUrl: string;
  feedUrl?: string;
  title: string;
  description: string;
  author?: string;
  category: string;
  visibleSignals: SubstackRadarVisibleSignals;
  sourcePageUrl: string;
  discoveredAt: number;
  score: number;
  status: SubstackRadarCandidateStatus;
}

export interface SubstackRadarRun {
  id: string;
  query: string;
  categories: string[];
  status: SubstackRadarRunStatus;
  startedAt: number;
  finishedAt?: number;
  sourceUrls: string[];
  candidates: SubstackRadarCandidate[];
  error?: string;
}

export type SubstackRadarDiscoveredFeed =
  | {
      ok: true;
      feedUrl: string;
      siteUrl: string;
      title: string;
      description: string;
      sourceType: "substack";
    }
  | {
      ok: false;
      error: string;
    };

export interface SubstackRadarApprovedFeed {
  candidateId: string;
  feed: SubstackRadarDiscoveredFeed;
}

export interface SubstackRadarAddApprovedFeedsResult {
  added: number;
  feeds: SubstackRadarApprovedFeed[];
}

export const substackRadarBridge = {
  spsSubstackRadarRun: (input: {
    categories: string[];
    profile?: string;
  }): Promise<SubstackRadarRun> =>
    ipcRenderer.invoke("sps-substack-radar-run", input),
  spsSubstackRadarListRuns: (profile?: string): Promise<SubstackRadarRun[]> =>
    ipcRenderer.invoke("sps-substack-radar-list-runs", profile),
  spsSubstackRadarSetCandidateStatus: (input: {
    runId: string;
    candidateId: string;
    status: "approved" | "rejected";
    profile?: string;
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("sps-substack-radar-set-candidate-status", input),
  spsSubstackRadarAddApprovedFeeds: (input: {
    runId: string;
    profile?: string;
  }): Promise<SubstackRadarAddApprovedFeedsResult> =>
    ipcRenderer.invoke("sps-substack-radar-add-approved-feeds", input),
};
