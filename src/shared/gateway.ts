// Shared gateway health vocabulary — imported by main (supervisor + effects),
// preload (bridge), and renderer (hook). Kept in src/shared so neither the
// preload nor the renderer has to reach into src/main.

export type GatewayHealthStatus =
  | "healthy"
  | "unhealthy"
  | "recovering"
  | "down";

export interface GatewayHealthChange {
  status: GatewayHealthStatus;
}

export interface GatewayStartResult {
  success: boolean;
  running: boolean;
  alreadyRunning?: boolean;
  error?: string;
  logPath?: string;
  port?: number;
  portRelocation?: {
    profile: string;
    oldPort: number;
    newPort: number;
    reason: string;
    nextAction: string;
  };
}
