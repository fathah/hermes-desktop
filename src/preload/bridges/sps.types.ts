import type * as Api from "../api-types";

export interface SpsBridgeApi {
  spsUnfurl: (url: string) => Promise<{
    url: string;
    title: string;
    desc: string;
    favicon?: string;
    image?: string;
  }>;

  spsAssistant: (
    prompt: string,
    ctx: {
      blocks: { type: string; text: string }[];
      pageTitle: string;
      notes?: string[];
    },
    profile?: string,
    groundInWorkspace?: boolean,
  ) => Promise<unknown>;

  spsSourceStudy: (
    focus: string,
    corpusDescription?: string,
    profile?: string,
  ) => Promise<unknown>;

  spsTeachCapture: (
    input: { captureId: string; title?: string; corpusDescription: string },
    profile?: string,
  ) => Promise<unknown>;

  spsCuratedBrief: (
    topic: string,
    corpusDescription?: string,
    profile?: string,
  ) => Promise<unknown>;

  spsIngestInbox: (profile?: string) => Promise<{
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
  }>;

  spsRegisterDeepLinks: () => Promise<boolean>;

  spsCapture: (
    input: Api.SpsCaptureInput,
    profile?: string,
  ) => Promise<{ success: boolean; id?: string; error?: string }>;

  spsListRecentScreenshots: (
    profile?: string,
  ) => Promise<Api.SpsRecentScreenshotCandidate[]>;

  spsImportRecentScreenshot: (
    input?: Api.SpsRecentScreenshotImportInput,
    profile?: string,
  ) => Promise<Api.SpsRecentScreenshotImportResult>;

  spsImportClipboardScreenshot: (
    input?: Api.SpsClipboardScreenshotImportInput,
    profile?: string,
  ) => Promise<Api.SpsRecentScreenshotImportResult>;

  spsEmailMonitorGetConfig: (
    profile?: string,
  ) => Promise<Api.EmailMonitorConfig>;

  spsEmailMonitorSaveConfig: (
    config: Api.EmailMonitorConfig,
    profile?: string,
  ) => Promise<Api.EmailMonitorConfig>;

  spsEmailMonitorGetStatus: (
    profile?: string,
  ) => Promise<Api.EmailMonitorStatus>;

  spsEmailMonitorRunNow: (
    profile?: string,
  ) => Promise<Api.EmailMonitorRunResult>;

  spsEmailMonitorApplyFeedback: (
    feedback: Api.EmailMonitorFeedback,
    profile?: string,
  ) => Promise<Api.EmailMonitorConfig>;

  spsFileAnswer: (
    question: string,
    answer: string,
    profile?: string,
  ) => Promise<{
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
  }>;

  spsFileResearch: (
    topic: string,
    researchedMarkdown: string,
    profile?: string,
  ) => Promise<{
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
  }>;

  spsNotebookLmEnsureMcp: (
    profile?: string,
  ) => Promise<Api.NotebookLmMcpStatus>;

  spsNotebookLmStatus: (profile?: string) => Promise<Api.NotebookLmMcpStatus>;

  spsAppendWikiLog: (
    op: "ingest" | "file-answer" | "lint" | "research" | "digest",
    summary: string,
    profile?: string,
  ) => Promise<void>;

  spsLintWiki: (
    staleDays?: number,
    profile?: string,
  ) => Promise<{
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
  }>;

  spsHealthReport: (
    staleDays?: number,
    profile?: string,
  ) => Promise<Api.VaultHealthReport>;

  spsCreateVaultProposal: (
    input: Api.VaultProposalInput,
    profile?: string,
  ) => Promise<Api.VaultProposal>;

  spsListVaultProposals: (profile?: string) => Promise<Api.VaultProposal[]>;

  spsCommitVaultProposal: (
    id: string,
    operationIds?: string[],
    profile?: string,
  ) => Promise<Api.VaultProposal | null>;

  spsDismissVaultProposal: (
    id: string,
    profile?: string,
  ) => Promise<Api.VaultProposal | null>;

