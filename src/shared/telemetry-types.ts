/**
 * Shared types for the read-only telemetry surface.
 *
 * The same Envelope shape is produced by the Hermes Agent backend
 * (`/api/v1/telemetry/*`) and consumed by both the Electron main
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
 * GET /api/v1/telemetry/gateway-status
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
  uptimeSeconds: number;
  /** Known keys: "tools" | "memory" | "schedules" | "kanban". Backend may add more later. */
  capabilities: string[];
  upstreamProviders: Array<{
    name: string;
    configured: boolean;
    reachable: boolean;
  }>;
}
