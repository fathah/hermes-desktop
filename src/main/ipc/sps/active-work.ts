import { safeHandle } from "../safe-handle";
import { spsGetWorkSession, spsSetWorkSession } from "../../sps-work-sessions";
import {
  listActiveWorkRuns,
  getActiveWorkRun,
  createActiveWorkRun,
  updateActiveWorkRun,
} from "../../active-work-runs";
import type {
  ActiveWorkCreateInput,
  ActiveWorkPatch,
} from "../../../shared/active-work";

export function registerSpsActiveWorkIpc(): void {
  safeHandle(
    "sps-get-work-session",
    (_event, pageId: string, profile?: string) =>
      spsGetWorkSession(pageId, profile),
  );
  safeHandle(
    "sps-set-work-session",
    (_event, pageId: string, sessionId: string, profile?: string) =>
      spsSetWorkSession(pageId, sessionId, profile),
  );
  safeHandle("sps-active-work-list", (_event, profile?: string) =>
    listActiveWorkRuns(profile),
  );
  safeHandle("sps-active-work-get", (_event, runId: string, profile?: string) =>
    getActiveWorkRun(runId, profile),
  );
  safeHandle(
    "sps-active-work-create",
    (_event, input: ActiveWorkCreateInput, profile?: string) =>
      createActiveWorkRun(input, profile),
  );
  safeHandle(
    "sps-active-work-update",
    (_event, runId: string, patch: ActiveWorkPatch, profile?: string) =>
      updateActiveWorkRun(runId, patch, profile),
  );
}
