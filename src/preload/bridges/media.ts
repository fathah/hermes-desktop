import { ipcRenderer, webUtils } from "electron";
import type { MediaBridgeApi } from "./media.types";

export const mediaBridge = {
  // Media (agent-generated images / files — issue #299)
  readMediaFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("read-media-file", filePath),
  saveMediaFile: (src: string, name: string): Promise<boolean> =>
    ipcRenderer.invoke("save-media-file", src, name),
  mediaFileExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke("media-file-exists", filePath),
  showMediaMenu: (
    src: string,
    name: string,
    labels: { open: string; saveAs: string },
  ): void => {
    ipcRenderer.send("show-media-menu", src, name, labels);
  },

  // Resolve the absolute filesystem path for a File coming from drag-drop
  // or the file picker.  Returns "" for blobs that have no origin path
  // (e.g. clipboard paste) — caller should stageAttachment for those.
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },

  grantPathForFile: (file: File): Promise<string> => {
    let path = "";
    try {
      path = webUtils.getPathForFile(file) || "";
    } catch {
      path = "";
    }
    return path
      ? ipcRenderer.invoke("grant-file-path", path)
      : Promise.resolve("");
  },

  stageAttachment: (
    sessionId: string,
    filename: string,
    base64Bytes: string,
  ): Promise<string> =>
    ipcRenderer.invoke("stage-attachment", sessionId, filename, base64Bytes),

  clearStagedAttachments: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("clear-staged-attachments", sessionId),

  discoverProviderModels: (
    provider: string,
    baseUrl?: string,
    apiKey?: string,
    profile?: string,
  ): Promise<{
    models: string[];
    status: "ok" | "no-key" | "unsupported" | "unknown-host";
    cached: boolean;
    /** Subset of `models` flagged as free per the provider catalog
     *  (Nous Portal today). Optional — providers without pricing
     *  metadata return undefined. Issue #367. */
    freeModels?: string[];
  }> =>
    ipcRenderer.invoke(
      "discover-provider-models",
      provider,
      baseUrl,
      apiKey,
      profile,
    ),

  onChatChunk: (
    callback: (chunk: string, runId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      chunk: string,
      runId?: string,
    ): void => callback(chunk, runId);
    ipcRenderer.on("chat-chunk", handler);
    return () => ipcRenderer.removeListener("chat-chunk", handler);
  },

  /** Streaming reasoning / thinking tokens — separate from `onChatChunk`
   *  so the renderer can render a "thinking" bubble that grows
   *  independently of the assistant's content (#352). */
  onChatReasoningChunk: (
    callback: (chunk: string, runId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      chunk: string,
      runId?: string,
    ): void => callback(chunk, runId);
    ipcRenderer.on("chat-reasoning-chunk", handler);
    return () => ipcRenderer.removeListener("chat-reasoning-chunk", handler);
  },

  onChatDone: (
    callback: (sessionId?: string, runId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      sessionId?: string,
      runId?: string,
    ): void => callback(sessionId, runId);
    ipcRenderer.on("chat-done", handler);
    return () => ipcRenderer.removeListener("chat-done", handler);
  },

  onContextMenuCopyChat: (
    callback: (format: "text" | "markdown") => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      format: "text" | "markdown",
    ): void => callback(format);
    ipcRenderer.on("context-menu-copy-chat", handler);
    return () => ipcRenderer.removeListener("context-menu-copy-chat", handler);
  },

  onContextMenuSelectBubble: (
    callback: (point: { x: number; y: number }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      point: { x: number; y: number },
    ): void => callback(point);
    ipcRenderer.on("context-menu-select-bubble", handler);
    return () =>
      ipcRenderer.removeListener("context-menu-select-bubble", handler);
  },

  onChatToolProgress: (
    callback: (tool: string, runId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      tool: string,
      runId?: string,
    ): void => callback(tool, runId);
    ipcRenderer.on("chat-tool-progress", handler);
    return () => ipcRenderer.removeListener("chat-tool-progress", handler);
  },

  onChatUsage: (
    callback: (
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost?: number;
        rateLimitRemaining?: number;
        rateLimitReset?: number;
        model?: string;
        sessionId?: string;
        cacheRead?: number;
        cacheWrite?: number;
      },
      runId?: string,
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      usage: unknown,
      runId?: string,
    ): void => callback(usage as Parameters<typeof callback>[0], runId);
    ipcRenderer.on("chat-usage", handler);
    return () => ipcRenderer.removeListener("chat-usage", handler);
  },

  onChatError: (
    callback: (error: string, runId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      error: string,
      runId?: string,
    ): void => callback(error, runId);
    ipcRenderer.on("chat-error", handler);
    return () => ipcRenderer.removeListener("chat-error", handler);
  },

  /** Gateway requested approval for a dangerous command (idea B1). The
   *  renderer renders an approval card and replies via `respondApproval`. */
  onChatApprovalRequest: (
    callback: (
      req: {
        id: string;
        command?: string;
        toolName?: string;
        patternKey?: string;
        description?: string;
        sessionKey?: string;
      },
      runId?: string,
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      req: unknown,
      runId?: string,
    ): void => callback(req as Parameters<typeof callback>[0], runId);
    ipcRenderer.on("chat-approval-request", handler);
    return () => ipcRenderer.removeListener("chat-approval-request", handler);
  },

  /** A dangerous-command approval that scoped-autonomy auto-resolved (M2B).
   *  Carries the same req shape so the renderer can show an audit notice. */
  onChatApprovalAuto: (
    callback: (
      req: {
        id: string;
        command?: string;
        toolName?: string;
        patternKey?: string;
        description?: string;
        sessionKey?: string;
      },
      runId?: string,
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      req: unknown,
      runId?: string,
    ): void => callback(req as Parameters<typeof callback>[0], runId);
    ipcRenderer.on("chat-approval-auto", handler);
    return () => ipcRenderer.removeListener("chat-approval-auto", handler);
  },

  /** Gateway recorded a filesystem checkpoint (idea B2). */
  onChatCheckpoint: (
    callback: (cp: {
      id: string;
      label?: string;
      turn?: number;
      createdAt?: string;
      sessionKey?: string;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, cp: unknown): void =>
      callback(cp as Parameters<typeof callback>[0]);
    ipcRenderer.on("chat-checkpoint", handler);
    return () => ipcRenderer.removeListener("chat-checkpoint", handler);
  },

  /** A delegated subagent reported progress (idea B3). */
  onChatDelegateProgress: (
    callback: (p: {
      id: string;
      parentId?: string;
      goal?: string;
      status: string;
      depth?: number;
      tool?: string;
      label?: string;
      sessionKey?: string;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, p: unknown): void =>
      callback(p as Parameters<typeof callback>[0]);
    ipcRenderer.on("chat-delegate-progress", handler);
    return () => ipcRenderer.removeListener("chat-delegate-progress", handler);
  },
} satisfies MediaBridgeApi;
