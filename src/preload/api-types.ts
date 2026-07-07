import type {
  MonitorSourceEntry,
  ScheduledResearchItem,
} from "../shared/scheduledResearch";
import type { EngineContractVerificationResult } from "../shared/engine-contract";
import type { EngineAvailableUpdate } from "../shared/update-affordances";

export type { AppLocale } from "../shared/i18n/types";
export type { Attachment } from "../shared/attachments";
export type { AppZoomSettings } from "../shared/app-zoom";
export type { UsageAggregate, RunLedgerEntry } from "../shared/usage";
export type { ActionReceipt } from "../shared/action-receipts";
export type { SpsPulse } from "../shared/sps-pulse";
export type { MemoryTimeline } from "../shared/memoryTimeline";
export type { MemoryInfo } from "../shared/memory";
export type {
  CreateLearningProposalInput,
  LearningProposal,
  LearningProposalResult,
  SkillUsageEntry,
} from "../shared/learning";
export type {
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
  VaultLinkEdge,
  VaultProposal,
  VaultProposalInput,
} from "../shared/sps-types";
export type {
  FederatedHit,
  FederatedSearchOpts,
} from "../shared/federated-search";
export type { SearchSummary } from "../shared/searchSummary";
export type { LoadedSkin } from "../shared/skins";
export type {
  SearchOpts as ResearchSearchOpts,
  WorkSummary as ResearchWorkSummary,
  WorkDetail as ResearchWorkDetail,
} from "../shared/openalex/core";
export type { InstallStatus, InstallProgress } from "../shared/install";
export type {
  EngineCapabilityEndpoint,
  EngineCapabilityFeatureValue,
  EngineCapabilitySnapshot,
  EngineCapabilityState,
} from "../shared/engine-capabilities";
export type { EngineContractFinding } from "../shared/engine-contract";
export type { EngineContractVerificationResult };
export type {
  EngineAvailableUpdate,
  EngineUpdateAffordance,
  WhatsNewAffordance,
} from "../shared/update-affordances";
export type {
  KanbanTask,
  KanbanBoard,
  KanbanTaskDetail,
  KanbanCreateTaskInput,
} from "../shared/kanban";
export type {
  ActiveWorkCreateInput,
  ActiveWorkPatch,
  ActiveWorkRun,
} from "../shared/active-work";
export type { ConfigHealthReport } from "../shared/config-health";
export type { OperatorReadinessReport } from "../shared/operator-readiness";
export type { RoutinesStatusReport } from "../shared/routines-status";
export type {
  SpsAutomationPrefs,
  SpsAutomationPrefsPatch,
} from "../shared/sps-automation";
export type {
  OwnerNotificationChannel,
  OwnerNotificationEvent,
  OwnerNotificationPrefs,
  OwnerNotificationPrefsPatch,
} from "../shared/owner-notifications";
export type { EquityBasket, EquityAlert } from "../shared/equity";
export type { PublicConnectionConfig } from "../shared/connection";
export type { ChatReadiness } from "../shared/validation";
export type { GatewayStartResult } from "../shared/gateway";
export type { SkillEntry } from "../shared/skills";

export type McpTransport = "http" | "stdio" | "unknown";

export interface McpServerInfo {
  name: string;
  type: McpTransport;
  transport: McpTransport;
  enabled: boolean;
  detail: string;
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
  tools?: unknown;
}

export interface McpServerInput {
  name: string;
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: string;
}

export interface McpCatalogEntry {
  name: string;
  description: string;
  source: string;
  transport: McpTransport;
  authType: string;
  requiredEnv: Array<{ name: string; prompt: string; required: boolean }>;
  needsInstall: boolean;
  installed: boolean;
  enabled: boolean;
}

export interface McpOperationResult {
  success: boolean;
  error?: string;
  background?: boolean;
  action?: string;
  tools?: Array<{ name: string; description: string }>;
}

export interface McpCatalogResult {
  entries: McpCatalogEntry[];
  diagnostics: unknown[];
  error?: string;
}

