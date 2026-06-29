import type * as Api from "../api-types";

export interface SystemBridgeApi {
  checkForUpdates: () => Promise<string | null>;

  downloadUpdate: () => Promise<boolean>;

  installUpdate: () => Promise<void>;

  getAppVersion: () => Promise<string>;

  getDesktopUpdateRoutine: () => Promise<Api.DesktopUpdateRoutineState>;

  setDesktopUpdateRoutine: (
    settings: Partial<{ enabled: boolean; autoDownload: boolean }>,
  ) => Promise<Api.DesktopUpdateRoutineState>;

  runDesktopUpdateCheck: (
    options?: Partial<{ autoDownload: boolean }>,
  ) => Promise<Api.DesktopUpdateRoutineResult>;

  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes: string }) => void,
  ) => () => void;

  onUpdateDownloadProgress: (
    callback: (info: { percent: number }) => void,
  ) => () => void;

  onUpdateDownloaded: (callback: () => void) => () => void;

  onUpdateError: (callback: (message: string) => void) => () => void;

  // Menu events

  onMenuNewChat: (callback: () => void) => () => void;

  onMenuSearchSessions: (callback: () => void) => () => void;

  // Cron Jobs

  listCronJobs: (
    includeDisabled?: boolean,
    profile?: string,
  ) => Promise<Api.CronJob[]>;

  createCronJob: (
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
  ) => Promise<{ success: boolean; error?: string; paused?: boolean }>;

  removeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  pauseCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  resumeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  triggerCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Curator

  getCuratorStatus: (profile?: string) => Promise<string>;

  runCuratorNow: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  pauseCurator: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  resumeCurator: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  listArchivedSkills: (profile?: string) => Promise<string>;

  restoreArchivedSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  pinSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  unpinSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  // Checkpoints

  getCheckpointsStatus: (profile?: string) => Promise<string>;

  pruneCheckpoints: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  clearCheckpoints: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  // Pairing

  listPairings: (profile?: string) => Promise<string>;

  approvePairing: (
    code: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  revokePairing: (
    userId: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  clearPendingPairings: (
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  // Security & Prompt Size

  runSecurityAudit: (profile?: string) => Promise<string>;

  getPromptSizeBreakdown: (profile?: string) => Promise<string>;

  // Git Changelog

  getGitChangelog: () => Promise<string>;

  // Kanban
}
