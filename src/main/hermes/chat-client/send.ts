import type { Attachment } from "../../../shared/attachments";
import { buildRetrievalSystemMessage } from "../grounding";
import {
  getApiServerAvailable,
  isApiServerReady,
  isGatewayRunning,
  isRemoteMode,
  setApiServerAvailable,
  startGatewayWithRecovery,
  startHealthPolling,
} from "../gateway-process";
import { CHAT_REQUEST_ABORTED_MESSAGE, sendMessageViaApi } from "./api";
import { sendMessageViaCli } from "./cli";
import {
  buildSelfAwarenessSystemMessage,
  type ChatCallbacks,
  type ChatHandle,
} from "./messages";

const LOCAL_GATEWAY_RESTARTED_RESEND_MESSAGE =
  "Local Hermes gateway became unhealthy while processing this message and was restarted. Please resend the message if needed.";

function isLocalApiTransportError(error: string): boolean {
  return /^API request failed:.*\bECONNREFUSED\b/i.test(error);
}

function isLocalGatewayAcceptedError(error: string): boolean {
  return /^API request timed out\. The local Hermes gateway may be unresponsive/i.test(
    error,
  );
}

async function sendMessageViaApiWithLocalRecovery(
  message: string,
  cb: ChatCallbacks,
  profile: string | undefined,
  resumeSessionId: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  attachments: Attachment[] | undefined,
  contextFolder: string | undefined,
  groundingSystem: { role: "system"; content: string } | null,
  selfAwarenessSystem: { role: "system"; content: string } | null,
  modelOverride:
    | { model?: string; provider?: string; baseUrl?: string }
    | undefined,
): Promise<ChatHandle> {
  let aborted = false;
  let recovering = false;
  let retriedTransport = false;
  let sawOutput = false;
  let settled = false;
  let activeHandle: ChatHandle | null = null;

  const recoverAndRetry = async (error: string): Promise<void> => {
    if (aborted || recovering || settled || sawOutput || retriedTransport) {
      if (!settled) {
        settled = true;
        cb.onError(error);
      }
      return;
    }

    recovering = true;
    retriedTransport = true;
    activeHandle?.abort();
    setApiServerAvailable(false);
    const recovered = await startGatewayWithRecovery(profile);
    if (aborted) return;

    if (!recovered) {
      settled = true;
      cb.onError(error);
      return;
    }

    setApiServerAvailable(true);
    recovering = false;
    activeHandle = sendMessageViaApi(
      message,
      callbacks,
      profile,
      resumeSessionId,
      history,
      attachments,
      contextFolder,
      groundingSystem,
      selfAwarenessSystem,
      modelOverride,
    );
  };

  const recoverAndFail = async (error: string): Promise<void> => {
    if (aborted || recovering || settled) return;
    if (sawOutput) {
      settled = true;
      cb.onError(error);
      return;
    }

    recovering = true;
    activeHandle?.abort();
    setApiServerAvailable(false);
    const recovered = await startGatewayWithRecovery(profile);
    if (aborted) return;

    setApiServerAvailable(recovered);
    settled = true;
    cb.onError(recovered ? LOCAL_GATEWAY_RESTARTED_RESEND_MESSAGE : error);
  };

  const callbacks: ChatCallbacks = {
    ...cb,
    onChunk: (text) => {
      sawOutput = true;
      cb.onChunk(text);
    },
    onReasoningChunk: (text) => {
      sawOutput = true;
      cb.onReasoningChunk?.(text);
    },
    onDone: (sessionId) => {
      if (settled) return;
      settled = true;
      cb.onDone(sessionId);
    },
    onError: (error) => {
      if (settled) return;
      if (recovering && error === CHAT_REQUEST_ABORTED_MESSAGE) return;
      if (isLocalApiTransportError(error)) {
        void recoverAndRetry(error);
        return;
      }
      if (isLocalGatewayAcceptedError(error)) {
        void recoverAndFail(error);
        return;
      }
      settled = true;
      cb.onError(error);
    },
  };

  const handle: ChatHandle = {
    abort: () => {
      aborted = true;
      activeHandle?.abort();
    },
  };

  activeHandle = sendMessageViaApi(
    message,
    callbacks,
    profile,
    resumeSessionId,
    history,
    attachments,
    contextFolder,
    groundingSystem,
    selfAwarenessSystem,
    modelOverride,
  );

  return handle;
}

export async function sendMessage(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  attachments?: Attachment[],
  contextFolder?: string,
  groundInWorkspace?: boolean,
  modelOverride?: { model?: string; provider?: string; baseUrl?: string },
): Promise<ChatHandle> {
  startHealthPolling();

  const groundingSystem = groundInWorkspace
    ? await buildRetrievalSystemMessage(message, profile, {
        isRemote: isRemoteMode(),
      })
    : null;

  const selfAwarenessSystem = await buildSelfAwarenessSystemMessage(profile);

  // Remote mode: always use API, no CLI fallback
  if (isRemoteMode()) {
    return sendMessageViaApi(
      message,
      cb,
      profile,
      resumeSessionId,
      history,
      attachments,
      contextFolder,
      groundingSystem,
      selfAwarenessSystem,
      modelOverride,
    );
  }

  let apiServerAvailable = getApiServerAvailable();
  if (apiServerAvailable === null || apiServerAvailable === false) {
    apiServerAvailable = await isApiServerReady(profile);
    if (!apiServerAvailable) {
      apiServerAvailable = await startGatewayWithRecovery(profile);
    }
    setApiServerAvailable(apiServerAvailable);
  } else if (isGatewayRunning(profile)) {
    const healthy = await isApiServerReady(profile);
    apiServerAvailable = healthy || (await startGatewayWithRecovery(profile));
    setApiServerAvailable(apiServerAvailable);
  }

  if (apiServerAvailable) {
    return sendMessageViaApiWithLocalRecovery(
      message,
      cb,
      profile,
      resumeSessionId,
      history,
      attachments,
      contextFolder,
      groundingSystem,
      selfAwarenessSystem,
      modelOverride,
    );
  }

  return sendMessageViaCli(message, cb, profile, resumeSessionId, attachments);
}
