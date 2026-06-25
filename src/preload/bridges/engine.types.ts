import type * as Api from "../api-types";

export interface EngineBridgeApi {
  checkInstall: () => Promise<Api.InstallStatus>;

  verifyInstall: () => Promise<boolean>;

  startInstall: () => Promise<{ success: boolean; error?: string }>;

  inspectInstallTarget: () => Promise<{
    hermesHome: string;
    repoPath: string;
    state: "fresh" | "update" | "replace";
  }>;

  validateHermesHome: (dir: string) => Promise<boolean>;

  adoptHermesHome: (dir: string) => Promise<boolean>;

  quitApp: () => Promise<void>;

  onInstallProgress: (
    callback: (progress: Api.InstallProgress) => void,
  ) => () => void;

  // Hermes engine info

  getHermesVersion: () => Promise<string | null>;

  refreshHermesVersion: () => Promise<string | null>;

  runHermesDoctor: () => Promise<string>;

  runHermesUpdate: () => Promise<{ success: boolean; error?: string }>;

  checkHermesUpdate: () => Promise<{
    available: boolean;
    behindBy?: number;
    localHead?: string;
    upstreamHead?: string;
    reason?: string;
  }>;

  getHermesAgentUpdateRoutine: (
    profile?: string,
  ) => Promise<Api.HermesAgentUpdateRoutineState>;

  setHermesAgentUpdateRoutine: (
    settings: Partial<{ enabled: boolean; autoApply: boolean }>,
    profile?: string,
  ) => Promise<Api.HermesAgentUpdateRoutineState>;

  runHermesAgentUpdateCheck: (
    profile?: string,
    options?: Partial<{ autoApply: boolean }>,
  ) => Promise<Api.HermesAgentUpdateRoutineResult>;

  getHermesUpstreamWatchState: (
    profile?: string,
  ) => Promise<Api.HermesUpstreamWatchState>;

  runHermesUpstreamWatch: (
    profile?: string,
  ) => Promise<Api.HermesUpstreamWatchState>;

  getVoiceStatus: (profile?: string) => Promise<{ hasKey: boolean }>;

  transcribeAudio: (
    audio: ArrayBuffer,
    mime: string,
    profile?: string,
  ) => Promise<{ text?: string; error?: string }>;

  speakText: (
    text: string,
    voice?: string,
    profile?: string,
  ) => Promise<{ audioUrl?: string; error?: string }>;

  onGlobalVoiceTrigger: (callback: () => void) => () => void;

  // OAuth provider sign-in

  oauthLogin: (
    provider: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  cancelOAuthLogin: () => Promise<boolean>;

  onOAuthLoginProgress: (callback: (chunk: string) => void) => () => void;

  getLocale: () => Promise<Api.AppLocale>;

  setLocale: (locale: Api.AppLocale) => Promise<Api.AppLocale>;

  // Configuration (profile-aware)
}
