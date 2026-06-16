import { ipcRenderer } from "electron";

type JsonRecord = Record<string, unknown>;

export const substackRadarBridge = {
  spsSubstackRadarRun: (input: {
    categories: string[];
    profile?: string;
  }): Promise<JsonRecord> =>
    ipcRenderer.invoke("sps-substack-radar-run", input),
  spsSubstackRadarListRuns: (profile?: string): Promise<JsonRecord[]> =>
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
  }): Promise<{ added: number; feeds: JsonRecord[] }> =>
    ipcRenderer.invoke("sps-substack-radar-add-approved-feeds", input),
};
