/**
 * Shared types for the read-only telemetry surface.
 *
 * The same Envelope shape is produced by the Hermes Agent backend
 * (`/v1/telemetry/*`) and consumed by both the Electron main
 * process (HTTP client) and the renderer (React hooks).
 *
 * Keep this file free of runtime imports — it is pulled into both
 * `tsconfig.node.json` and `tsconfig.web.json` builds.
 */

/**
 * Why a feature is unavailable. Driven by the backend response and
 * by app-side inference (e.g. capability missing → not-implemented).
 *
 * - `not-configured`     — feature exists but requires user setup
 * - `not-implemented`    — backend version doesn't expose this yet
 * - `remote-mode-blocked`— data only available in local / SSH mode
 * - `upstream-error`     — backend reachable but returned an error
 */
export type TelemetryUnavailableReason =
  | "not-configured"
  | "not-implemented"
  | "remote-mode-blocked"
  | "upstream-error";

/**
 * Standard response envelope. Backend always responds 200 with this
 * shape; transport errors are translated to `available:false,
 * reason:'upstream-error'` by the client before they reach the UI.
 */
export type TelemetryEnvelope<T> =
  | { available: true; data: T }
  | {
      available: false;
      reason: TelemetryUnavailableReason;
      detail?: string;
    };

/**
 * GET /v1/telemetry/gateway-status
 *
 * Capability-probe response. The `capabilities` array is the
 * source of truth for which other telemetry endpoints the app
 * should attempt to call. An old backend that doesn't know about
 * telemetry returns 404 on this endpoint; the client maps that to
 * `available:false, reason:'not-implemented'` and the app treats
 * the capability list as empty.
 */
export interface GatewayStatusTelemetry {
  service: "hermes-agent";
  version: string;
  /** Most recent dated release tag on the backend (e.g. "2026.5.16"). */
  released?: string | null;
  /** Backend Python interpreter version (e.g. "3.13.12"). */
  pythonVersion?: string;
  /** Installed `openai` SDK version on the backend. */
  openaiSdkVersion?: string | null;
  uptimeSeconds: number;
  /** Known keys: "tools" | "memory" | "schedules" | "kanban". Backend may add more later. */
  capabilities: string[];
  upstreamProviders: Array<{
    name: string;
    configured: boolean;
    reachable: boolean;
  }>;
}

/** GET /v1/telemetry/tools — read-only toolset status. */
export interface ToolsTelemetry {
  toolsets: Array<{
    key: string;
    label: string;
    description: string;
    enabled: boolean;
    source: "builtin" | "mcp";
    mcpServer?: { name: string; status: "connected" | "disconnected" };
  }>;
}

/** GET /v1/telemetry/memory — provider status, never contents. */
export interface MemoryTelemetry {
  provider: string;
  configured: boolean;
  itemCount?: number;
  sizeBytes?: number;
  lastUpdatedAt?: string;
}

/** GET /v1/telemetry/schedules — cron / interval / one-shot job summary. */
export interface SchedulesTelemetry {
  jobs: Array<{
    id: string;
    name: string;
    kind: "cron" | "interval" | "at";
    schedule: string;
    agentId?: string;
    nextRunAt?: string;
    lastRunAt?: string;
    lastStatus?: "ok" | "error" | "skipped";
    enabled: boolean;
  }>;
}

/** GET /v1/telemetry/kanban — boards + per-column card counts. */
export interface KanbanTelemetry {
  boards: Array<{
    id: string;
    name: string;
    columns: Array<{ id: string; name: string; cardCount: number }>;
  }>;
  totalCards: number;
}

/** GET /v1/telemetry/sessions — recent sessions metadata. No bodies. */
export interface SessionsTelemetry {
  recent: Array<{
    id: string;
    source: string;
    model: string;
    title: string;
    startedAt?: string;
    lastActiveAt?: string;
    status: "active" | "idle" | "closed";
    messageCount: number;
  }>;
  activeCount: number;
  totalCount: number;
}

/** GET /v1/telemetry/skills — installed skills inventory (no body content). */
export interface SkillsTelemetry {
  installed: Array<{
    id: string;
    name: string;
    /** First path segment when the skill is nested (e.g. "apple"). */
    category?: string | null;
    version: string;
    description: string;
    enabled: boolean;
    status: "ready" | "error" | "loading";
  }>;
  total: number;
  enabledCount: number;
}

/** GET /v1/telemetry/profiles — multi-instance profile list. */
export interface ProfilesTelemetry {
  profiles: Array<{
    name: string;
    isDefault: boolean;
    isActive: boolean;
    model: string;
    provider: string;
    gatewayRunning: boolean;
    hasEnv: boolean;
    skillCount: number;
    description: string;
  }>;
  active: string;
}

/** GET /v1/telemetry/providers — known providers + configured flag. NEVER keys. */
export interface ProvidersTelemetry {
  providers: Array<{
    key: string;
    label: string;
    configured: boolean;
    /** True iff this provider is the active `model.provider`. */
    active?: boolean;
  }>;
  /** Currently selected `model.provider` from config.yaml, if any. */
  active?: string | null;
}

/** GET /v1/telemetry/persona — Soul / Persona markdown body (capped). */
export interface PersonaTelemetry {
  configured: boolean;
  content: string;
  sizeBytes?: number;
  truncated?: boolean;
}

/** GET /v1/telemetry/recent-events — structured activity feed. */
export interface RecentEventsTelemetry {
  events: Array<{
    id: string;
    at: string;
    kind:
      | "session.start"
      | "session.end"
      | "skill.load"
      | "tool.call"
      | "schedule.fire"
      | "gateway.warn"
      | "gateway.error";
    summary: string;
    sessionId?: string;
    jobId?: string;
    agentId?: string;
  }>;
}

/**
 * Discriminated result type returned by every mutation IPC.
 * Callers branch on `ok` — no thrown errors crossing the bridge.
 */
export type MutationResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** Body shape for POST /api/jobs (Phase-4 cron create). */
export interface CronJobInput {
  name: string;
  schedule: string;
  prompt?: string;
  deliver?: string;
  skills?: string[];
  repeat?: number;
}

/** PATCH /api/jobs/{id} — same fields, all optional. */
export type CronJobPatch = Partial<CronJobInput>;

/** GET /v1/telemetry/usage-summary — token + cost aggregates. */
export interface UsageSummaryTelemetry {
  windowStart?: string | null;
  windowEnd?: string | null;
  tokens: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  estimatedCostUsd?: number | null;
  byModel: Array<{
    modelId: string;
    requests: number;
    tokens: number;
  }>;
}
