import { ipcRenderer } from "electron";
import type { SkillEntry } from "../../shared/skills";
import type {
  SearchOpts as ResearchSearchOpts,
  WorkSummary as ResearchWorkSummary,
  WorkDetail as ResearchWorkDetail,
} from "../../shared/openalex/core";
import type {
  ScheduledResearchItem,
  ScheduleInput,
} from "../../shared/scheduledResearch";
import type {
  SpsCaptureInput,
  SpsBaseViewConfig,
  SpsBaseProposalInput,
  SpsContextPackInput,
  SpsContextPackResult,
  SpsImportPlan,
  SpsImportResult,
  SpsImportSource,
  SpsPropertyValue,
  SpsSaveResult,
  VaultHealthReport,
  VaultProposal,
  VaultProposalInput,
} from "../../shared/sps-types";
import type {
  FederatedHit,
  FederatedSearchOpts,
} from "../../shared/federated-search";
import type {
  ActiveWorkCreateInput,
  ActiveWorkPatch,
  ActiveWorkRun,
} from "../../shared/active-work";

/** Pending scheduled-research merge, shaped for the renderer (inline changeset
 *  shape mirrors spsFileAnswer's so preload need not import main types). */
export interface SrPendingUpdate {
  id: string;
  scheduleId: string;
  topic: string;
  pageId: string;
  ts: number;
  summary: string;
  changeset: {
    summary: string;
    pages: Array<{
      op: "create" | "update";
      pageId: string;
      title: string;
      markdown: string;
    }>;
    captures: Array<{ id: string; status: "processed" | "discarded" }>;
    memory: string[];
  };
}

export type SrPatch = Partial<{
  cadence: ScheduledResearchItem["cadence"];
  hour: number;
  enabled: boolean;
  autoApply: boolean;
}>;

export interface NotebookLmMcpStatus {
  registered: boolean;
  alreadyPresent: boolean;
  commandFound: boolean;
  command: string;
  args: string[];
  source: "env" | "user-bin" | "path" | "claude-code" | "existing";
  nlmCommand: string | null;
  restarted: boolean;
  message: string;
}

