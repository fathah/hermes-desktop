import { ipcRenderer } from "electron";
import type {
  SubstackRadarAddApprovedFeedsResult,
  SubstackRadarRun,
} from "../../shared/substack-radar";

export type {
  SubstackRadarAddApprovedFeedsResult,
  SubstackRadarApprovedFeed,
  SubstackRadarCandidate,
  SubstackRadarCandidateStatus,
  SubstackRadarDiscoveredFeed,
  SubstackRadarRun,
  SubstackRadarRunStatus,
  SubstackRadarVisibleSignals,
} from "../../shared/substack-radar";

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
