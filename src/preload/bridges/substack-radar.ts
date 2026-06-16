import { ipcRenderer } from "electron";
import type {
  SubstackRadarAddApprovedFeedsInput,
  SubstackRadarAddApprovedFeedsResult,
  SubstackRadarRun,
  SubstackRadarRunInput,
  SubstackRadarSetCandidateStatusInput,
} from "../../shared/substack-radar";

export type {
  SubstackRadarAddApprovedFeedsResult,
  SubstackRadarAddApprovedFeedsInput,
  SubstackRadarApprovedFeed,
  SubstackRadarCandidate,
  SubstackRadarCandidateStatus,
  SubstackRadarDiscoveredFeed,
  SubstackRadarRun,
  SubstackRadarRunInput,
  SubstackRadarRunStatus,
  SubstackRadarSetCandidateStatusInput,
  SubstackRadarVisibleSignals,
} from "../../shared/substack-radar";

export const substackRadarBridge = {
  spsSubstackRadarRun: (
    input: SubstackRadarRunInput,
  ): Promise<SubstackRadarRun> =>
    ipcRenderer.invoke("sps-substack-radar-run", input),
  spsSubstackRadarListRuns: (profile?: string): Promise<SubstackRadarRun[]> =>
    ipcRenderer.invoke("sps-substack-radar-list-runs", profile),
  spsSubstackRadarSetCandidateStatus: (
    input: SubstackRadarSetCandidateStatusInput,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("sps-substack-radar-set-candidate-status", input),
  spsSubstackRadarAddApprovedFeeds: (
    input: SubstackRadarAddApprovedFeedsInput,
  ): Promise<SubstackRadarAddApprovedFeedsResult> =>
    ipcRenderer.invoke("sps-substack-radar-add-approved-feeds", input),
};