export type {
  ExternalSource,
  ExternalImportSource,
  ExternalImportResult,
  ExternalSourceConfig,
  ExternalIndexStatus,
  ExternalSearchHit,
  ExternalConversationMeta,
  ExternalMessage,
  ExternalScanProgress,
} from "../shared/external-context";
export type { ProfileInfo } from "../shared/profiles";
export type { CronJob } from "../shared/cronjobs";
export type {
  AppLaunchSchedule,
  AppLaunchScheduleInput,
  AppLaunchSchedulePatch,
  AppLaunchTarget,
} from "../shared/app-launcher";
export type { SessionSummary } from "../shared/sessions";
export type {
  MonitorDiscoveryInput,
  MonitorDiscoveryResult,
  MonitorSourceEntry,
  ScheduledResearchItem,
  ScheduleInput,
  TelegramDeliveryStatus,
} from "../shared/scheduledResearch";
export type {
  AssistantRecipe,
  AssistantRecipePatch,
  AssistantRecipeResult,
  AssistantRecipeRunRecord,
  AssistantRecipeRunResult,
  AssistantRecipeSaveRunResult,
  CreateAssistantRecipeInput,
} from "../shared/assistant-recipes";
export type {
  InstallLocalExpertResult,
  LocalExpertCheckRunResult,
  LocalExpertPackDetailResult,
  LocalExpertPackExportResult,
  LocalExpertPackImportResult,
  LocalExpertPackPreviewResult,
  ListLocalExpertsResult,
} from "../shared/local-experts";
export type {
  DeckExportResult,
  DeckGenerationInput,
  DeckGenerationResult,
  DeckProject,
  DeckStudioVaultRow,
} from "../shared/deck-studio";
export type {
  SpsClipboardScreenshotImportInput,
  SpsRecentScreenshotCandidate,
  SpsRecentScreenshotImportInput,
  SpsRecentScreenshotImportResult,
} from "../shared/recent-screenshots";
export type {
  EmailMonitorConfig,
  EmailMonitorFeedback,
  EmailMonitorRunResult,
  EmailMonitorStatus,
} from "../shared/email-monitor";
export type {
  SubstackRadarAddApprovedFeedsInput,
  SubstackRadarAddApprovedFeedsResult,
  SubstackRadarRun,
  SubstackRadarRunInput,
  SubstackRadarSetCandidateStatusInput,
} from "../shared/substack-radar";
export type { CredentialPoolEntry } from "../shared/credentials";
export type { CapabilityRiskSummary } from "../shared/capability-risk";
export type { ResearchReachStatus } from "../shared/research-reach";
export type {
  SourceIntakeResult,
  SourceIntakeStatus,
} from "../shared/source-intake";
export type { WhatsAppCloudStatus } from "../shared/whatsappCloud";

export type OAuthProviderStatus = {
  provider: string;
  signedIn: boolean;
  source: "providers" | "credential_pool" | null;
};

export type OAuthProviderRemovalResult = {
  provider: string;
  removed: boolean;
};

export type HermesAgentUpdateRoutineResult = {
  checkedAt: string;
  status:
    | "current"
    | "available"
    | "updated"
    | "skipped"
    | "contract-broken"
    | "error";
  message: string;
  phase?: "check" | "update" | "restart" | "verify";
  reason?: string;
  restartStatus?: "not-needed" | "restarted" | "failed";
  restartMessage?: string;
  localHead?: string;
  upstreamHead?: string;
  behindBy?: number;
  changelog?: string;
  updateChannel?: "release" | "main";
  releaseTag?: string;
  releaseSha?: string;
  contract?: EngineContractVerificationResult;
};

export type HermesAgentUpdateRoutineState = {
  enabled: boolean;
  autoApply: boolean;
  engineUpdateChannel: "release" | "main";
  schedule: string;
  timezone: string;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastResult: HermesAgentUpdateRoutineResult | null;
  autoApplySuppressed: boolean;
  autoApplySuppressionReason: "contract-broken" | null;
  autoApplySuppressedAt: string | null;
  autoApplySuppressedSha: string | null;
};

export type DesktopUpdateRoutineResult = {
  checkedAt: string;
  status: "current" | "available" | "downloaded" | "skipped" | "error";
  message: string;
  phase?: "check" | "download";
  reason?: string;
  version?: string;
  releaseNotes?: string;
};

export type DesktopUpdateRoutineState = {
  enabled: boolean;
  autoDownload: boolean;
  schedule: string;
  timezone: string;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastResult: DesktopUpdateRoutineResult | null;
};

export type HermesUpstreamWatchCategory =
  | "contract-risk"
  | "runtime-required"
  | "api-contract"
  | "desktop-parity"
  | "security"
  | "cron-automation"
  | "provider-model"
  | "docs-only"
  | "ignore";

