import { ipcMain, BrowserWindow } from "electron";
import { existsSync } from "fs";
import {
  spsUnfurl,
  spsAssistant,
  spsIngestInbox,
  spsLoad,
  spsSave,
  type PageContext as SpsPageContext,
} from "../sps-agent";
import { spsGetWorkSession, spsSetWorkSession } from "../sps-work-sessions";
import { runTelosAudit, runPipingPattern } from "../telos-auditor";
import {
  oaSearchWorks,
  oaGetWork,
  getResearchConfig,
  getPublicResearchConfig,
  setResearchConfig,
} from "../openalex";
import type { SearchOpts } from "../../shared/openalex/core";
import {
  hasMcpServer,
  openAlexMcpServerPath,
  writeMcpServerEntry,
} from "../installer";
import {
  listBoards as kanbanListBoards,
  currentBoard as kanbanCurrentBoard,
  switchBoard as kanbanSwitchBoard,
  createBoard as kanbanCreateBoard,
  removeBoard as kanbanRemoveBoard,
  listTasks as kanbanListTasks,
  getTask as kanbanGetTask,
  createTask as kanbanCreateTask,
  assignTask as kanbanAssignTask,
  completeTask as kanbanCompleteTask,
  blockTask as kanbanBlockTask,
  unblockTask as kanbanUnblockTask,
  archiveTask as kanbanArchiveTask,
  specifyTask as kanbanSpecifyTask,
  reclaimTask as kanbanReclaimTask,
  commentTask as kanbanCommentTask,
  dispatchOnce as kanbanDispatchOnce,
  listClaw3dHqTasks as kanbanListClaw3dHqTasks,
  type CreateTaskInput,
} from "../kanban";
import { listBaskets, saveBasket, deleteBasket } from "../equity-baskets";
import { listAlerts, markAlertRead } from "../equity-alerts";
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
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
  searchSkills,
  createSkill,
  writeSkillContent,
  listDisabledSkills,
  setSkillEnabled,
  discoverLocalSkills,
  importLocalSkill,
  generateSkillFromRepo,
  type CreateSkillInput,
} from "../skills";
import {
  syncDiskSkillsToDb,
  lookupLocalSkill,
  registerLocalSkill,
  scaffoldNewSkill,
  testSkillRun,
  type SkillEntry,
} from "../skills-registry";
import {
  listSessions,
  getSessionMessages,
  searchSessions,
  deleteSession,
} from "../sessions";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
} from "../session-cache";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
  writeMemory,
} from "../memory";
import { getMemoryTimeline } from "../memory-timeline";
import {
  readFocus,
  writeFocus,
  getDailyContextHookStatus,
  setDailyContextHookEnabled,
} from "../personalization";
import { readSoul, writeSoul, resetSoul } from "../soul";
import { getToolsets, setToolsetEnabled } from "../tools";
import { getConnectionConfig, type SshConnectionConfig } from "../config";
import {
  sshListInstalledSkills,
  sshGetSkillContent,
  sshInstallSkill,
  sshUninstallSkill,
  sshListBundledSkills,
  sshListSessions,
  sshGetSessionMessages,
  sshSearchSessions,
  sshListCachedSessions,
  sshReadMemory,
  sshAddMemoryEntry,
  sshUpdateMemoryEntry,
  sshRemoveMemoryEntry,
  sshWriteUserProfile,
  sshReadSoul,
  sshWriteSoul,
  sshResetSoul,
  sshGetToolsets,
  sshSetToolsetEnabled,
} from "../ssh-remote";

function requireLocalWorkspace(): void {
  const conn = getConnectionConfig();
  if (conn.mode !== "local") {
    throw new Error(
      "Workspace files are only available in local mode in this version.",
    );
  }
}

function registerDualHandler<Args extends unknown[], RetLocal, RetSsh>(
  channel: string,
  localFn: (...args: Args) => Promise<RetLocal> | RetLocal,
  sshFn: (
    ssh: SshConnectionConfig,
    ...args: Args
  ) => Promise<RetSsh> | RetSsh,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      return sshFn(conn.ssh, ...(args as Args));
    }
    return localFn(...(args as Args));
  });
}

