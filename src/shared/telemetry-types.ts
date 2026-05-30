/**
 * Shared types for the read-only telemetry surface.
 *
 * The same Envelope shape wraps the Hermes Agent backend's
 * `/api/*` responses (adapted in `src/main/telemetry/subsystems.ts`)
 * and is consumed by both the Electron main process (HTTP client)
 * and the renderer (React hooks).
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
 * Adapted from GET /api/gateway/status (+ /v1/capabilities merge).
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
  /** Backend Python interpreter version (e.g. "3.11.15"). */
  pythonVersion?: string;
  /** Installed `openai` SDK version on the backend. */
  openaiSdkVersion?: string | null;
  /** Backend uptime in seconds. Optional — Codex'
   *  `/api/gateway/status` does not expose this today. Renderer
   *  shows "—" when undefined; a real number (incl. 0) renders
   *  via `formatUptime`. */
  uptimeSeconds?: number;
  /** Subsystem keys the runtime exposes. Backend may add more later. */
  capabilities: string[];
  upstreamProviders: Array<{
    name: string;
    configured: boolean;
    reachable: boolean;
  }>;
}

/** Adapted from GET /api/tools/toolsets — read-only toolset status. */
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

/** Adapted from GET /api/memory — provider status, never contents. */
export interface MemoryTelemetry {
  provider: string;
  configured: boolean;
  itemCount?: number;
  sizeBytes?: number;
  lastUpdatedAt?: string;
}

/** Schedules summary — NOT wired in Phase A (no claim-conformant
 *  upstream contract; `/api/jobs` lacks a `kind` field). Type kept
 *  for a future phase that exposes a read-summary endpoint. */
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

/** Kanban summary — NOT wired in Phase A (`/api/kanban/*` lives in
 *  the follow-up #31641, outside this PR's dependency chain). Type
 *  kept for the Phase E1-E2 split. */
export interface KanbanTelemetry {
  boards: Array<{
    id: string;
    name: string;
    columns: Array<{ id: string; name: string; cardCount: number }>;
  }>;
  totalCards: number;
}
