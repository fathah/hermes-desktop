import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  screen,
  session,
} from "electron";

import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { AppUpdater } from "electron-updater";

import icon from "../../resources/icon.png?asset";
import {
  checkInstallStatus,
  runInstall,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  runHermesUpdate,
  checkOpenClawExists,
  runClawMigrate,
  runHermesBackup,
  runHermesImport,
  runHermesDump,
  listMcpServers,
  discoverMemoryProviders,
  readLogs,
  InstallProgress,
} from "./installer";
import {
  sendMessage,
  startGateway,
  stopGateway,
  isGatewayRunning,
  isRemoteMode,
  testRemoteConnection,
  stopHealthPolling,
  restartGateway,
} from "./hermes";
import {
  getClaw3dStatus,
  setupClaw3d,
  startDevServer,
  stopDevServer,
  startAdapter,
  stopAdapter,
  startAll as startClaw3dAll,
  stopAll as stopClaw3d,
  getClaw3dLogs,
  setClaw3dPort,
  getClaw3dPort,
  setClaw3dWsUrl,
  getClaw3dWsUrl,
  Claw3dSetupProgress,
} from "./claw3d";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getCredentialPool,
  setCredentialPool,
  getConnectionConfig,
  setConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
} from "./config";
import {
  actOnHccOpportunity,
  approveHccOpportunityIntervention,
  appendHccLearningEvent,
  compareHccClonedApp,
  createHccClonedApp,
  finalizeHccCloneLearning,
  linkHccCloneProject,
  recordHccCloneTaste,
  recordHccOpportunityOutcome,
  rollbackHccProjectGenome,
  stageHccOpportunityIntervention,
  stageHccProjectGenomeProposal,
  createHccLearningTopic,
  createHccTimeBlock,
  cancelHccTimeBlock,
  decideHccTradeoff,
  stageHccRecoveryAction,
  decideHccInlineApproval,
  materializeHccClonedApp,
  promoteHccLearningRecommendation,
  createHccGraphEdge,
  createHccRegistryEntity,
  deleteHccGraphEdge,
  deleteHccRegistryEntity,
  fetchHccClonedApps,
  fetchHccConductorJobs,
  fetchHccContextInspector,
  fetchHccInlineApprovals,
  fetchHccMissionCostAttribution,
  fetchHccMissionEvidencePack,
  fetchHccRunComparison,
  fetchHccRuns,
  fetchHccSwarmOverview,
  fetchHccDomainDetail,
  fetchHccDomains,
  fetchHccGraph,
  fetchHccGatewayCapabilityMap,
  fetchHccIntelligence,
  fetchHccExecutors,
  fetchHccExecutions,
  createHccExecution,
  decideHccExecution,
  executeHccRecommendation,
  refreshHccExecution,
  retryHccExecution,
  rollbackHccExecution,
  decideHccRetrievalQualityProposal,
  stageHccRetrievalPolicyExecution,
  applyHccRetrievalPolicyExecution,
  verifyHccRetrievalPolicyExecution,
  rollbackHccRetrievalPolicyExecution,
  fetchHccMemoryCapsules,
  fetchHccMemoryPacket,
  fetchHccOpportunities,
  fetchHccLearning,
  decideHccProjectGenomeProposal,
  fetchHccProjectDetail,
  fetchHccProjectGenome,
  fetchHccProjects,
  fetchHccRegistryResource,
  fetchHccReality,
  fetchHccReviewCenter,
  fetchHccGovernanceProposals,
  actOnHccGovernanceProposal,
  stageHccReviewIntervention,
  fetchHccLifeDomainSummary,
  fetchHccWarRoomSummary,
  repairHccGraphIntegrity,
  spawnHccConductor,
  stageHccIntervention,
  stopHccConductor,
  syncHccGraph,
  transitionHccProject,
  updateHccGraphEdge,
  updateHccOperatingProfile,
  updateHccRegistryEntity,
  type HccRegistryResource,
} from "./hcc";
import { listSessions, getSessionMessages, searchSessions } from "./sessions";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
} from "./session-cache";
import { listModels, addModel, removeModel, updateModel } from "./models";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
} from "./profiles";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
} from "./memory";
import { readSoul, writeSoul, resetSoul } from "./soul";
import { getToolsets, setToolsetEnabled } from "./tools";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
} from "./skills";
import {
  listCronJobs,
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "./cronjobs";
import { getAppLocale, setAppLocale } from "./locale";

process.on("uncaughtException", (err) => {
  console.error("[MAIN UNCAUGHT]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MAIN UNHANDLED REJECTION]", reason);
});

let mainWindow: BrowserWindow | null = null;
let currentChatAbort: (() => void) | null = null;

const SNAP_THRESHOLD = 28;
const SNAP_MARGIN = 10;

function applySnapToEdge(window: BrowserWindow): void {
  if (window.isMaximized() || window.isMinimized()) return;

  const display = screen.getDisplayMatching(window.getBounds());
  const workArea = display.workArea;
  const bounds = window.getBounds();
  let nextX = bounds.x;
  let nextY = bounds.y;
  let changed = false;

  if (Math.abs(bounds.x - workArea.x) <= SNAP_THRESHOLD) {
    nextX = workArea.x + SNAP_MARGIN;
    changed = true;
  } else if (Math.abs(bounds.x + bounds.width - (workArea.x + workArea.width)) <= SNAP_THRESHOLD) {
    nextX = workArea.x + workArea.width - bounds.width - SNAP_MARGIN;
    changed = true;
  }

  if (Math.abs(bounds.y - workArea.y) <= SNAP_THRESHOLD) {
    nextY = workArea.y + SNAP_MARGIN;
    changed = true;
  } else if (Math.abs(bounds.y + bounds.height - (workArea.y + workArea.height)) <= SNAP_THRESHOLD) {
    nextY = workArea.y + workArea.height - bounds.height - SNAP_MARGIN;
    changed = true;
  }

  if (changed) {
    window.setBounds({ ...bounds, x: nextX, y: nextY });
  }
}

function createWindow(): void {
  if (is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders ?? {};
      headers["Content-Security-Policy"] = [
        "default-src 'self' data: file: http://localhost:5173 ws://localhost:5173; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; style-src 'self' 'unsafe-inline' http://localhost:5173; img-src 'self' data: blob: http://localhost:5173; font-src 'self' data: http://localhost:5173; connect-src 'self' data: blob: http://localhost:5173 ws://localhost:5173 http://127.0.0.1:9200 http://localhost:9200; worker-src 'self' blob:;"
      ];
      callback({ responseHeaders: headers });
    });
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show();
    mainWindow!.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("boot-sequence");
    });
  });

  mainWindow.on("move", () => {
    if (mainWindow) {
      applySnapToEdge(mainWindow);
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[CRASH] Renderer process gone:",
      details.reason,
      details.exitCode,
    );
  });

  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(`[RENDERER ERROR] ${message} (${sourceId}:${line})`);
      }
    },
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error("[LOAD FAIL]", errorCode, errorDescription);
    },
  );

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function setupIPC(): void {
  // Installation
  ipcMain.handle("check-install", () => {
    return checkInstallStatus();
  });

  ipcMain.handle("start-install", async (event) => {
    try {
      await runInstall((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Hermes engine info
  ipcMain.handle("get-hermes-version", async () => getHermesVersion());
  ipcMain.handle("refresh-hermes-version", async () => {
    clearVersionCache();
    return getHermesVersion();
  });
  ipcMain.handle("run-hermes-doctor", () => runHermesDoctor());
  ipcMain.handle("run-hermes-update", async (event) => {
    try {
      await runHermesUpdate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // OpenClaw migration
  ipcMain.handle("check-openclaw", () => checkOpenClawExists());
  ipcMain.handle("run-claw-migrate", async (event) => {
    try {
      await runClawMigrate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Configuration (profile-aware)
  ipcMain.handle("get-locale", () => getAppLocale());
  ipcMain.handle("set-locale", (_event, locale: "en" | "zh-CN") =>
    setAppLocale(locale),
  );

  ipcMain.handle("get-env", (_event, profile?: string) => readEnv(profile));

  ipcMain.handle(
    "set-env",
    (_event, key: string, value: string, profile?: string) => {
      setEnvValue(key, value, profile);
      // Restart gateway so it picks up the new API key
      if (
        (isGatewayRunning() && key.endsWith("_API_KEY")) ||
        key.endsWith("_TOKEN") ||
        key === "HF_TOKEN"
      ) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle("get-config", (_event, key: string, profile?: string) =>
    getConfigValue(key, profile),
  );

  ipcMain.handle(
    "set-config",
    (_event, key: string, value: string, profile?: string) => {
      setConfigValue(key, value, profile);
      return true;
    },
  );

  ipcMain.handle("get-hermes-home", (_event, profile?: string) =>
    getHermesHome(profile),
  );

  ipcMain.handle("get-model-config", (_event, profile?: string) =>
    getModelConfig(profile),
  );

  ipcMain.handle(
    "set-model-config",
    (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const prev = getModelConfig(profile);
      setModelConfig(provider, model, baseUrl, profile);

      // Restart gateway when provider, model, or endpoint changes so it picks up new config
      if (
        isGatewayRunning() &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        restartGateway(profile);
      }

      return true;
    },
  );

  // Connection mode (local vs remote)
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("get-connection-config", () => getConnectionConfig());

  ipcMain.handle(
    "set-connection-config",
    (
      _event,
      mode: "local" | "remote",
      remoteUrl: string,
      apiKey?: string,
    ) => {
      setConnectionConfig({ mode, remoteUrl, apiKey: apiKey || "" });
      return true;
    },
  );

  ipcMain.handle(
    "test-remote-connection",
    (_event, url: string, apiKey?: string) =>
      testRemoteConnection(url, apiKey),
  );

  // Chat — lazy-start gateway on first message
  ipcMain.handle(
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
    ) => {
      if (!isRemoteMode() && !isGatewayRunning()) {
        startGateway(profile);
      }

      if (currentChatAbort) {
        currentChatAbort();
      }

      let fullResponse = "";
      const chatStartTime = Date.now();
      let resolveChat: (v: { response: string; sessionId?: string }) => void;
      let rejectChat: (reason?: unknown) => void;
      const promise = new Promise<{ response: string; sessionId?: string }>(
        (res, rej) => {
          resolveChat = res;
          rejectChat = rej;
        },
      );

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
            fullResponse += chunk;
            event.sender.send("chat-chunk", chunk);
          },
          onDone: (sessionId) => {
            currentChatAbort = null;
            event.sender.send("chat-done", sessionId || "");
            resolveChat({ response: fullResponse, sessionId });
            // Desktop notification when window is not focused and response took >10s
            if (
              mainWindow &&
              !mainWindow.isFocused() &&
              Date.now() - chatStartTime > 10000
            ) {
              const preview = fullResponse
                .replace(/[#*_`~\n]+/g, " ")
                .trim()
                .slice(0, 80);
              new Notification({
                title: "Hermes Agent",
                body: preview || "Response ready",
              }).show();
            }
          },
          onError: (error) => {
            currentChatAbort = null;
            event.sender.send("chat-error", error);
            rejectChat(new Error(error));
            // Notify on error too if window not focused
            if (mainWindow && !mainWindow.isFocused()) {
              new Notification({
                title: "Hermes Agent — Error",
                body: error.slice(0, 100),
              }).show();
            }
          },
          onToolProgress: (tool) => {
            event.sender.send("chat-tool-progress", tool);
          },
          onUsage: (usage) => {
            event.sender.send("chat-usage", usage);
          },
        },
        profile,
        resumeSessionId,
        history,
      );

      currentChatAbort = handle.abort;
      return promise;
    },
  );

  ipcMain.handle("abort-chat", () => {
    if (currentChatAbort) {
      currentChatAbort();
      currentChatAbort = null;
    }
  });

  // Gateway
  ipcMain.handle("start-gateway", () => startGateway());
  ipcMain.handle("stop-gateway", () => {
    stopGateway(true);
    return true;
  });
  ipcMain.handle("gateway-status", () => isGatewayRunning());
  ipcMain.handle("get-hcc-gateway-capability-map", () => fetchHccGatewayCapabilityMap());
  ipcMain.handle("get-hcc-intelligence", (_event, contextPackId?: string, tokenBudget?: number) => fetchHccIntelligence(contextPackId, tokenBudget));
  ipcMain.handle("execute-hcc-recommendation", (_event, label: string, action: Record<string, unknown>, actor?: string) => executeHccRecommendation(label, action, actor));
  ipcMain.handle("get-hcc-executors", () => fetchHccExecutors());
  ipcMain.handle("get-hcc-executions", (_event, status?: string, limit?: number) => fetchHccExecutions(status, limit));
  ipcMain.handle("create-hcc-execution", (_event, payload: Record<string, unknown>) => createHccExecution(payload));
  ipcMain.handle("decide-hcc-execution", (_event, executionId: string, decision: "approve" | "deny", actor?: string, note?: string) => decideHccExecution(executionId, decision, actor, note));
  ipcMain.handle("refresh-hcc-execution", (_event, executionId: string, actor?: string) => refreshHccExecution(executionId, actor));
  ipcMain.handle("retry-hcc-execution", (_event, executionId: string, actor?: string) => retryHccExecution(executionId, actor));
  ipcMain.handle("rollback-hcc-execution", (_event, executionId: string, actor?: string, note?: string) => rollbackHccExecution(executionId, actor, note));
  ipcMain.handle("decide-hcc-retrieval-quality-proposal", (_event, proposalId: string, decision: "approved" | "rejected", actor?: string, note?: string) => decideHccRetrievalQualityProposal(proposalId, decision, actor, note));
  ipcMain.handle("stage-hcc-retrieval-policy-execution", (_event, proposalId: string, actor?: string) => stageHccRetrievalPolicyExecution(proposalId, actor));
  ipcMain.handle("apply-hcc-retrieval-policy-execution", (_event, executionId: string, actor?: string, note?: string) => applyHccRetrievalPolicyExecution(executionId, actor, note));
  ipcMain.handle("verify-hcc-retrieval-policy-execution", (_event, executionId: string, actor?: string) => verifyHccRetrievalPolicyExecution(executionId, actor));
  ipcMain.handle("rollback-hcc-retrieval-policy-execution", (_event, executionId: string, actor?: string, note?: string) => rollbackHccRetrievalPolicyExecution(executionId, actor, note));
  ipcMain.handle("get-hcc-war-room-summary", () => fetchHccWarRoomSummary());
  ipcMain.handle("get-hcc-reality", () => fetchHccReality());
  ipcMain.handle("update-hcc-operating-profile", (_event, payload: unknown) => updateHccOperatingProfile(payload));
  ipcMain.handle("create-hcc-time-block", (_event, payload: Record<string, unknown>) => createHccTimeBlock(payload));
  ipcMain.handle("cancel-hcc-time-block", (_event, blockId: string) => cancelHccTimeBlock(blockId));
  ipcMain.handle("decide-hcc-tradeoff", (_event, conflictId: string, optionId: string, rationale: string) => decideHccTradeoff(conflictId, optionId, rationale));
  ipcMain.handle("stage-hcc-recovery-action", (_event, actionId: string) => stageHccRecoveryAction(actionId));
  ipcMain.handle("stage-hcc-intervention", (_event, interventionId: string, actor?: string) =>
    stageHccIntervention(interventionId, actor),
  );
  ipcMain.handle("get-hcc-projects", () => fetchHccProjects());
  ipcMain.handle("get-hcc-project-detail", (_event, projectId: string) => fetchHccProjectDetail(projectId));
  ipcMain.handle("get-hcc-project-genome", (_event, projectId: string) => fetchHccProjectGenome(projectId));
  ipcMain.handle("stage-hcc-project-genome-proposal", (_event, projectId: string, payload: Record<string, unknown>) => stageHccProjectGenomeProposal(projectId, payload));
  ipcMain.handle("decide-hcc-project-genome-proposal", (_event, projectId: string, proposalId: string, decision: "approve" | "reject", note?: string) => decideHccProjectGenomeProposal(projectId, proposalId, decision, note));
  ipcMain.handle("rollback-hcc-project-genome", (_event, projectId: string, targetVersion: number, rationale: string) => rollbackHccProjectGenome(projectId, targetVersion, rationale));
  ipcMain.handle("transition-hcc-project", (_event, projectId: string, toStatus: string, note?: string) =>
    transitionHccProject(projectId, toStatus, note),
  );
  ipcMain.handle("get-hcc-cloned-apps", () => fetchHccClonedApps());
  ipcMain.handle("create-hcc-cloned-app", (_event, payload: Record<string, unknown>) => createHccClonedApp(payload));
  ipcMain.handle("compare-hcc-cloned-app", (_event, appId: string, payload: Record<string, unknown>) => compareHccClonedApp(appId, payload));
  ipcMain.handle("materialize-hcc-cloned-app", (_event, appId: string) => materializeHccClonedApp(appId));
  ipcMain.handle("record-hcc-clone-taste", (_event, appId: string, signals: Array<Record<string, unknown>>) => recordHccCloneTaste(appId, signals));
  ipcMain.handle("link-hcc-clone-project", (_event, appId: string, payload: Record<string, unknown>) => linkHccCloneProject(appId, payload));
  ipcMain.handle("finalize-hcc-clone-learning", (_event, appId: string) => finalizeHccCloneLearning(appId));
  ipcMain.handle("get-hcc-domains", () => fetchHccDomains());
  ipcMain.handle("get-hcc-life-domain-summary", () => fetchHccLifeDomainSummary());
  ipcMain.handle("get-hcc-domain-detail", (_event, domainId: string) => fetchHccDomainDetail(domainId));
  ipcMain.handle("get-hcc-memory-capsules", () => fetchHccMemoryCapsules());
  ipcMain.handle("get-hcc-memory-packet", (_event, packetType: string) => fetchHccMemoryPacket(packetType));
  ipcMain.handle("get-hcc-review-center", () => fetchHccReviewCenter());
  ipcMain.handle("get-hcc-opportunities", (_event, includeDismissed?: boolean) =>
    fetchHccOpportunities(Boolean(includeDismissed)),
  );
  ipcMain.handle(
    "act-hcc-opportunity",
    (_event, candidateId: string, action: "capture" | "dismiss" | "defer" | "promote", rationale?: string) =>
      actOnHccOpportunity(candidateId, action, rationale),
  );
  ipcMain.handle(
    "stage-hcc-opportunity-intervention",
    (_event, candidateId: string, mode: "convert_project" | "create_tasks" | "stage_execution", rationale?: string, payload?: Record<string, unknown>) =>
      stageHccOpportunityIntervention(candidateId, mode, rationale, payload),
  );
  ipcMain.handle("approve-hcc-opportunity-intervention", (_event, interventionId: string) =>
    approveHccOpportunityIntervention(interventionId),
  );
  ipcMain.handle(
    "record-hcc-opportunity-outcome",
    (_event, interventionId: string, status: "positive" | "neutral" | "negative", metrics: Record<string, unknown>, evidence: Record<string, unknown>) =>
      recordHccOpportunityOutcome(interventionId, status, metrics, evidence),
  );
  ipcMain.handle("get-hcc-learning", () => fetchHccLearning());
  ipcMain.handle("get-hcc-conductor-jobs", () => fetchHccConductorJobs());
  ipcMain.handle("spawn-hcc-conductor", (_event, goal: string, maxParallel?: number, supervised?: boolean) =>
    spawnHccConductor(goal, maxParallel, supervised),
  );
  ipcMain.handle("stop-hcc-conductor", (_event, taskId: string) => stopHccConductor(taskId));
  ipcMain.handle("get-hcc-mission-evidence-pack", (_event, jobId: string) => fetchHccMissionEvidencePack(jobId));
  ipcMain.handle("get-hcc-inline-approvals", (_event, jobId: string) => fetchHccInlineApprovals(jobId));
  ipcMain.handle("get-hcc-mission-cost-attribution", (_event, jobId: string) => fetchHccMissionCostAttribution(jobId));
  ipcMain.handle("decide-hcc-inline-approval", (_event, jobId: string, approvalDomain: string, approvalId: string, decision: "approve" | "reject", actor?: string, note?: string) =>
    decideHccInlineApproval(jobId, approvalDomain, approvalId, decision, actor, note),
  );
  ipcMain.handle("get-hcc-context-inspector", (_event, entityType: string, entityId: string) =>
    fetchHccContextInspector(entityType, entityId),
  );
  ipcMain.handle("get-hcc-runs", () => fetchHccRuns());
  ipcMain.handle("get-hcc-run-comparison", (_event, leftRunId: string, rightRunId: string) =>
    fetchHccRunComparison(leftRunId, rightRunId),
  );
  ipcMain.handle("get-hcc-swarm-overview", () => fetchHccSwarmOverview());
  ipcMain.handle("create-hcc-learning-topic", (_event, payload: Record<string, unknown>) =>
    createHccLearningTopic(payload),
  );
  ipcMain.handle(
    "append-hcc-learning-event",
    (_event, topicId: string, eventType: string, payload: Record<string, unknown>) =>
      appendHccLearningEvent(topicId, eventType, payload),
  );
  ipcMain.handle("promote-hcc-learning-recommendation", (_event, recommendationId: string) =>
    promoteHccLearningRecommendation(recommendationId),
  );
  ipcMain.handle("get-hcc-governance-proposals", (_event, status?: string) => fetchHccGovernanceProposals(status));
  ipcMain.handle("act-hcc-governance-proposal", (_event, proposalId: string, action: "approve" | "apply" | "reject" | "rollback", actor?: string) => actOnHccGovernanceProposal(proposalId, action, actor));
  ipcMain.handle("stage-hcc-review-intervention", (_event, interventionId: string, actor?: string) => stageHccReviewIntervention(interventionId, actor));
  ipcMain.handle("get-hcc-registry-resource", (_event, resource: HccRegistryResource) => fetchHccRegistryResource(resource));
  ipcMain.handle("create-hcc-registry-entity", (_event, resource: HccRegistryResource, payload: unknown) =>
    createHccRegistryEntity(resource, payload),
  );
  ipcMain.handle("update-hcc-registry-entity", (_event, resource: HccRegistryResource, entityId: string, payload: unknown) =>
    updateHccRegistryEntity(resource, entityId, payload),
  );
  ipcMain.handle("delete-hcc-registry-entity", (_event, resource: HccRegistryResource, entityId: string) =>
    deleteHccRegistryEntity(resource, entityId),
  );
  ipcMain.handle("get-hcc-graph", () => fetchHccGraph());
  ipcMain.handle("create-hcc-graph-edge", (_event, payload: unknown) => createHccGraphEdge(payload));
  ipcMain.handle("update-hcc-graph-edge", (_event, edgeId: string, payload: unknown) => updateHccGraphEdge(edgeId, payload));
  ipcMain.handle("delete-hcc-graph-edge", (_event, edgeId: string) => deleteHccGraphEdge(edgeId));
  ipcMain.handle("sync-hcc-graph", () => syncHccGraph());
  ipcMain.handle("repair-hcc-graph-integrity", () => repairHccGraphIntegrity());

  // Platform toggles
  ipcMain.handle("get-platform-enabled", (_event, profile?: string) =>
    getPlatformEnabled(profile),
  );
  ipcMain.handle(
    "set-platform-enabled",
    (_event, platform: string, enabled: boolean, profile?: string) => {
      setPlatformEnabled(platform, enabled, profile);
      if (isGatewayRunning()) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle("snap-window-to-edge", () => {
    if (!mainWindow) return false;
    applySnapToEdge(mainWindow);
    return true;
  });

  // Sessions
  ipcMain.handle("list-sessions", (_event, limit?: number, offset?: number) => {
    return listSessions(limit, offset);
  });

  ipcMain.handle("get-session-messages", (_event, sessionId: string) => {
    return getSessionMessages(sessionId);
  });

  // Profiles
  ipcMain.handle("list-profiles", async () => listProfiles());
  ipcMain.handle("create-profile", (_event, name: string, clone: boolean) =>
    createProfile(name, clone),
  );
  ipcMain.handle("delete-profile", (_event, name: string) =>
    deleteProfile(name),
  );
  ipcMain.handle("set-active-profile", (_event, name: string) => {
    setActiveProfile(name);
    return true;
  });

  // Memory
  ipcMain.handle("read-memory", (_event, profile?: string) =>
    readMemory(profile),
  );
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) =>
      addMemoryEntry(content, profile),
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) =>
      updateMemoryEntry(index, content, profile),
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) =>
      removeMemoryEntry(index, profile),
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) =>
      writeUserProfile(content, profile),
  );

  // Soul
  ipcMain.handle("read-soul", (_event, profile?: string) => readSoul(profile));
  ipcMain.handle("write-soul", (_event, content: string, profile?: string) => {
    return writeSoul(content, profile);
  });
  ipcMain.handle("reset-soul", (_event, profile?: string) =>
    resetSoul(profile),
  );

  // Tools
  ipcMain.handle("get-toolsets", (_event, profile?: string) =>
    getToolsets(profile),
  );
  ipcMain.handle(
    "set-toolset-enabled",
    (_event, key: string, enabled: boolean, profile?: string) => {
      return setToolsetEnabled(key, enabled, profile);
    },
  );

  // Skills
  ipcMain.handle("list-installed-skills", (_event, profile?: string) =>
    listInstalledSkills(profile),
  );
  ipcMain.handle("list-bundled-skills", () => listBundledSkills());
  ipcMain.handle("get-skill-content", (_event, skillPath: string) =>
    getSkillContent(skillPath),
  );
  ipcMain.handle(
    "install-skill",
    (_event, identifier: string, profile?: string) =>
      installSkill(identifier, profile),
  );
  ipcMain.handle("uninstall-skill", (_event, name: string, profile?: string) =>
    uninstallSkill(name, profile),
  );

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    (_event, limit?: number, offset?: number) =>
      listCachedSessions(limit, offset),
  );
  ipcMain.handle("sync-session-cache", () => syncSessionCache());
  ipcMain.handle(
    "update-session-title",
    (_event, sessionId: string, title: string) =>
      updateSessionTitle(sessionId, title),
  );

  // Session search
  ipcMain.handle("search-sessions", (_event, query: string, limit?: number) =>
    searchSessions(query, limit),
  );

  // Credential Pool
  ipcMain.handle("get-credential-pool", () => getCredentialPool());
  ipcMain.handle(
    "set-credential-pool",
    (
      _event,
      provider: string,
      entries: Array<{ key: string; label: string }>,
    ) => {
      setCredentialPool(provider, entries);
      return true;
    },
  );

  // Models
  ipcMain.handle("list-models", () => listModels());
  ipcMain.handle(
    "add-model",
    (_event, name: string, provider: string, model: string, baseUrl: string) =>
      addModel(name, provider, model, baseUrl),
  );
  ipcMain.handle("remove-model", (_event, id: string) => removeModel(id));
  ipcMain.handle(
    "update-model",
    (_event, id: string, fields: Record<string, string>) =>
      updateModel(id, fields),
  );

  // Claw3D
  ipcMain.handle("claw3d-status", () => getClaw3dStatus());

  ipcMain.handle("claw3d-setup", async (event) => {
    try {
      await setupClaw3d((progress: Claw3dSetupProgress) => {
        event.sender.send("claw3d-setup-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("claw3d-get-port", () => getClaw3dPort());
  ipcMain.handle("claw3d-set-port", (_event, port: number) => {
    setClaw3dPort(port);
    return true;
  });
  ipcMain.handle("claw3d-get-ws-url", () => getClaw3dWsUrl());
  ipcMain.handle("claw3d-set-ws-url", (_event, url: string) => {
    setClaw3dWsUrl(url);
    return true;
  });

  ipcMain.handle("claw3d-start-all", () => startClaw3dAll());
  ipcMain.handle("claw3d-stop-all", () => {
    stopClaw3d();
    return true;
  });
  ipcMain.handle("claw3d-get-logs", () => getClaw3dLogs());

  ipcMain.handle("claw3d-start-dev", () => startDevServer());
  ipcMain.handle("claw3d-stop-dev", () => {
    stopDevServer();
    return true;
  });
  ipcMain.handle("claw3d-start-adapter", () => startAdapter());
  ipcMain.handle("claw3d-stop-adapter", () => {
    stopAdapter();
    return true;
  });

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
    ) => createCronJob(schedule, prompt, name, deliver, profile),
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

  // Shell
  ipcMain.handle("open-external", (_event, url: string) => {
    shell.openExternal(url);
  });

  // Backup / Import
  ipcMain.handle("run-hermes-backup", (_event, profile?: string) =>
    runHermesBackup(profile),
  );
  ipcMain.handle(
    "run-hermes-import",
    (_event, archivePath: string, profile?: string) =>
      runHermesImport(archivePath, profile),
  );

  // Debug dump
  ipcMain.handle("run-hermes-dump", () => runHermesDump());

  // MCP servers
  ipcMain.handle("list-mcp-servers", (_event, profile?: string) =>
    listMcpServers(profile),
  );

  // Memory providers
  ipcMain.handle("discover-memory-providers", (_event, profile?: string) =>
    discoverMemoryProviders(profile),
  );

  // Log viewer
  ipcMain.handle("read-logs", (_event, logFile?: string, lines?: number) =>
    readLogs(logFile, lines),
  );
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Chat",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: (): void => {
            mainWindow?.webContents.send("menu-new-chat");
          },
        },
        { type: "separator" },
        {
          label: "Search Sessions",
          accelerator: "CmdOrCtrl+K",
          click: (): void => {
            mainWindow?.webContents.send("menu-search-sessions");
          },
        },
        { type: "separator" },
        {
          label: "Spotlight",
          accelerator: "CmdOrCtrl+P",
          click: (): void => {
            mainWindow?.webContents.send("menu-spotlight");
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(is.dev
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Hermes Agent on GitHub",
          click: (): void => {
            shell.openExternal("https://github.com/fathah/Hermes-Agent");
          },
        },
        {
          label: "Report an Issue",
          click: (): void => {
            shell.openExternal("https://github.com/fathah/Hermes-Agent/issues");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupUpdater(): void {
  // IPC handlers must always be registered to avoid invoke errors
  ipcMain.handle("get-app-version", () => app.getVersion());

  if (!app.isPackaged) {
    // Skip auto-update in dev mode
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // Dynamic import to avoid electron-updater issues in dev mode
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded");
  });

  autoUpdater.on("error", (err) => {
    mainWindow?.webContents.send("update-error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle("download-update", () => {
    autoUpdater.downloadUpdate();
    return true;
  });

  ipcMain.handle("install-update", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

app.whenReady().then(() => {
  app.name = "Hermes";
  electronApp.setAppUserModelId("com.nousresearch.hermes");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  buildMenu();
  setupIPC();
  createWindow();
  setupUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopGateway();
    stopClaw3d();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopHealthPolling();
  if (currentChatAbort) {
    currentChatAbort();
    currentChatAbort = null;
  }
  stopGateway();
  stopClaw3d();
});
