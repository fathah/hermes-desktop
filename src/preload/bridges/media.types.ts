export interface MediaBridgeApi {
  readMediaFile: (filePath: string) => Promise<string | null>;

  saveMediaFile: (src: string, name: string) => Promise<boolean>;

  mediaFileExists: (filePath: string) => Promise<boolean>;

  showMediaMenu: (
    src: string,
    name: string,
    labels: { open: string; saveAs: string },
  ) => void;

  getPathForFile: (file: File) => string;

  grantPathForFile: (file: File) => Promise<string>;

  stageAttachment: (
    sessionId: string,
    filename: string,
    base64Bytes: string,
  ) => Promise<string>;

  clearStagedAttachments: (sessionId: string) => Promise<void>;

  discoverProviderModels: (
    provider: string,
    baseUrl?: string,
    apiKey?: string,
    profile?: string,
  ) => Promise<{
    models: string[];
    status: "ok" | "no-key" | "unsupported" | "unknown-host";
    cached: boolean;
    /** Subset of `models` flagged as free (Nous Portal today). #367. */
    freeModels?: string[];
  }>;

  onChatChunk: (
    callback: (chunk: string, runId?: string) => void,
  ) => () => void;

  onChatReasoningChunk: (
    callback: (chunk: string, runId?: string) => void,
  ) => () => void;

  onChatDone: (
    callback: (sessionId?: string, runId?: string) => void,
  ) => () => void;

  onContextMenuCopyChat: (
    callback: (format: "text" | "markdown") => void,
  ) => () => void;

  onContextMenuSelectBubble: (
    callback: (point: { x: number; y: number }) => void,
  ) => () => void;

  onChatToolProgress: (
    callback: (tool: string, runId?: string) => void,
  ) => () => void;

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
  ) => () => void;

  onChatError: (
    callback: (error: string, runId?: string) => void,
  ) => () => void;

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
  ) => () => void;

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
  ) => () => void;

  onChatCheckpoint: (
    callback: (cp: {
      id: string;
      label?: string;
      turn?: number;
      createdAt?: string;
      sessionKey?: string;
    }) => void,
  ) => () => void;

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
  ) => () => void;

  // Gateway
}
