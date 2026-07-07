import { ipcRenderer } from "electron";
import type { AppLocale } from "../../shared/i18n/types";
import type { EngineBridgeApi } from "./engine.types";

export const engineBridge = {
  // Installation
  checkInstall: (() =>
    ipcRenderer.invoke("check-install")) as EngineBridgeApi["checkInstall"],

  verifyInstall: (): Promise<boolean> => ipcRenderer.invoke("verify-install"),

  startInstall: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("start-install"),

  // Pre-install inspection + "use an existing installation" (issue #272)
  inspectInstallTarget: (): Promise<{
    hermesHome: string;
    repoPath: string;
    state: "fresh" | "update" | "replace";
  }> => ipcRenderer.invoke("inspect-install-target"),

  validateHermesHome: (dir: string): Promise<boolean> =>
    ipcRenderer.invoke("validate-hermes-home", dir),

  adoptHermesHome: (dir: string): Promise<boolean> =>
    ipcRenderer.invoke("adopt-hermes-home", dir),

  quitApp: (): Promise<void> => ipcRenderer.invoke("quit-app"),

  onInstallProgress: (
    callback: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: unknown,
    ): void =>
      callback(
        progress as {
          step: number;
          totalSteps: number;
          title: string;
          detail: string;
          log: string;
        },
      );
    ipcRenderer.on("install-progress", handler);
    return () => ipcRenderer.removeListener("install-progress", handler);
  },

  // Hermes engine info
  getHermesVersion: (): Promise<string | null> =>
    ipcRenderer.invoke("get-hermes-version"),
  refreshHermesVersion: (): Promise<string | null> =>
    ipcRenderer.invoke("refresh-hermes-version"),
  runHermesDoctor: (): Promise<string> =>
    ipcRenderer.invoke("run-hermes-doctor"),
  runHermesUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("run-hermes-update"),
  checkHermesUpdate: (): Promise<{
    available: boolean;
    behindBy?: number;
    localHead?: string;
    upstreamHead?: string;
    reason?: string;
  }> => ipcRenderer.invoke("check-hermes-update"),
  getHermesAgentUpdateRoutine: ((profile?: string) =>
    ipcRenderer.invoke(
      "get-hermes-agent-update-routine",
      profile,
    )) as EngineBridgeApi["getHermesAgentUpdateRoutine"],
  setHermesAgentUpdateRoutine: ((
    settings: Partial<{
      enabled: boolean;
      autoApply: boolean;
      engineUpdateChannel: "release" | "main";
    }>,
    profile?: string,
  ) =>
    ipcRenderer.invoke(
      "set-hermes-agent-update-routine",
      settings,
      profile,
    )) as EngineBridgeApi["setHermesAgentUpdateRoutine"],
  runHermesAgentUpdateCheck: ((
    profile?: string,
    options?: Partial<{ autoApply: boolean }>,
  ) =>
    ipcRenderer.invoke(
      "run-hermes-agent-update-check",
      profile,
      options,
    )) as EngineBridgeApi["runHermesAgentUpdateCheck"],
  acknowledgeHermesAgentUpdateContractBreak: ((profile?: string) =>
    ipcRenderer.invoke(
      "acknowledge-hermes-agent-update-contract-break",
      profile,
    )) as EngineBridgeApi["acknowledgeHermesAgentUpdateContractBreak"],
  rollbackEngine: ((profile?: string) =>
    ipcRenderer.invoke(
      "rollback-engine",
      profile,
    )) as EngineBridgeApi["rollbackEngine"],
  getHermesUpstreamWatchState: ((profile?: string) =>
    ipcRenderer.invoke(
      "get-hermes-upstream-watch-state",
      profile,
    )) as EngineBridgeApi["getHermesUpstreamWatchState"],
  runHermesUpstreamWatch: ((profile?: string) =>
    ipcRenderer.invoke(
      "run-hermes-upstream-watch",
      profile,
    )) as EngineBridgeApi["runHermesUpstreamWatch"],
  getEngineCapabilities: (profile?: string) =>
    ipcRenderer.invoke("get-engine-capabilities", profile),
  refreshEngineCapabilities: (profile?: string) =>
    ipcRenderer.invoke("refresh-engine-capabilities", profile),
  verifyEngineContract: (profile?: string) =>
    ipcRenderer.invoke("verify-engine-contract", profile),

  // Voice I/O (WS4)
  getVoiceStatus: (profile?: string): Promise<{ hasKey: boolean }> =>
    ipcRenderer.invoke("get-voice-status", profile),
  transcribeAudio: (
    audio: ArrayBuffer,
    mime: string,
    profile?: string,
  ): Promise<{ text?: string; error?: string }> =>
    ipcRenderer.invoke("transcribe-audio", audio, mime, profile),
  speakText: (
    text: string,
    voice?: string,
    profile?: string,
  ): Promise<{ audioUrl?: string; error?: string }> =>
    ipcRenderer.invoke("speak-text", text, voice, profile),
  onGlobalVoiceTrigger: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("global-voice-trigger", handler);
    return () => ipcRenderer.removeListener("global-voice-trigger", handler);
  },

  // OAuth provider sign-in
  oauthLogin: (
    provider: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("oauth-login", provider, profile),
  cancelOAuthLogin: (): Promise<boolean> =>
    ipcRenderer.invoke("oauth-login-cancel"),
  onOAuthLoginProgress: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: unknown): void =>
      callback(String(chunk));
    ipcRenderer.on("oauth-login-progress", handler);
    return () => ipcRenderer.removeListener("oauth-login-progress", handler);
  },

  getLocale: (): Promise<AppLocale> => ipcRenderer.invoke("get-locale"),
  setLocale: (locale: AppLocale): Promise<AppLocale> =>
    ipcRenderer.invoke("set-locale", locale),
} satisfies EngineBridgeApi;
