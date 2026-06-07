// Shared profile IPC type — single source of truth for the profile list row.
// Producer: src/main/profiles.ts. Contract: src/preload/index.d.ts.
// Consumer: the renderer Agents screen.

export interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}