  spsBuildContextPack: (
    input: Api.SpsContextPackInput,
    profile?: string,
  ) => Promise<Api.SpsContextPackResult>;

  spsCreateBaseProposal: (
    input: Api.SpsBaseProposalInput,
    profile?: string,
  ) => Promise<Api.VaultProposal>;

  deckGenerate: (
    input: Api.DeckGenerationInput,
    profile?: string,
  ) => Promise<Api.DeckGenerationResult>;

  deckSave: (
    project: Api.DeckProject,
    profile?: string,
  ) => Promise<{ ok: boolean; rowId?: string }>;

  deckList: (profile?: string) => Promise<Api.DeckStudioVaultRow[]>;

  deckRead: (
    rowId: string,
    profile?: string,
  ) => Promise<Api.DeckProject | null>;

  deckExportPdf: (
    project: Api.DeckProject,
    profile?: string,
  ) => Promise<Api.DeckExportResult>;

  deckExportPptx: (
    project: Api.DeckProject,
    profile?: string,
  ) => Promise<Api.DeckExportResult>;

  deckOpenExport: (
    filePath: string,
    profile?: string,
  ) => Promise<{ ok: boolean; error?: string }>;

  spsListAssistantRecipes: (profile?: string) => Promise<Api.AssistantRecipe[]>;

  spsCreateAssistantRecipe: (
    input: Api.CreateAssistantRecipeInput,
    profile?: string,
  ) => Promise<Api.AssistantRecipeResult>;

  spsUpdateAssistantRecipe: (
    id: string,
    patch: Api.AssistantRecipePatch,
    profile?: string,
  ) => Promise<Api.AssistantRecipeResult>;

  spsDeleteAssistantRecipe: (
    id: string,
    profile?: string,
  ) => Promise<Api.AssistantRecipeResult>;

  spsRunAssistantRecipe: (
    id: string,
    userInput?: string,
    profile?: string,
  ) => Promise<Api.AssistantRecipeRunResult>;

  spsListAssistantRecipeRuns: (
    recipeId?: string,
    profile?: string,
  ) => Promise<Api.AssistantRecipeRunRecord[]>;

  spsSaveAssistantRecipeRun: (
    runId: string,
    profile?: string,
  ) => Promise<Api.AssistantRecipeSaveRunResult>;

  spsListLocalExperts: (
    profile?: string,
  ) => Promise<Api.ListLocalExpertsResult>;

  spsGetLocalExpert: (
    packId: string,
    profile?: string,
  ) => Promise<Api.LocalExpertPackDetailResult>;

  spsInstallLocalExpert: (
    packId: string,
    profile?: string,
  ) => Promise<Api.InstallLocalExpertResult>;

  spsUninstallLocalExpert: (
    packId: string,
    profile?: string,
  ) => Promise<Api.InstallLocalExpertResult>;

  spsPreviewLocalExpertPack: (
    filePath: string,
    profile?: string,
  ) => Promise<Api.LocalExpertPackPreviewResult>;

  spsImportLocalExpertPack: (
    filePath: string,
    profile?: string,
  ) => Promise<Api.LocalExpertPackImportResult>;

  spsExportLocalExpertPack: (
    packId: string,
    targetPath: string,
    profile?: string,
  ) => Promise<Api.LocalExpertPackExportResult>;

  spsEnableLocalExpertChecks: (
    packId: string,
    profile?: string,
  ) => Promise<{ ok: boolean; packId: string; error?: string }>;

  spsRunLocalExpertChecks: (
    packId: string,
    profile?: string,
  ) => Promise<Api.LocalExpertCheckRunResult>;

  spsLoad: (profile?: string) => Promise<unknown | null>;

  spsSave: (
    ws: unknown,
    profile?: string,
    baseRev?: number,
  ) => Promise<Api.SpsSaveResult>;

  spsUpdatePageProperties: (
    pageId: string,
    patch: Record<string, Api.SpsPropertyValue | undefined>,
    profile?: string,
  ) => Promise<boolean>;

  spsGetWorkSession: (
    pageId: string,
    profile?: string,
  ) => Promise<string | null>;