export const spsBridge = {
  // SPS Agent workspace
  spsUnfurl: (
    url: string,
  ): Promise<{
    url: string;
    title: string;
    desc: string;
    favicon?: string;
    image?: string;
  }> => ipcRenderer.invoke("sps-unfurl", url),
  spsAssistant: (
    prompt: string,
    ctx: {
      blocks: { type: string; text: string }[];
      pageTitle: string;
      notes?: string[];
    },
    profile?: string,
    groundInWorkspace?: boolean,
  ): Promise<unknown> =>
    ipcRenderer.invoke(
      "sps-assistant",
      prompt,
      ctx,
      profile,
      groundInWorkspace,
    ),
  spsSourceStudy: (
    focus: string,
    corpusDescription?: string,
    profile?: string,
  ): Promise<unknown> =>
    ipcRenderer.invoke("sps-source-study", focus, corpusDescription, profile),
  spsIngestInbox: (
    profile?: string,
  ): Promise<{
    ok: boolean;
    captureCount: number;
    error?: string;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
  }> => ipcRenderer.invoke("sps-ingest-inbox", profile),
  spsRegisterDeepLinks: (): Promise<boolean> =>
    ipcRenderer.invoke("sps-register-deep-links"),
  spsCapture: (
    input: SpsCaptureInput,
    profile?: string,
  ): Promise<{ success: boolean; id?: string; error?: string }> =>
    ipcRenderer.invoke("sps-capture", input, profile),
  spsFileAnswer: (
    question: string,
    answer: string,
    profile?: string,
  ): Promise<{
    ok: boolean;
    captureCount: number;
    error?: string;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
  }> => ipcRenderer.invoke("sps-file-answer", question, answer, profile),
  spsFileResearch: (
    topic: string,
    researchedMarkdown: string,
    profile?: string,
  ): Promise<{
    ok: boolean;
    captureCount: number;
    error?: string;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
  }> =>
    ipcRenderer.invoke("sps-file-research", topic, researchedMarkdown, profile),
  spsNotebookLmEnsureMcp: (
    profile?: string,
  ): Promise<NotebookLmMcpStatus> =>
    ipcRenderer.invoke("sps-notebooklm-ensure-mcp", profile),
  spsNotebookLmStatus: (profile?: string): Promise<NotebookLmMcpStatus> =>
    ipcRenderer.invoke("sps-notebooklm-status", profile),
  spsAppendWikiLog: (
    op: "ingest" | "file-answer" | "lint" | "research" | "digest",
    summary: string,
    profile?: string,
  ): Promise<void> =>
    ipcRenderer.invoke("sps-wiki-log-append", op, summary, profile),
  spsLintWiki: (
    staleDays?: number,
    profile?: string,
  ): Promise<{
    ok: boolean;
    error?: string;
    findings: Array<{ kind: string; page: string; note: string }>;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
    mechanical: {
      orphans: string[];
      brokenLinks: Array<{ source: string; target: string }>;
      stale: string[];
    };
    pagesScanned: number;
    pagesDropped: number;
  }> => ipcRenderer.invoke("sps-lint-wiki", staleDays, profile),
  spsHealthReport: (
    staleDays?: number,
    profile?: string,
  ): Promise<VaultHealthReport> =>
    ipcRenderer.invoke("sps-health-report", staleDays, profile),
  spsCreateVaultProposal: (
    input: VaultProposalInput,
    profile?: string,
  ): Promise<VaultProposal> =>
    ipcRenderer.invoke("sps-create-vault-proposal", input, profile),
  spsListVaultProposals: (profile?: string): Promise<VaultProposal[]> =>
    ipcRenderer.invoke("sps-list-vault-proposals", profile),
  spsCommitVaultProposal: (
    id: string,
    operationIds?: string[],
    profile?: string,
  ): Promise<VaultProposal | null> =>
    ipcRenderer.invoke("sps-commit-vault-proposal", id, operationIds, profile),
  spsDismissVaultProposal: (
    id: string,
    profile?: string,
  ): Promise<VaultProposal | null> =>
    ipcRenderer.invoke("sps-dismiss-vault-proposal", id, profile),
  spsBuildContextPack: (
    input: SpsContextPackInput,
    profile?: string,
  ): Promise<SpsContextPackResult> =>
    ipcRenderer.invoke("sps-build-context-pack", input, profile),
  spsCreateBaseProposal: (
    input: SpsBaseProposalInput,
    profile?: string,
  ): Promise<VaultProposal> =>
    ipcRenderer.invoke("sps-create-base-proposal", input, profile),
  spsLoad: (profile?: string): Promise<unknown | null> =>
    ipcRenderer.invoke("sps-load", profile),
  spsSave: (
    ws: unknown,
    profile?: string,
    baseRev?: number,
  ): Promise<SpsSaveResult> =>
    ipcRenderer.invoke("sps-save", ws, profile, baseRev),
  spsUpdatePageProperties: (
    pageId: string,
    patch: Record<string, SpsPropertyValue | undefined>,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-update-page-properties", pageId, patch, profile),
  spsGetWorkSession: (
    pageId: string,
    profile?: string,
  ): Promise<string | null> =>
    ipcRenderer.invoke("sps-get-work-session", pageId, profile),
  spsSetWorkSession: (
    pageId: string,
    sessionId: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-set-work-session", pageId, sessionId, profile),
  spsListActiveWorkRuns: (profile?: string): Promise<ActiveWorkRun[]> =>
    ipcRenderer.invoke("sps-active-work-list", profile),
  spsGetActiveWorkRun: (
    runId: string,
    profile?: string,
  ): Promise<ActiveWorkRun | null> =>
    ipcRenderer.invoke("sps-active-work-get", runId, profile),
  spsCreateActiveWorkRun: (
    input: ActiveWorkCreateInput,
    profile?: string,
  ): Promise<ActiveWorkRun> =>
    ipcRenderer.invoke("sps-active-work-create", input, profile),
  spsUpdateActiveWorkRun: (
    runId: string,
    patch: ActiveWorkPatch,
    profile?: string,
  ): Promise<ActiveWorkRun | null> =>
    ipcRenderer.invoke("sps-active-work-update", runId, patch, profile),
  equityListBaskets: (profile?: string): Promise<unknown[]> =>
    ipcRenderer.invoke("equity-list-baskets", profile),
  equitySaveBasket: (basket: unknown, profile?: string): Promise<unknown> =>
    ipcRenderer.invoke("equity-save-basket", basket, profile),
  equityDeleteBasket: (basketId: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("equity-delete-basket", basketId, profile),
  equityListAlerts: (limit?: number, profile?: string): Promise<unknown[]> =>
    ipcRenderer.invoke("equity-list-alerts", limit, profile),
  equityMarkAlertRead: (alertId: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("equity-mark-alert-read", alertId, profile),
  onEquityAlert: (callback: (alert: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, alert: unknown): void =>
      callback(alert);
    ipcRenderer.on("equity-alert", handler);
    return () => ipcRenderer.removeListener("equity-alert", handler);
  },
  spsResearchSearchWorks: (
    q: string,
    opts?: ResearchSearchOpts,
    profile?: string,
  ): Promise<ResearchWorkSummary[]> =>
    ipcRenderer.invoke("sps-research-search-works", q, opts, profile),
  spsResearchGetWork: (
    id: string,
    profile?: string,
  ): Promise<ResearchWorkDetail> =>
    ipcRenderer.invoke("sps-research-get-work", id, profile),
  spsResearchGetConfig: (): Promise<{ mailto: string; hasApiKey: boolean }> =>
    ipcRenderer.invoke("sps-research-get-config"),
  spsResearchSetConfig: (
    mailto: string,
    apiKey?: string,
  ): Promise<{ mailto: string; hasApiKey: boolean }> =>
    ipcRenderer.invoke("sps-research-set-config", mailto, apiKey),
  spsResearchEnsureAgentTool: (
    profile?: string,
  ): Promise<{ registered: boolean; alreadyPresent: boolean }> =>
    ipcRenderer.invoke("sps-research-ensure-agent-tool", profile),
  spsExportPage: (
    pageId: string,
    markdown: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-export-page", pageId, markdown, profile),
  spsExportRow: (
    dbFolder: string,
    rowId: string,
    markdown: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-export-row", dbFolder, rowId, markdown, profile),
  spsReadRow: (
    dbFolder: string,
    rowId: string,
    profile?: string,
  ): Promise<string | null> =>
    ipcRenderer.invoke("sps-read-row", dbFolder, rowId, profile),
  spsDeleteRow: (
    dbFolder: string,
    rowId: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("sps-delete-row", dbFolder, rowId, profile),
  spsDeletePage: (pageId: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-delete-page", pageId, profile),
  spsDeleteDbFolder: (dbFolder: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-delete-db-folder", dbFolder, profile),
  spsVaultRead: (
    profile?: string,
  ): Promise<{ pages: Record<string, string>; manifest: string | null }> =>
    ipcRenderer.invoke("sps-vault-read", profile),
  spsVaultWriteManifest: (json: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-vault-write-manifest", json, profile),
  spsBackupWorkspace: (profile?: string): Promise<string | null> =>
    ipcRenderer.invoke("sps-backup-workspace", profile),
  spsWriteExcalidraw: (
    pageId: string,
    assetId: string,
    sceneJson: string,
    svg: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "sps-write-excalidraw",
      pageId,
      assetId,
      sceneJson,
      svg,
      profile,
    ),
  spsReadExcalidraw: (
    pageId: string,
    assetId: string,
    profile?: string,
  ): Promise<{ scene: string | null; svg: string | null }> =>
    ipcRenderer.invoke("sps-read-excalidraw", pageId, assetId, profile),
  spsAssetWrite: (
    bytes: Uint8Array,
    ext: string,
    profile?: string,
  ): Promise<string> =>
    ipcRenderer.invoke("sps-asset-write", bytes, ext, profile),
  spsAssetExists: (name: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("sps-asset-exists", name, profile),
  spsAssetGc: (referenced: string[], profile?: string): Promise<number> =>
    ipcRenderer.invoke("sps-asset-gc", referenced, profile),
  spsIndexQuery: (
    query: {
      scope?: string;
      filters?: Array<{
        prop: string;
        op: "eq" | "neq" | "contains" | "exists";
        value?: unknown;
      }>;
      sort?: { prop: string; dir: "asc" | "desc" };
      limit?: number;
    },
    profile?: string,
  ): Promise<
    Array<{
      path: string;
      title: string;
      props: Record<string, unknown>;
      mtime: number;
    }>
  > => ipcRenderer.invoke("sps-index-query", query, profile),
  spsIndexSearch: (
    text: string,
    limit?: number,
    profile?: string,
  ): Promise<Array<{ path: string; title: string; snippet: string }>> =>
    ipcRenderer.invoke("sps-index-search", text, limit, profile),
  spsIndexBacklinks: (path: string, profile?: string): Promise<string[]> =>
    ipcRenderer.invoke("sps-index-backlinks", path, profile),
  spsQueryBase: (
    config: SpsBaseViewConfig,
    profile?: string,
  ): Promise<
    Array<{
      path: string;
      title: string;
      props: Record<string, unknown>;
      mtime: number;
    }>
  > =>
    ipcRenderer.invoke(
      "sps-index-query",
      {
        scope: config.scope ?? config.source,
        filters: config.filters,
        sort: config.sort,
        limit: 500,
      },
      profile,
    ),
  spsFindUnlinkedMentions: (
    pageId: string,
    profile?: string,
  ): Promise<Array<{ source: string; target: string; phrase: string }>> => {
    const path = pageId.endsWith(".md") || pageId.includes("/") ? pageId : `${pageId}.md`;
    return ipcRenderer.invoke("sps-index-unlinked-mentions", path, profile);
  },
  // Federated search: one query merged across notes + transcripts + sessions.
  federatedSearch: (
    query: string,
    opts?: FederatedSearchOpts,
    profile?: string,
  ): Promise<FederatedHit[]> =>
    ipcRenderer.invoke("federated-search", query, opts, profile),
  spsIndexLinks: (
    profile?: string,
  ): Promise<Array<{ source: string; target: string; type: string }>> =>
    ipcRenderer.invoke("sps-index-links", profile),
  spsIndexTags: (
    profile?: string,
  ): Promise<Array<{ tag: string; count: number }>> =>
    ipcRenderer.invoke("sps-index-tags", profile),
  spsIndexByTag: (tag: string, profile?: string): Promise<string[]> =>
    ipcRenderer.invoke("sps-index-by-tag", tag, profile),
  spsLintVault: (
    staleDays?: number,
    profile?: string,
  ): Promise<{
    orphans: string[];
    brokenLinks: Array<{ source: string; target: string; type: string }>;
    stale: string[];
  }> => ipcRenderer.invoke("sps-lint-vault", staleDays, profile),
  spsIndexStatus: (
    profile?: string,
  ): Promise<{
    root: string;
    notes: number;
    links: number;
    indexedAt: number | null;
  }> => ipcRenderer.invoke("sps-index-status", profile),
  spsIndexRebuild: (
    profile?: string,
  ): Promise<{
    root: string;
    notes: number;
    links: number;
    indexedAt: number | null;
  }> => ipcRenderer.invoke("sps-index-rebuild", profile),

  // Phase 1.7 — fires after the note index is rebuilt so search/graph/backlink
  // hooks refetch instead of showing stale data.
  onSpsIndexRebuilt: (
    callback: (payload: {
      profile?: string;
      status: {
        root: string;
        notes: number;
        links: number;
        indexedAt: number | null;
      };
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ): void =>
      callback(
        payload as {
          profile?: string;
          status: {
            root: string;
            notes: number;
            links: number;
            indexedAt: number | null;
          };
        },
      );
    ipcRenderer.on("sps-index-rebuilt", handler);
    return () => ipcRenderer.removeListener("sps-index-rebuilt", handler);
  },

  spsSemanticIndex: (profile?: string): Promise<unknown> =>
    ipcRenderer.invoke("sps-semantic-index", profile),
  spsSemanticSearch: (query: string, limit?: number): Promise<unknown> =>
    ipcRenderer.invoke("sps-semantic-search", query, limit),
  spsSemanticGraph: (): Promise<unknown> =>
    ipcRenderer.invoke("sps-semantic-graph"),
  spsSemanticRag: (query: string, limit?: number): Promise<unknown> =>
    ipcRenderer.invoke("sps-semantic-rag", query, limit),

  spsTriggerAction: (
    action: {
      type: "shell" | "api";
      command?: string;
      url?: string;
      headers?: string;
    },
    profile?: string,
  ): Promise<{ success: boolean; output?: string; error?: string }> =>
    ipcRenderer.invoke("sps-trigger-action", action, profile),

  // Count of vault-mirror writes that have silently failed (markdown drifting from
  // the authoritative blob), with the last error + timestamp.
  spsGetMirrorFailCount: (): Promise<{
    count: number;
    lastError?: string;
    lastAt?: number;
  }> => ipcRenderer.invoke("sps-get-mirror-fail-count"),

  // Shared-directory Obsidian mode: where the SPS vault lives on disk.
  spsGetVaultLocation: (
    profile?: string,
  ): Promise<{ dir: string; isDefault: boolean; default: string }> =>
    ipcRenderer.invoke("sps-get-vault-location", profile),
  spsSetVaultLocation: (
    dir: string,
    profile?: string,
  ): Promise<{
    ok: boolean;
    error?: string;
    location?: { dir: string; isDefault: boolean; default: string };
    nonEmpty?: boolean;
  }> => ipcRenderer.invoke("sps-set-vault-location", dir, profile),
  spsResetVaultLocation: (
    profile?: string,
  ): Promise<{ dir: string; isDefault: boolean; default: string }> =>
    ipcRenderer.invoke("sps-reset-vault-location", profile),
  spsPickVaultDir: (): Promise<string | null> =>
    ipcRenderer.invoke("sps-pick-vault-dir"),
  spsImportOkfBundle: (
    bundleDir: string,
    profile?: string,
  ): Promise<{ success: boolean; pages: unknown[]; error?: string }> =>
    ipcRenderer.invoke("sps-import-okf-bundle", bundleDir, profile),
  spsCreateImportPlan: (
    input: { source: SpsImportSource; targetFolder?: string },
    profile?: string,
  ): Promise<SpsImportPlan> =>
    ipcRenderer.invoke("sps-create-import-plan", input, profile),
  spsApplyImportPlan: (
    planId: string,
    profile?: string,
  ): Promise<SpsImportResult> =>
    ipcRenderer.invoke("sps-apply-import-plan", planId, profile),
  spsExportOkfBundle: (
    targetDir: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("sps-export-okf-bundle", targetDir, profile),

  // KB Phase 0: pick + extract a PDF for ingestion into the SPS vault.
  spsPickPdf: (): Promise<string | null> => ipcRenderer.invoke("sps-pick-pdf"),
  spsExtractPdf: (
    filePath: string,
  ): Promise<{
    title: string;
    markdown: string;
    pageCount: number;
    hasTextLayer: boolean;
    reason?: "missing" | "unreadable";
  }> => ipcRenderer.invoke("sps-extract-pdf", filePath),
  spsReadFileBytes: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke("sps-read-file-bytes", filePath),
  runTelosAudit: (
    profile?: string,
  ): Promise<{
    success: boolean;
    title?: string;
    markdown?: string;
    error?: string;
  }> => ipcRenderer.invoke("sps-run-telos-audit", profile),
  runPipingPattern: (
    text: string,
    pattern: string,
    profile?: string,
  ): Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }> => ipcRenderer.invoke("sps-run-piping", text, pattern, profile),

  // Python Core Bridge Integration
  pythonCompress: (text: string, tool?: string): Promise<string> =>
    ipcRenderer.invoke("python-compress", text, tool),
  pythonIsPathAllowed: (
    targetPath: string,
    actionDir: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("python-is-path-allowed", targetPath, actionDir),
  pythonEvaluateExecution: (
    cmdArgs: string[],
    tier: "readonly" | "supervised" | "full",
    paths: string[],
    actionDir: string,
  ): Promise<{ decision: "ALLOW" | "PROMPT" | "BLOCK"; reason: string }> =>
    ipcRenderer.invoke(
      "python-evaluate-execution",
      cmdArgs,
      tier,
      paths,
      actionDir,
    ),
  pythonMemorySave: (
    vaultDir: string,
    pageId: string,
    metadata: Record<string, unknown>,
    body: string,
  ): Promise<void> =>
    ipcRenderer.invoke("python-memory-save", vaultDir, pageId, metadata, body),
  pythonMemorySearch: (
    vaultDir: string,
    query: string,
  ): Promise<Array<{ id: string; score: number }>> =>
    ipcRenderer.invoke("python-memory-search", vaultDir, query),
  pythonMemoryGraph: (
    vaultDir: string,
  ): Promise<{
    outgoing: Record<string, string[]>;
    backlinks: Record<string, string[]>;
  }> => ipcRenderer.invoke("python-memory-graph", vaultDir),

  // Autopoietic Skills Registry & Generator
  syncSkillsRegistry: (
    profile?: string,
  ): Promise<{ success: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke("skills-registry-sync", profile),
  lookupSkillRegistry: (
    query: string,
    profile?: string,
  ): Promise<SkillEntry[]> =>
    ipcRenderer.invoke("skills-registry-lookup", query, profile),
  registerSkillRegistry: (
    skill: Omit<SkillEntry, "id" | "created_at">,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("skills-registry-register", skill, profile),
  scaffoldSkill: (
    name: string,
    description: string,
    code: string,
    deps: string[],
    profile?: string,
  ): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke(
      "skills-registry-scaffold",
      name,
      description,
      code,
      deps,
      profile,
    ),
  testSkill: (
    name: string,
    args?: string,
    profile?: string,
  ): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke("skills-registry-test", name, args, profile),

  onSystemStabilized: (
    callback: (info: {
      jobId: string;
      jobName: string;
      explanation: string;
      filePatched: string;
      diff: string;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown): void =>
      callback(info as Parameters<typeof callback>[0]);
    ipcRenderer.on("system-stabilized", handler);
    return () => ipcRenderer.removeListener("system-stabilized", handler);
  },

  getSchedulerConfig: (): Promise<{
    enabled: boolean;
    tickIntervalMs: number;
  }> => ipcRenderer.invoke("get-scheduler-config"),

  setSchedulerConfig: (settings: {
    enabled?: boolean;
    tickIntervalMs?: number;
  }): Promise<boolean> => ipcRenderer.invoke("set-scheduler-config", settings),

  getSchedulerSkips: (): Promise<
    Record<
      string,
      { skipCount: number; lastSkipAt: number; lastReason: string }
    >
  > => ipcRenderer.invoke("get-scheduler-skips"),

  getSpendingCapConfig: (): Promise<{
    maxSpendingLimit: number;
    spendingCapAction: string;
  }> => ipcRenderer.invoke("get-spending-cap-config"),

  setSpendingCapConfig: (settings: {
    maxSpendingLimit?: number;
    spendingCapAction?: string;
  }): Promise<boolean> =>
    ipcRenderer.invoke("set-spending-cap-config", settings),

  // ── Scheduled Research ──
  srList: (profile?: string): Promise<ScheduledResearchItem[]> =>
    ipcRenderer.invoke("sr-list", profile),
  srCreate: (
    input: ScheduleInput,
    profile?: string,
  ): Promise<{ ok: boolean; item?: ScheduledResearchItem; error?: string }> =>
    ipcRenderer.invoke("sr-create", input, profile),
  srUpdate: (
    id: string,
    patch: SrPatch,
    profile?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("sr-update", id, patch, profile),
  srDelete: (id: string, profile?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("sr-delete", id, profile),
  srRunNow: (
    id: string,
    profile?: string,
  ): Promise<{ outcome: string; summary?: string; error?: string }> =>
    ipcRenderer.invoke("sr-run-now", id, profile),
  srListPending: (profile?: string): Promise<SrPendingUpdate[]> =>
    ipcRenderer.invoke("sr-list-pending", profile),
  srRemovePending: (id: string, profile?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("sr-remove-pending", id, profile),
  /** Fired when a "Run now" (or a scheduled tick) produces a pending update. */
  onScheduledResearchUpdate: (
    callback: (p: {
      scheduleId: string;
      topic: string;
      summary: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      p: { scheduleId: string; topic: string; summary: string },
    ): void => callback(p);
    ipcRenderer.on("scheduled-research-update", handler);
    return () =>
      ipcRenderer.removeListener("scheduled-research-update", handler);
  },
  spsTriggerScreencapture: (profile?: string): Promise<string | null> =>
    ipcRenderer.invoke("sps-trigger-screencapture", profile),
};
