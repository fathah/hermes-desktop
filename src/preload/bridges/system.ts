import { ipcRenderer } from "electron";

export const systemBridge = {
  // Claw3D
  claw3dStatus: (): Promise<{
    cloned: boolean;
    installed: boolean;
    devServerRunning: boolean;
    adapterRunning: boolean;
    port: number;
    portInUse: boolean;
    wsUrl: string;
    running: boolean;
    error: string;
    remoteUrl?: string | null;
    remoteSource?: "ssh" | null;
  }> => ipcRenderer.invoke("claw3d-status"),

  claw3dSetup: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("claw3d-setup"),

  onClaw3dSetupProgress: (
    callback: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: unknown,
    ): void =>
      callback(
        progress as {
          step: number;
          totalSteps: number;
          title: string;
          detail: string;
          log: string;
        },
      );
    ipcRenderer.on("claw3d-setup-progress", handler);
    return () => ipcRenderer.removeListener("claw3d-setup-progress", handler);
  },

  claw3dGetPort: (): Promise<number> => ipcRenderer.invoke("claw3d-get-port"),
  claw3dSetPort: (port: number): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-set-port", port),
  claw3dGetWsUrl: (): Promise<string> =>
    ipcRenderer.invoke("claw3d-get-ws-url"),
  claw3dSetWsUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-set-ws-url", url),

  claw3dStartAll: (
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("claw3d-start-all", profile),
  claw3dStopAll: (): Promise<boolean> => ipcRenderer.invoke("claw3d-stop-all"),
  claw3dGetLogs: (): Promise<string> => ipcRenderer.invoke("claw3d-get-logs"),

  claw3dStartDev: (): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-start-dev"),
  claw3dStopDev: (): Promise<boolean> => ipcRenderer.invoke("claw3d-stop-dev"),
  claw3dStartAdapter: (): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-start-adapter"),
  claw3dStopAdapter: (): Promise<boolean> =>
    ipcRenderer.invoke("claw3d-stop-adapter"),

  // Updates
  checkForUpdates: (): Promise<string | null> =>
    ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke("download-update"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("install-update"),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("get-app-version"),

  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes: string }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown): void =>
      callback(info as { version: string; releaseNotes: string });
    ipcRenderer.on("update-available", handler);
    return () => ipcRenderer.removeListener("update-available", handler);
  },

  onUpdateDownloadProgress: (
    callback: (info: { percent: number }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown): void =>
      callback(info as { percent: number });
    ipcRenderer.on("update-download-progress", handler);
    return () =>
      ipcRenderer.removeListener("update-download-progress", handler);
  },

  onUpdateDownloaded: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("update-downloaded", handler);
    return () => ipcRenderer.removeListener("update-downloaded", handler);
  },

  onUpdateError: (callback: (message: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      message: unknown,
    ): void => callback(String(message));
    ipcRenderer.on("update-error", handler);
    return () => ipcRenderer.removeListener("update-error", handler);
  },

  // Menu events (from native menu bar)
  onMenuNewChat: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("menu-new-chat", handler);
    return () => ipcRenderer.removeListener("menu-new-chat", handler);
  },

  onMenuSearchSessions: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("menu-search-sessions", handler);
    return () => ipcRenderer.removeListener("menu-search-sessions", handler);
  },

  // Cron Jobs
  listCronJobs: (
    includeDisabled?: boolean,
    profile?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      schedule: string;
      prompt: string;
      state: "active" | "paused" | "completed";
      enabled: boolean;
      next_run_at: string | null;
      last_run_at: string | null;
      last_status: string | null;
      last_error: string | null;
      repeat: { times: number | null; completed: number } | null;
      deliver: string[];
      skills: string[];
      script: string | null;
    }>
  > => ipcRenderer.invoke("list-cron-jobs", includeDisabled, profile),

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
  ): Promise<{ success: boolean; error?: string; paused?: boolean }> =>
    ipcRenderer.invoke(
      "create-cron-job",
      schedule,
      prompt,
      name,
      deliver,
      profile,
      opts,
    ),

  removeCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("remove-cron-job", jobId, profile),

  pauseCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("pause-cron-job", jobId, profile),

  resumeCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("resume-cron-job", jobId, profile),

  triggerCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("trigger-cron-job", jobId, profile),

  // Curator
  getCuratorStatus: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("get-curator-status", profile),
  runCuratorNow: (
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("run-curator-now", profile),
  pauseCurator: (
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("pause-curator", profile),
  resumeCurator: (
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("resume-curator", profile),
  listArchivedSkills: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("list-archived-skills", profile),
  restoreArchivedSkill: (
    name: string,
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("restore-archived-skill", name, profile),
  pinSkill: (
    name: string,
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("pin-skill", name, profile),
  unpinSkill: (
    name: string,
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("unpin-skill", name, profile),

  // Checkpoints
  getCheckpointsStatus: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("get-checkpoints-status", profile),
  pruneCheckpoints: (
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("prune-checkpoints", profile),
  clearCheckpoints: (
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("clear-checkpoints", profile),

  // Pairing
  listPairings: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("list-pairings", profile),
  approvePairing: (
    code: string,
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("approve-pairing", code, profile),
  revokePairing: (
    userId: string,
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("revoke-pairing", userId, profile),
  clearPendingPairings: (
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("clear-pending-pairings", profile),

  // Security & Prompt Size
  runSecurityAudit: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("run-security-audit", profile),
  getPromptSizeBreakdown: (profile?: string): Promise<string> =>
    ipcRenderer.invoke("get-prompt-size-breakdown", profile),

  // Computer Use
  getComputerUseStatus: (
    profile?: string,
  ): Promise<{ installed: boolean; output: string }> =>
    ipcRenderer.invoke("get-computer-use-status", profile),
  installComputerUseDriver: (
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("install-computer-use-driver", profile),

  // Git Changelog
  getGitChangelog: (): Promise<string> =>
    ipcRenderer.invoke("get-git-changelog"),
};
