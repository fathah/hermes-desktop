import { StreamRedactor } from "./redactor";
import type { Attachment } from "../shared/attachments";
import type { ChatCallbacks, ChatHandle } from "./hermes/chat-client";

/** The chat send transport — structurally `sendMessage` from hermes/chat-client. */
export type ChatTransport = (
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  attachments?: Attachment[],
  contextFolder?: string,
  groundInWorkspace?: boolean,
  modelOverride?: { model?: string; provider?: string; baseUrl?: string },
) => Promise<ChatHandle>;

export type ChatUsageEvent = Parameters<
  NonNullable<ChatCallbacks["onUsage"]>
>[0];

/** Sends events to the renderer. Returns false when the renderer is gone. */
export interface ChatTurnSink {
  emit(channel: string, payload: unknown): boolean;
}

/**
 * Side effects the orchestrator delegates so its streaming/promise/abort core
 * stays pure and testable. The send-message IPC handler binds the real
 * implementations (usage recording, DB persistence, auto-approval + audit,
 * desktop notifications); tests pass spies.
 */
export interface ChatTurnEffects {
  recordUsage(usage: ChatUsageEvent): void;
  persistAssistantMetadata(sessionId: string): void;
  /** Auto-approve the run if policy allows (doing the approval + audit). Returns true if auto-approved. */
  maybeAutoApprove(
    req: Parameters<NonNullable<ChatCallbacks["onApprovalRequest"]>>[0],
  ): boolean;
  playCompletionSound(): void;
  notifyComplete(response: string): void;
  notifyError(error: string): void;
}

export interface ChatTurnRequest {
  message: string;
  profile?: string;
  resumeSessionId?: string;
  history?: Array<{ role: string; content: string }>;
  attachments?: Attachment[];
  contextFolder?: string;
  groundInWorkspace?: boolean;
  clientRunId?: string;
  modelOverride?: { model?: string; provider?: string; baseUrl?: string };
}

export interface ChatTurnContext {
  transport: ChatTransport;
  sink: ChatTurnSink;
  effects: ChatTurnEffects;
  /** Shared abort registry (keyed by sessionKey); also used by the abort-chat handler. */
  abortRegistry: Map<string, () => void>;
  sessionKey: string;
  secretsToRedact: string[];
}

/**
 * Drive a single chat turn: dedupe against an in-flight turn for the same
 * session, stream redacted content/reasoning to the renderer, fan out tool /
 * usage / approval / checkpoint / delegate events, persist completion metadata,
 * and resolve with the full response. Returns the response promise (the abort
 * is registered in `ctx.abortRegistry` before this resolves).
 */
export async function runChatTurn(
  req: ChatTurnRequest,
  ctx: ChatTurnContext,
): Promise<{ response: string; sessionId?: string }> {
  const {
    transport,
    sink,
    effects,
    abortRegistry,
    sessionKey,
    secretsToRedact,
  } = ctx;

  const existing = abortRegistry.get(sessionKey);
  if (existing) {
    existing();
  }

  let fullResponse = "";
  let resolveChat: (v: { response: string; sessionId?: string }) => void;
  let rejectChat: (reason?: unknown) => void;
  const promise = new Promise<{ response: string; sessionId?: string }>(
    (res, rej) => {
      resolveChat = res;
      rejectChat = rej;
    },
  );

  const contentRedactor = new StreamRedactor(secretsToRedact, {
    redactShortSecrets: true,
  });
  const reasoningRedactor = new StreamRedactor(secretsToRedact, {
    redactShortSecrets: true,
  });
  let handle: { abort: () => void } | null = null;
  let abortRequestedBeforeHandle = false;
  const abortCurrent = (): void => {
    if (handle) {
      handle.abort();
    } else {
      abortRequestedBeforeHandle = true;
    }
  };
  const clearAbort = (): void => {
    if (abortRegistry.get(sessionKey) === abortCurrent) {
      abortRegistry.delete(sessionKey);
    }
  };

  abortRegistry.set(sessionKey, abortCurrent);

  handle = await transport(
    req.message,
    {
      onChunk: (chunk) => {
        const { chunkToEmit } = contentRedactor.process(chunk);
        if (chunkToEmit) {
          fullResponse += chunkToEmit;
          if (!sink.emit("chat-chunk", chunkToEmit)) {
            const abort = abortRegistry.get(sessionKey);
            if (abort) abort();
          }
        }
      },
      onReasoningChunk: (chunk) => {
        const { chunkToEmit } = reasoningRedactor.process(chunk);
        if (chunkToEmit) {
          if (!sink.emit("chat-reasoning-chunk", chunkToEmit)) {
            const abort = abortRegistry.get(sessionKey);
            if (abort) abort();
          }
        }
      },
      onDone: (sessionId) => {
        const contentFlush = contentRedactor.flush();
        if (contentFlush) {
          fullResponse += contentFlush;
          sink.emit("chat-chunk", contentFlush);
        }
        const reasoningFlush = reasoningRedactor.flush();
        if (reasoningFlush) {
          sink.emit("chat-reasoning-chunk", reasoningFlush);
        }
        clearAbort();
        sink.emit("chat-done", sessionId || "");

        if (sessionId) {
          effects.persistAssistantMetadata(sessionId);
        }

        effects.playCompletionSound();
        resolveChat({ response: fullResponse, sessionId });
        effects.notifyComplete(fullResponse);
      },
      onError: (error) => {
        contentRedactor.flush();
        reasoningRedactor.flush();
        clearAbort();
        sink.emit("chat-error", error);
        rejectChat(new Error(error));
        effects.notifyError(error);
      },
      onToolProgress: (tool) => {
        sink.emit("chat-tool-progress", tool);
      },
      onUsage: (usage) => {
        sink.emit("chat-usage", usage);
        effects.recordUsage(usage);
      },
      onApprovalRequest: (request) => {
        if (effects.maybeAutoApprove(request)) {
          sink.emit("chat-approval-auto", { ...request, sessionKey });
          return;
        }
        sink.emit("chat-approval-request", { ...request, sessionKey });
      },
      onCheckpoint: (cp) => {
        sink.emit("chat-checkpoint", { ...cp, sessionKey });
      },
      onDelegateProgress: (p) => {
        sink.emit("chat-delegate-progress", { ...p, sessionKey });
      },
    },
    req.profile,
    req.resumeSessionId,
    req.history,
    req.attachments,
    req.contextFolder,
    req.groundInWorkspace,
    req.modelOverride,
  );

  if (
    abortRegistry.get(sessionKey) === abortCurrent &&
    abortRequestedBeforeHandle
  ) {
    handle.abort();
  }
  return promise;
}