export function registerWorkspaceIpc(_mainWindowGetter: () => BrowserWindow | null): void {
  // Kanban
  ipcMain.handle(
    "kanban-list-boards",
    (_event, includeArchived?: boolean, profile?: string) =>
      kanbanListBoards(includeArchived, profile),
  );
  ipcMain.handle("kanban-current-board", (_event, profile?: string) =>
    kanbanCurrentBoard(profile),
  );
  ipcMain.handle(
    "kanban-switch-board",
    (_event, slug: string, profile?: string) =>
      kanbanSwitchBoard(slug, profile),
  );
  ipcMain.handle(
    "kanban-create-board",
    (
      _event,
      slug: string,
      name?: string,
      switchAfter?: boolean,
      profile?: string,
    ) => kanbanCreateBoard(slug, name, switchAfter, profile),
  );
  ipcMain.handle(
    "kanban-remove-board",
    (_event, slug: string, hardDelete?: boolean, profile?: string) =>
      kanbanRemoveBoard(slug, hardDelete, profile),
  );
  ipcMain.handle(
    "kanban-list-tasks",
    (
      _event,
      filters?: {
        status?: string;
        assignee?: string;
        tenant?: string;
        includeArchived?: boolean;
        profile?: string;
      },
    ) => kanbanListTasks(filters || {}),
  );
  ipcMain.handle(
    "kanban-get-task",
    (_event, taskId: string, profile?: string) =>
      kanbanGetTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-create-task",
    (_event, input: CreateTaskInput, profile?: string) =>
      kanbanCreateTask(input, profile),
  );
  ipcMain.handle(
    "kanban-assign-task",
    (_event, taskId: string, assignee: string | null, profile?: string) =>
      kanbanAssignTask(taskId, assignee, profile),
  );
  ipcMain.handle(
    "kanban-complete-task",
    (_event, taskId: string, result?: string, profile?: string) =>
      kanbanCompleteTask(taskId, result, profile),
  );
  ipcMain.handle(
    "kanban-block-task",
    (_event, taskId: string, reason?: string, profile?: string) =>
      kanbanBlockTask(taskId, reason, profile),
  );
  ipcMain.handle(
    "kanban-unblock-task",
    (_event, taskId: string, profile?: string) =>
      kanbanUnblockTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-archive-task",
    (_event, taskId: string, profile?: string) =>
      kanbanArchiveTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-specify-task",
    (_event, taskId: string, profile?: string) =>
      kanbanSpecifyTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-reclaim-task",
    (_event, taskId: string, reason?: string, profile?: string) =>
      kanbanReclaimTask(taskId, reason, profile),
  );
  ipcMain.handle(
    "kanban-comment-task",
    (_event, taskId: string, body: string, profile?: string) =>
      kanbanCommentTask(taskId, body, profile),
  );
  ipcMain.handle(
    "kanban-dispatch-once",
    (_event, dryRun?: boolean, profile?: string) =>
      kanbanDispatchOnce(dryRun, profile),
  );
  ipcMain.handle("kanban-list-claw3d-hq-tasks", () =>
    kanbanListClaw3dHqTasks(),
  );

  // Equity baskets & alerts
  ipcMain.handle("equity-list-baskets", (_event, profile?: string) =>
    listBaskets(profile),
  );
  ipcMain.handle(
    "equity-save-basket",
    (_event, basket: unknown, profile?: string) => saveBasket(basket, profile),
  );
  ipcMain.handle(
    "equity-delete-basket",
    (_event, basketId: string, profile?: string) =>
      deleteBasket(basketId, profile),
  );
  ipcMain.handle(
    "equity-list-alerts",
    (_event, limit?: number, profile?: string) => listAlerts(limit, profile),
  );
  ipcMain.handle(
    "equity-mark-alert-read",
    (_event, alertId: string, profile?: string) =>
      markAlertRead(alertId, profile),
  );

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

  // Skills
  registerDualHandler("list-installed-skills", listInstalledSkills, sshListInstalledSkills);
  registerDualHandler("list-bundled-skills", listBundledSkills, sshListBundledSkills);
  registerDualHandler("get-skill-content", getSkillContent, sshGetSkillContent);
  registerDualHandler("install-skill", installSkill, sshInstallSkill);
  registerDualHandler("uninstall-skill", uninstallSkill, sshUninstallSkill);

  ipcMain.handle("search-skills", (_event, query: string) => {
    requireLocalWorkspace();
    return searchSkills(query);
  });
  ipcMain.handle("create-skill", (_event, input: CreateSkillInput) => {
    requireLocalWorkspace();
    return createSkill(input);
  });
  ipcMain.handle(
    "write-skill-content",
    (_event, skillPath: string, content: string, profile?: string) => {
      requireLocalWorkspace();
      return writeSkillContent(skillPath, content, profile);
    },
  );
  ipcMain.handle("list-disabled-skills", (_event, profile?: string) => {
    requireLocalWorkspace();
    return listDisabledSkills(profile);
  });
  ipcMain.handle(
    "set-skill-enabled",
    (_event, skillPath: string, enabled: boolean, profile?: string) => {
      requireLocalWorkspace();
      return setSkillEnabled(skillPath, enabled, profile);
    },
  );
  ipcMain.handle("discover-local-skills", (_event, profile?: string) => {
    requireLocalWorkspace();
    return discoverLocalSkills(profile);
  });
  ipcMain.handle(
    "import-local-skill",
    (_event, sourcePath: string, category?: string, profile?: string) => {
      requireLocalWorkspace();
      return importLocalSkill(sourcePath, category, profile);
    },
  );
  ipcMain.handle(
    "generate-skill-from-repo",
    (_event, repoPath: string, profile?: string) => {
      requireLocalWorkspace();
      return generateSkillFromRepo(repoPath, profile);
    },
  );

  // Skills Registry
  ipcMain.handle("skills-registry-sync", async (_event, profile?: string) => {
    return syncDiskSkillsToDb(profile);
  });
  ipcMain.handle(
    "skills-registry-lookup",
    async (_event, query: string, profile?: string) => {
      return lookupLocalSkill(query, profile);
    },
  );
  ipcMain.handle(
    "skills-registry-register",
    async (
      _event,
      skill: Omit<SkillEntry, "id" | "created_at">,
      profile?: string,
    ) => {
      return registerLocalSkill(skill, profile);
    },
  );
  ipcMain.handle(
    "skills-registry-scaffold",
    async (
      _event,
      name: string,
      description: string,
      code: string,
      deps: string[],
      profile?: string,
    ) => {
      return scaffoldNewSkill(name, description, code, deps, profile);
    },
  );
  ipcMain.handle(
    "skills-registry-test",
    async (_event, name: string, args?: string, profile?: string) => {
      return testSkillRun(name, args, profile);
    },
  );

  // Sessions
  registerDualHandler("list-sessions", listSessions, sshListSessions);
  registerDualHandler("get-session-messages", getSessionMessages, sshGetSessionMessages);
  ipcMain.handle("delete-session", (_event, sessionId: string) => {
    return deleteSession(sessionId);
  });
  ipcMain.handle("search-sessions", (_event, query: string, limit?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshSearchSessions(conn.ssh, query, limit);
    return searchSessions(query, limit);
  });

  // Cached Sessions
  ipcMain.handle(
    "list-cached-sessions",
    (_event, limit?: number, offset?: number) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshListCachedSessions(conn.ssh, limit, offset);
      return listCachedSessions(limit, offset);
    },
  );
  ipcMain.handle("sync-session-cache", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshListCachedSessions(conn.ssh, 50);
    try {
      return syncSessionCache();
    } catch (error) {
      console.error("sync-session-cache failed; using local cache", error);
      return listCachedSessions(50);
    }
  });
  ipcMain.handle(
    "update-session-title",
    (_event, sessionId: string, title: string) =>
      updateSessionTitle(sessionId, title),
  );

  // Memory
  registerDualHandler("read-memory", readMemory, sshReadMemory);
  ipcMain.handle("get-memory-timeline", (_event, profile?: string) =>
    getMemoryTimeline(profile),
  );
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshAddMemoryEntry(conn.ssh, content, profile);
      return addMemoryEntry(content, profile);
    },
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUpdateMemoryEntry(conn.ssh, index, content, profile);
      return updateMemoryEntry(index, content, profile);
    },
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshRemoveMemoryEntry(conn.ssh, index, profile);
      return removeMemoryEntry(index, profile);
    },
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshWriteUserProfile(conn.ssh, content, profile);
      return writeUserProfile(content, profile);
    },
  );
  ipcMain.handle(
    "write-memory",
    (_event, content: string, profile?: string) => {
      if (getConnectionConfig().mode === "ssh")
        return {
          success: false,
          error: "Editing memory isn't available over SSH yet.",
        };
      return writeMemory(content, profile);
    },
  );
  ipcMain.handle("read-focus", () => {
    if (getConnectionConfig().mode === "ssh") return "";
    return readFocus();
  });
  ipcMain.handle("write-focus", (_event, content: string) => {
    if (getConnectionConfig().mode === "ssh")
      return {
        success: false,
        error: "Editing focus isn't available over SSH yet.",
      };
    return writeFocus(content);
  });
  ipcMain.handle(
    "get-daily-context-hook-status",
    (_event, profile?: string) => {
      if (getConnectionConfig().mode === "ssh")
        return {
          configured: false,
          allowlisted: false,
          scriptExists: false,
          enabled: false,
        };
      return getDailyContextHookStatus(profile);
    },
  );
  ipcMain.handle(
    "set-daily-context-hook-enabled",
    (_event, enabled: boolean, profile?: string) => {
      if (getConnectionConfig().mode === "ssh")
        return {
          success: false,
          error: "The daily-context hook isn't available over SSH yet.",
        };
      return setDailyContextHookEnabled(enabled, profile);
    },
  );

  // Soul
  ipcMain.handle("read-soul", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshReadSoul(conn.ssh, profile);
    return readSoul(profile);
  });
  ipcMain.handle("write-soul", (_event, content: string, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshWriteSoul(conn.ssh, content, profile);
    return writeSoul(content, profile);
  });
  ipcMain.handle("reset-soul", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshResetSoul(conn.ssh, profile);
    return resetSoul(profile);
  });

  // Tools
  ipcMain.handle("get-toolsets", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetToolsets(conn.ssh, profile);
    return getToolsets(profile);
  });
  ipcMain.handle(
    "set-toolset-enabled",
    (_event, key: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshSetToolsetEnabled(conn.ssh, key, enabled, profile);
      return setToolsetEnabled(key, enabled, profile);
    },
  );

  // SPS Agent workspace (unfurl / assistant / persistence)
  ipcMain.handle("sps-unfurl", (_event, url: string) => spsUnfurl(url));
  ipcMain.handle(
    "sps-assistant",
    (
      _event,
      prompt: string,
      ctx: SpsPageContext,
      profile?: string,
      groundInWorkspace?: boolean,
    ) => spsAssistant(prompt, ctx, profile, groundInWorkspace),
  );
  ipcMain.handle("sps-ingest-inbox", (_event, profile?: string) =>
    spsIngestInbox(profile),
  );
  ipcMain.handle("sps-load", (_event, profile?: string) => spsLoad(profile));
  ipcMain.handle("sps-save", (_event, ws: unknown, profile?: string) =>
    spsSave(ws, profile),
  );
  ipcMain.handle("sps-run-telos-audit", (_event, profile?: string) =>
    runTelosAudit(profile),
  );
  ipcMain.handle(
    "sps-run-piping",
    (_event, text: string, pattern: string, profile?: string) =>
      runPipingPattern(text, pattern, profile),
  );

  // Resumable /work session map
  ipcMain.handle(
    "sps-get-work-session",
    (_event, pageId: string, profile?: string) =>
      spsGetWorkSession(pageId, profile),
  );
  ipcMain.handle(
    "sps-set-work-session",
    (_event, pageId: string, sessionId: string, profile?: string) =>
      spsSetWorkSession(pageId, sessionId, profile),
  );

  // Research (OpenAlex)
  ipcMain.handle(
    "sps-research-search-works",
    (_event, q: string, opts?: SearchOpts, profile?: string) =>
      oaSearchWorks(q, opts ?? {}, profile),
  );
  ipcMain.handle(
    "sps-research-get-work",
    (_event, id: string, profile?: string) => oaGetWork(id, profile),
  );
  ipcMain.handle("sps-research-get-config", () => getPublicResearchConfig());
  ipcMain.handle(
    "sps-research-set-config",
    (_event, mailto: string, apiKey?: string) => {
      setResearchConfig(mailto, apiKey);
      return getPublicResearchConfig();
    },
  );
  ipcMain.handle("sps-research-ensure-agent-tool", (_event, profile?: string) =>
    ensureResearchMcpRegistered(profile),
  );
}

function ensureResearchMcpRegistered(profile?: string): {
  registered: boolean;
  alreadyPresent: boolean;
} {
  const name = "openalex";
  if (hasMcpServer(name, profile)) {
    return { registered: true, alreadyPresent: true };
  }
  const serverPath = openAlexMcpServerPath();
  if (!existsSync(serverPath)) {
    return { registered: false, alreadyPresent: false };
  }
  const { mailto, apiKey } = getResearchConfig();
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
  if (mailto) env.HERMES_OPENALEX_MAILTO = mailto;
  if (apiKey) env.HERMES_OPENALEX_API_KEY = apiKey;
  writeMcpServerEntry(
    name,
    { command: process.execPath, args: [serverPath], env, enabled: true },
    profile,
  );
  return { registered: true, alreadyPresent: false };
}
