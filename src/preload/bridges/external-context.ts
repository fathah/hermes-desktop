import { ipcRenderer } from "electron";
import type {
  ExternalConversationMeta,
  ExternalIndexStatus,
  ExternalMessage,
  ExternalScanProgress,
  ExternalSearchHit,
  ExternalSource,
  ExternalSourceConfig,
} from "../../shared/external-context";

/** Renderer bridge for the External Context Bridge (search + viewer + toggles). */
export const externalContextBridge = {
  externalContextGetConfig: (): Promise<ExternalSourceConfig> =>
    ipcRenderer.invoke("external-context-get-config"),

  externalContextSetSource: (
    source: ExternalSource,
    enabled: boolean,
  ): Promise<ExternalSourceConfig> =>
    ipcRenderer.invoke("external-context-set-source", source, enabled),

  externalContextStatus: (): Promise<ExternalIndexStatus> =>
    ipcRenderer.invoke("external-context-status"),

  externalContextScan: (): Promise<ExternalIndexStatus> =>
    ipcRenderer.invoke("external-context-scan"),

  externalContextRebuild: (): Promise<ExternalIndexStatus> =>
    ipcRenderer.invoke("external-context-rebuild"),

  externalContextSetMaxAge: (
    days: number | null,
  ): Promise<ExternalIndexStatus> =>
    ipcRenderer.invoke("external-context-set-max-age", days),

  externalContextSearch: (
    query: string,
    opts?: { source?: ExternalSource; project?: string; limit?: number },
  ): Promise<ExternalSearchHit[]> =>
    ipcRenderer.invoke("external-context-search", query, opts),

  externalContextGetConversation: (
    convId: string,
    opts?: { aroundSeq?: number; limit?: number },
  ): Promise<{
    meta: ExternalConversationMeta | null;
    messages: ExternalMessage[];
  }> => ipcRenderer.invoke("external-context-get-conversation", convId, opts),

  externalContextListProjects: (
    source?: ExternalSource,
  ): Promise<Array<{ projectPath: string; count: number }>> =>
    ipcRenderer.invoke("external-context-list-projects", source),

  externalContextSaveToKb: (
    convId: string,
    profile?: string,
  ): Promise<{
    ok: boolean;
    captureCount: number;
    error?: string;
    changeset?: {
      summary: string;
      pages: Array<{
        op: "create" | "update";
        pageId: string;
        title: string;
        markdown: string;
      }>;
      captures: Array<{ id: string; status: "processed" | "discarded" }>;
      memory: string[];
    };
  }> => ipcRenderer.invoke("external-context-save-to-kb", convId, profile),

  externalContextEnsureMcp: (
    profile?: string,
  ): Promise<{ registered: boolean; alreadyPresent: boolean }> =>
    ipcRenderer.invoke("external-context-ensure-mcp", profile),

  onExternalContextProgress: (
    callback: (progress: ExternalScanProgress) => void,
  ): (() => void) => {
    const handler = (_e: unknown, progress: unknown): void =>
      callback(progress as ExternalScanProgress);
    ipcRenderer.on("external-context-progress", handler);
    return () =>
      ipcRenderer.removeListener("external-context-progress", handler);
  },
};
