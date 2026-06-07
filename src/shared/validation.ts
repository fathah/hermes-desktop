// Shared chat-readiness IPC types — single source of truth for the pre-send
// validation result. Producer: src/main/validation.ts. Contract: preload/index.d.ts.

export type ChatReadinessCode =
  | "NO_ACTIVE_MODEL"
  | "NO_PROVIDER"
  | "NO_BASE_URL"
  | "MISSING_API_KEY"
  | "GATEWAY_DOWN";

export type FixLocation = "providers" | "models" | "gateway" | "setup";

export interface ChatReadiness {
  ok: boolean;
  code?: ChatReadinessCode;
  /** Stable English message — the renderer maps to i18n by code. */
  message?: string;
  /** Where to send the user to resolve it. */
  fixLocation?: FixLocation;
  /** Env var name the user is expected to populate, if applicable. */
  expectedEnvKey?: string;
}
