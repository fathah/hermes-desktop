// Shared install IPC types — single source of truth for the installer flow.
// Imported by src/main/installer.ts (producer), src/preload/index.d.ts (the
// renderer-facing contract) and the renderer Install screen (consumer).

export interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
  activeProfile?: string;
}

export interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}
