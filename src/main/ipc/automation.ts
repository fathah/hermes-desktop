import { ipcMain } from "electron";
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
  ipcMain.handle(
    "list-cron-jobs",
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobs(includeDisabled, profile),
  );
  ipcMain.handle(
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
  ipcMain.handle("remove-cron-job", (_event, jobId: string, profile?: string) =>
    removeCronJob(jobId, profile),
  );
  ipcMain.handle("pause-cron-job", (_event, jobId: string, profile?: string) =>
    pauseCronJob(jobId, profile),
  );
  ipcMain.handle("resume-cron-job", (_event, jobId: string, profile?: string) =>
    resumeCronJob(jobId, profile),
  );
  ipcMain.handle(
    "trigger-cron-job",
    (_event, jobId: string, profile?: string) => triggerCronJob(jobId, profile),
  );

  // Curator
  ipcMain.handle("get-curator-status", (_event, profile?: string) =>
    getCuratorStatus(profile),
  );
  ipcMain.handle("run-curator-now", (_event, profile?: string) =>
    runCuratorNow(profile),
  );
  ipcMain.handle("pause-curator", (_event, profile?: string) =>
    pauseCurator(profile),
  );
  ipcMain.handle("resume-curator", (_event, profile?: string) =>
    resumeCurator(profile),
  );
  ipcMain.handle("list-archived-skills", (_event, profile?: string) =>
    listArchivedSkills(profile),
  );
  ipcMain.handle(
    "restore-archived-skill",
    (_event, name: string, profile?: string) =>
      restoreArchivedSkill(name, profile),
  );
  ipcMain.handle("pin-skill", (_event, name: string, profile?: string) =>
    pinSkill(name, profile),
  );
  ipcMain.handle("unpin-skill", (_event, name: string, profile?: string) =>
    unpinSkill(name, profile),
  );

  // Checkpoints
  ipcMain.handle("get-checkpoints-status", (_event, profile?: string) =>
    getCheckpointsStatus(profile),
  );
  ipcMain.handle("prune-checkpoints", (_event, profile?: string) =>
    pruneCheckpoints(profile),
  );
  ipcMain.handle("clear-checkpoints", (_event, profile?: string) =>
    clearCheckpoints(profile),
  );

  // Pairings
  ipcMain.handle("list-pairings", (_event, profile?: string) =>
    listPairings(profile),
  );
  ipcMain.handle("approve-pairing", (_event, code: string, profile?: string) =>
    approvePairing(code, profile),
  );
  ipcMain.handle("revoke-pairing", (_event, userId: string, profile?: string) =>
    revokePairing(userId, profile),
  );
  ipcMain.handle("clear-pending-pairings", (_event, profile?: string) =>
    clearPendingPairings(profile),
  );
}
