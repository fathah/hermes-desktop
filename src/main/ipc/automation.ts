import { safeHandle } from "./safe-handle";
import {
  listCronJobs,
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
  getCuratorStatus,
  runCuratorNow,
  pauseCurator,
  resumeCurator,
  listArchivedSkills,
  restoreArchivedSkill,
  pinSkill,
  unpinSkill,
} from "../cronjobs";
import {
  getCheckpointsStatus,
  pruneCheckpoints,
  clearCheckpoints,
} from "../checkpoints";
import {
  listPairings,
  approvePairing,
  revokePairing,
  clearPendingPairings,
} from "../pairing";

// Background automation & maintenance: scheduled cron jobs, the skill curator,
// checkpoint pruning, and device pairings. Grouped because each is a small,
// desktop-managed background concern rather than a user-facing workspace area.
export function registerAutomationIpc(): void {
  // Cron Jobs
  safeHandle(
    "list-cron-jobs",
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobs(includeDisabled, profile),
  );
  safeHandle(
    "create-cron-job",
    (
      _event,
      schedule: string,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
      opts?: {
        freshnessWindowMinutes?: number;
        failureBehavior?: "retry" | "notify" | "ignore";
        firstRunManual?: boolean;
      },
    ) => createCronJob(schedule, prompt, name, deliver, profile, opts),
  );
  safeHandle("remove-cron-job", (_event, jobId: string, profile?: string) =>
    removeCronJob(jobId, profile),
  );
  safeHandle("pause-cron-job", (_event, jobId: string, profile?: string) =>
    pauseCronJob(jobId, profile),
  );
  safeHandle("resume-cron-job", (_event, jobId: string, profile?: string) =>
    resumeCronJob(jobId, profile),
  );
  safeHandle("trigger-cron-job", (_event, jobId: string, profile?: string) =>
    triggerCronJob(jobId, profile),
  );

  // Curator
  safeHandle("get-curator-status", (_event, profile?: string) =>
    getCuratorStatus(profile),
  );
  safeHandle("run-curator-now", (_event, profile?: string) =>
    runCuratorNow(profile),
  );
  safeHandle("pause-curator", (_event, profile?: string) =>
    pauseCurator(profile),
  );
  safeHandle("resume-curator", (_event, profile?: string) =>
    resumeCurator(profile),
  );
  safeHandle("list-archived-skills", (_event, profile?: string) =>
    listArchivedSkills(profile),
  );
  safeHandle(
    "restore-archived-skill",
    (_event, name: string, profile?: string) =>
      restoreArchivedSkill(name, profile),
  );
  safeHandle("pin-skill", (_event, name: string, profile?: string) =>
    pinSkill(name, profile),
  );
  safeHandle("unpin-skill", (_event, name: string, profile?: string) =>
    unpinSkill(name, profile),
  );

  // Checkpoints
  safeHandle("get-checkpoints-status", (_event, profile?: string) =>
    getCheckpointsStatus(profile),
  );
  safeHandle("prune-checkpoints", (_event, profile?: string) =>
    pruneCheckpoints(profile),
  );
  safeHandle("clear-checkpoints", (_event, profile?: string) =>
    clearCheckpoints(profile),
  );

  // Pairings
  safeHandle("list-pairings", (_event, profile?: string) =>
    listPairings(profile),
  );
  safeHandle("approve-pairing", (_event, code: string, profile?: string) =>
    approvePairing(code, profile),
  );
  safeHandle("revoke-pairing", (_event, userId: string, profile?: string) =>
    revokePairing(userId, profile),
  );
  safeHandle("clear-pending-pairings", (_event, profile?: string) =>
    clearPendingPairings(profile),
  );
}
