import type * as Api from "../api-types";

export interface SubstackRadarBridgeApi {
  spsSubstackRadarRun: (
    input: Api.SubstackRadarRunInput,
  ) => Promise<Api.SubstackRadarRun>;

  spsSubstackRadarListRuns: (
    profile?: string,
  ) => Promise<Api.SubstackRadarRun[]>;

  spsSubstackRadarSetCandidateStatus: (
    input: Api.SubstackRadarSetCandidateStatusInput,
  ) => Promise<{ ok: boolean; error?: string }>;

  spsSubstackRadarAddApprovedFeeds: (
    input: Api.SubstackRadarAddApprovedFeedsInput,
  ) => Promise<Api.SubstackRadarAddApprovedFeedsResult>;
}
