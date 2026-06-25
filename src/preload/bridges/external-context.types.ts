import type * as Api from "../api-types";

export interface ExternalContextBridgeApi {
  externalContextGetConfig: () => Promise<Api.ExternalSourceConfig>;

  externalContextSetSource: (
    source: Api.ExternalSource,
    enabled: boolean,
  ) => Promise<Api.ExternalSourceConfig>;

  externalContextStatus: () => Promise<Api.ExternalIndexStatus>;

  externalContextScan: () => Promise<Api.ExternalIndexStatus>;

  externalContextRebuild: () => Promise<Api.ExternalIndexStatus>;

  externalContextPickFile: () => Promise<string | null>;

  externalContextImportFile: (
    source: Api.ExternalImportSource,
    filePath: string,
  ) => Promise<Api.ExternalImportResult>;

  externalContextImportPaste: (
    text: string,
    origin: string,
  ) => Promise<Api.ExternalImportResult>;

  externalContextSetMaxAge: (
    days: number | null,
  ) => Promise<Api.ExternalIndexStatus>;

  externalContextSearch: (
    query: string,
    opts?: { source?: Api.ExternalSource; project?: string; limit?: number },
  ) => Promise<Api.ExternalSearchHit[]>;

  externalContextGetConversation: (
    convId: string,
    opts?: { aroundSeq?: number; limit?: number },
  ) => Promise<{
    meta: Api.ExternalConversationMeta | null;
    messages: Api.ExternalMessage[];
  }>;

  externalContextListProjects: (
    source?: Api.ExternalSource,
  ) => Promise<Array<{ projectPath: string; count: number }>>;

  externalContextSaveToKb: (
    convId: string,
    profile?: string,
  ) => Promise<{
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
  }>;

  externalContextEnsureMcp: (
    profile?: string,
  ) => Promise<{ registered: boolean; alreadyPresent: boolean }>;

  onExternalContextProgress: (
    callback: (progress: Api.ExternalScanProgress) => void,
  ) => () => void;
}