  spsSetWorkSession: (
    pageId: string,
    sessionId: string,
    profile?: string,
  ) => Promise<boolean>;

  spsListActiveWorkRuns: (profile?: string) => Promise<Api.ActiveWorkRun[]>;

  spsGetActiveWorkRun: (
    runId: string,
    profile?: string,
  ) => Promise<Api.ActiveWorkRun | null>;

  spsCreateActiveWorkRun: (
    input: Api.ActiveWorkCreateInput,
    profile?: string,
  ) => Promise<Api.ActiveWorkRun>;

  spsUpdateActiveWorkRun: (
    runId: string,
    patch: Api.ActiveWorkPatch,
    profile?: string,
  ) => Promise<Api.ActiveWorkRun | null>;

  equityListBaskets: (profile?: string) => Promise<Api.EquityBasket[]>;

  equitySaveBasket: (
    basket: Partial<Api.EquityBasket>,
    profile?: string,
  ) => Promise<Api.EquityBasket>;

  equityDeleteBasket: (basketId: string, profile?: string) => Promise<boolean>;

  equityListAlerts: (
    limit?: number,
    profile?: string,
  ) => Promise<Api.EquityAlert[]>;

  equityMarkAlertRead: (alertId: string, profile?: string) => Promise<boolean>;

  onEquityAlert: (callback: (alert: Api.EquityAlert) => void) => () => void;

  spsResearchSearchWorks: (
    q: string,
    opts?: Api.ResearchSearchOpts,
    profile?: string,
  ) => Promise<Api.ResearchWorkSummary[]>;

  spsResearchGetWork: (
    id: string,
    profile?: string,
  ) => Promise<Api.ResearchWorkDetail>;

  spsResearchGetConfig: () => Promise<{ mailto: string; hasApiKey: boolean }>;

  spsResearchSetConfig: (
    mailto: string,
    apiKey?: string,
  ) => Promise<{ mailto: string; hasApiKey: boolean }>;

  spsResearchEnsureAgentTool: (
    profile?: string,
  ) => Promise<{ registered: boolean; alreadyPresent: boolean }>;

  spsExportPage: (
    pageId: string,
    markdown: string,
    profile?: string,
  ) => Promise<boolean>;

  spsExportRow: (
    dbFolder: string,
    rowId: string,
    markdown: string,
    profile?: string,
  ) => Promise<boolean>;

  spsReadRow: (
    dbFolder: string,
    rowId: string,
    profile?: string,
  ) => Promise<string | null>;

  spsDeleteRow: (
    dbFolder: string,
    rowId: string,
    profile?: string,
  ) => Promise<boolean>;

  spsDeletePage: (pageId: string, profile?: string) => Promise<boolean>;

  spsDeleteDbFolder: (dbFolder: string, profile?: string) => Promise<boolean>;

  spsVaultRead: (
    profile?: string,
  ) => Promise<{ pages: Record<string, string>; manifest: string | null }>;

  spsVaultWriteManifest: (json: string, profile?: string) => Promise<boolean>;

  spsBackupWorkspace: (profile?: string) => Promise<string | null>;

  spsWriteExcalidraw: (
    pageId: string,
    assetId: string,
    sceneJson: string,
    svg: string,
    profile?: string,
  ) => Promise<boolean>;

  spsReadExcalidraw: (
    pageId: string,
    assetId: string,
    profile?: string,
  ) => Promise<{ scene: string | null; svg: string | null }>;

  spsAssetWrite: (
    bytes: Uint8Array,
    ext: string,
    profile?: string,
  ) => Promise<string>;

  spsAssetExists: (name: string, profile?: string) => Promise<boolean>;