export type HermesUpstreamWatchState = {
  lastRunAt: string | null;
  lastSeenCommit: string | null;
  lastSeenRelease: string | null;
  latestReportPath: string | null;
  classifiedCounts: Partial<Record<HermesUpstreamWatchCategory, number>>;
  anchorSha?: string | null;
  pendingCommitCount?: number;
  contractRiskCount?: number;
  availableUpdate?: EngineAvailableUpdate;
  lastError?: string;
};

export interface ConfigFixLogEntry {
  ts: number;
  issueCode: string;
  action: "migrate" | "autofix" | "manual-fix";
  from?: string;
  to?: string;
  profile?: string;
  valueMasked?: string;
  detail?: string;
}

export interface SpsHealthJournalEntry {
  id: string;
  timestamp: number;
  text_raw: string;
  voice_transcription?: string;
  mood_score?: number;
  tags: string[];
  media?: Array<{
    id: string;
    file_path: string;
    mime_type: string;
    parsed_payload?: Record<string, unknown>;
  }>;
}

export interface SpsHealthBiometricLog {
  id: string;
  timestamp: number;
  weight_kg?: number;
  skeletal_muscle_mass_kg?: number;
  body_fat_pct?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  fasting_glucose_mgdl?: number;
  sleep_score?: number;
  hrv_ms?: number;
}

export interface SpsHealthMedicationProtocol {
  id: string;
  name: string;
  substance_type: string;
  vial_size_mg?: number;
  diluent_ml?: number;
  dosage_unit: string;
  syringe_units_per_ml: number;
  half_life_hours?: number;
  schedule_cron: string;
  titration_steps?: Array<{ week: number; dose: number }>;
}

export interface SpsHealthMedicationLog {
  id: string;
  protocol_id?: string;
  timestamp: number;
  dose_administered?: number;
  injection_site?: string;
  side_effects?: string[];
  notes?: string;
}

export interface SpsHealthBiomarker {
  name: string;
  value: number | string;
  unit: string;
  referenceRangeLow?: number;
  referenceRangeHigh?: number;
  isOutOfRange: boolean;
}

export interface SpsHealthMedicalDoc {
  id: string;
  file_name: string;
  file_path: string;
  uploaded_at: number;
  doc_type: string;
  ocr_content_text?: string;
  extracted_biomarkers?: SpsHealthBiomarker[];
}

export interface SpsHealthProfile extends Record<string, unknown> {
  active_conditions?: string[];
}

export interface SpsClinicalDigestArticle {
  id: string;
  relevance_score: number;
  feed_title?: string;
  title: string;
  summary_excerpt?: string;
  published_at: number;
  url: string;
}

export interface SpsRssFeed {
  id: string;
  url: string;
  title: string;
  site_url?: string;
  description?: string;
  category: string;
  last_fetched_at?: number;
}

export type SpsSubstackDiscoveryResult =
  | {
      ok: true;
      feedUrl: string;
      siteUrl: string;
      title: string;
      description: string;
      sourceType: "substack";
    }
  | {
      ok: false;
      error: string;
    };

export interface SpsRssArticle {
  id: string;
  feed_id: string;
  feed_title?: string;
  guid: string;
  title: string;
  author?: string;
  url: string;
  published_at: number;
  content_raw?: string;
  content_text?: string;
  summary_excerpt?: string;
  read_status: number;
  star_status: number;
  relevance_score: number;
}

export interface SpsIngestPageProposal {
  op: "create" | "update";
  pageId: string;
  title: string;
  markdown: string;
}

export interface ObsidianFileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: ObsidianFileNode[];
}

export interface ObsidianConfig {
  enabled: boolean;
  vaultPath: string;
  vaultName: string;
  vaultId: string;
  bridgeUrl: string;
  hasBridgeToken: boolean;
}

export interface ObsidianConfigInput {
  vaultPath: string;
  vaultName?: string;
  vaultId?: string;
  bridgeUrl?: string;
  bridgeToken?: string;
}

export type ObsidianFunctionName =
  | "status"
  | "active-note"
  | "open-note"
  | "insert-at-cursor"
  | "replace-selection"
  | "run-command"
  | "write-note";

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
  sourceIntent: ScheduledResearchItem["sourceIntent"];
  sourcePlan: MonitorSourceEntry[];
  importanceThreshold: ScheduledResearchItem["importanceThreshold"];
  telegramPush: boolean;
  telegramMode: ScheduledResearchItem["telegramMode"];
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
