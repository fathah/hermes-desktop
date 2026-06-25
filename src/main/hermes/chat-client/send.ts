import type { Attachment } from "../../../shared/attachments";
import { buildRetrievalSystemMessage } from "../grounding";
import {
  getApiServerAvailable,
  isApiServerReady,
  isGatewayRunning,
  isRemoteMode,
  setApiServerAvailable,
  startHealthPolling,
  waitForApiServerReady,
} from "../gateway-process";
import { sendMessageViaApi } from "./api";
import { sendMessageViaCli } from "./cli";
import {
  buildSelfAwarenessSystemMessage,
  type ChatCallbacks,
  type ChatHandle,
} from "./messages";

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
  const localGatewayRunning = !isRemoteMode() && isGatewayRunning(profile);
  if (
    apiServerAvailable === null ||
    apiServerAvailable === false ||
    localGatewayRunning
  ) {
    apiServerAvailable = await isApiServerReady(profile);
    if (!apiServerAvailable && localGatewayRunning) {
      apiServerAvailable = await waitForApiServerReady(8000, profile);
    }
    setApiServerAvailable(apiServerAvailable);
  }

  if (apiServerAvailable) {
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

  return sendMessageViaCli(message, cb, profile, resumeSessionId, attachments);
}