  spsAssetGc: (referenced: string[], profile?: string) => Promise<number>;

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
  ) => Promise<
    Array<{
      path: string;
      title: string;
      props: Record<string, unknown>;
      mtime: number;
    }>
  >;

  spsIndexSearch: (
    text: string,
    limit?: number,
    profile?: string,
  ) => Promise<Array<{ path: string; title: string; snippet: string }>>;

  spsIndexBacklinks: (path: string, profile?: string) => Promise<string[]>;

  spsQueryBase: (
    config: Api.SpsBaseViewConfig,
    profile?: string,
  ) => Promise<
    Array<{
      path: string;
      title: string;
      props: Record<string, unknown>;
      mtime: number;
    }>
  >;

  spsFindUnlinkedMentions: (
    pageId: string,
    profile?: string,
  ) => Promise<Array<{ source: string; target: string; phrase: string }>>;

  federatedSearch: (
    query: string,
    opts?: Api.FederatedSearchOpts,
    profile?: string,
  ) => Promise<Api.FederatedHit[]>;

  spsIndexLinks: (
    profile?: string,
  ) => Promise<Array<{ source: string; target: string; type: string }>>;

  spsIndexTags: (
    profile?: string,
  ) => Promise<Array<{ tag: string; count: number }>>;

  spsIndexByTag: (tag: string, profile?: string) => Promise<string[]>;

  spsLintVault: (
    staleDays?: number,
    profile?: string,
  ) => Promise<{
    orphans: string[];
    brokenLinks: Array<{ source: string; target: string; type: string }>;
    stale: string[];
  }>;

  spsIndexStatus: (profile?: string) => Promise<{
    root: string;
    notes: number;
    links: number;
    indexedAt: number | null;
  }>;

  spsIndexRebuild: (profile?: string) => Promise<{
    root: string;
    notes: number;
    links: number;
    indexedAt: number | null;
  }>;

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
  ) => () => void;

  spsSemanticIndex: (profile?: string) => Promise<unknown>;

  spsSemanticSearch: (query: string, limit?: number) => Promise<unknown>;

  spsSemanticGraph: () => Promise<unknown>;

  spsSemanticRag: (query: string, limit?: number) => Promise<unknown>;

  spsTriggerAction: (
    action: {
      type: "shell" | "api";
      command?: string;
      url?: string;
      headers?: string;
    },
    profile?: string,
  ) => Promise<{ success: boolean; output?: string; error?: string }>;

  spsGetMirrorFailCount: () => Promise<{
    count: number;
    lastError?: string;
    lastAt?: number;
  }>;

  spsGetVaultLocation: (
    profile?: string,
  ) => Promise<{ dir: string; isDefault: boolean; default: string }>;

  spsSetVaultLocation: (
    dir: string,
    profile?: string,
  ) => Promise<{
    ok: boolean;
    error?: string;
    location?: { dir: string; isDefault: boolean; default: string };
    nonEmpty?: boolean;
  }>;

  spsResetVaultLocation: (
    profile?: string,
  ) => Promise<{ dir: string; isDefault: boolean; default: string }>;

  spsPickVaultDir: () => Promise<string | null>;

  spsImportOkfBundle: (
    bundleDir: string,
    profile?: string,
  ) => Promise<{
    success: boolean;
    pages: Api.SpsIngestPageProposal[];
    error?: string;
  }>;

  spsCreateImportPlan: (
    input: { source: Api.SpsImportSource; targetFolder?: string },
    profile?: string,
  ) => Promise<Api.SpsImportPlan>;

  spsApplyImportPlan: (
    planId: string,
    profile?: string,
  ) => Promise<Api.SpsImportResult>;

  spsExportOkfBundle: (
    targetDir: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  spsPickPdf: () => Promise<string | null>;

  spsPickImage: () => Promise<string | null>;

  spsExtractPdf: (filePath: string) => Promise<{
    title: string;
    markdown: string;
    pageCount: number;
    hasTextLayer: boolean;
    reason?: "missing" | "unreadable";
  }>;

  spsReadFileBytes: (filePath: string) => Promise<Uint8Array>;

  runTelosAudit: (profile?: string) => Promise<{
    success: boolean;
    title?: string;
    markdown?: string;
    error?: string;
  }>;

  runPipingPattern: (
    text: string,
    pattern: string,
    profile?: string,
  ) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;

  // Python Core Bridge Integration

  pythonCompress: (text: string, tool?: string) => Promise<string>;

  pythonIsPathAllowed: (
    targetPath: string,
    actionDir: string,
  ) => Promise<boolean>;

  pythonEvaluateExecution: (
    cmdArgs: string[],
    tier: "readonly" | "supervised" | "full",
    paths: string[],
    actionDir: string,
  ) => Promise<{ decision: "ALLOW" | "PROMPT" | "BLOCK"; reason: string }>;

  pythonMemorySave: (
    vaultDir: string,
    pageId: string,
    metadata: Record<string, unknown>,
    body: string,
  ) => Promise<void>;

  pythonMemorySearch: (
    vaultDir: string,
    query: string,
  ) => Promise<Array<{ id: string; score: number }>>;

  pythonMemoryGraph: (vaultDir: string) => Promise<{
    outgoing: Record<string, string[]>;
    backlinks: Record<string, string[]>;
  }>;

  // Autopoietic Skills Registry & Generator

  syncSkillsRegistry: (
    profile?: string,
  ) => Promise<{ success: boolean; count: number; error?: string }>;

  lookupSkillRegistry: (
    query: string,
    profile?: string,
  ) => Promise<Api.SkillEntry[]>;

  registerSkillRegistry: (
    skill: Omit<Api.SkillEntry, "id" | "created_at">,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  scaffoldSkill: (
    name: string,
    description: string,
    code: string,
    deps: string[],
    profile?: string,
  ) => Promise<{ success: boolean; path?: string; error?: string }>;

  testSkill: (
    name: string,
    args?: string,
    profile?: string,
  ) => Promise<{ success: boolean; output: string }>;

  onSystemStabilized: (
    callback: (info: {
      jobId: string;
      jobName: string;
      explanation: string;
      filePatched: string;
      diff: string;
    }) => void,
  ) => () => void;

  getSchedulerConfig: () => Promise<{
    enabled: boolean;
    tickIntervalMs: number;
  }>;

  setSchedulerConfig: (settings: {
    enabled?: boolean;
    tickIntervalMs?: number;
  }) => Promise<boolean>;

  getSchedulerSkips: () => Promise<
    Record<
      string,
      { skipCount: number; lastSkipAt: number; lastReason: string }
    >
  >;

  getSpendingCapConfig: () => Promise<{
    maxSpendingLimit: number;
    spendingCapAction: string;
  }>;

  setSpendingCapConfig: (settings: {
    maxSpendingLimit?: number;
    spendingCapAction?: string;
  }) => Promise<boolean>;

  // ── Scheduled Research ──

  srList: (profile?: string) => Promise<Api.ScheduledResearchItem[]>;

  srTelegramStatus: (profile?: string) => Promise<Api.TelegramDeliveryStatus>;

  srCreate: (
    input: Api.ScheduleInput,
    profile?: string,
  ) => Promise<{
    ok: boolean;
    item?: Api.ScheduledResearchItem;
    error?: string;
  }>;

  srDiscoverSources: (
    input: Api.MonitorDiscoveryInput,
    profile?: string,
  ) => Promise<Api.MonitorDiscoveryResult>;

  srUpdate: (
    id: string,
    patch: Api.SrPatch,
    profile?: string,
  ) => Promise<{ ok: boolean; error?: string }>;

  srUpdateSourcePlan: (
    id: string,
    sourcePlan: Api.MonitorSourceEntry[],
    profile?: string,
  ) => Promise<{ ok: boolean; error?: string }>;

  srDelete: (id: string, profile?: string) => Promise<{ ok: boolean }>;

  srRunNow: (
    id: string,
    profile?: string,
  ) => Promise<{ outcome: string; summary?: string; error?: string }>;

  srListPending: (profile?: string) => Promise<Api.SrPendingUpdate[]>;

  srRemovePending: (id: string, profile?: string) => Promise<{ ok: boolean }>;

  onScheduledResearchUpdate: (
    callback: (p: {
      scheduleId: string;
      topic: string;
      summary: string;
    }) => void,
  ) => () => void;

  spsTriggerScreencapture: (profile?: string) => Promise<string | null>;

  // Health APIs
}
