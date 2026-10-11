import type { WebContents } from "electron";
import {
  getActiveConnection,
  getConnectionConfig,
  getConfigValue,
  setMiniMaxSpeechConfigValue,
} from "./config";
import { providerTargetRevision } from "./provider-request-target";
import { isValidProfileName } from "./utils";
import { synthesizeMiniMaxSpeech } from "./minimax-speech";
import {
  DEFAULT_MINIMAX_SPEECH_MODEL,
  MINIMAX_SPEECH_MODELS,
  type MiniMaxSpeechModel,
  type SpeechConfigSetting,
  type SpeechRequest,
  type SpeechSettings,
  type SynthesizedSpeech,
} from "../shared/minimax-speech";
import type { ProviderRequestTarget } from "../shared/provider-target";

type SpeechOwner = Pick<
  WebContents,
  "id" | "once" | "removeListener" | "isDestroyed"
>;
const requests = new Map<
  number,
  { requestId: string; controller: AbortController }
>();

// @lat: [[speech-playback#Local target authority]]
function assertSpeechTarget(
  profile: unknown,
  target: ProviderRequestTarget,
): void {
  if (!isValidProfileName(profile))
    throw new Error("An explicit valid speech profile is required.");
  if (
    !target ||
    typeof target.connectionId !== "string" ||
    !target.connectionId
  ) {
    throw new Error("An explicit speech connection is required.");
  }
  const connection = getConnectionConfig(target.connectionId);
  if (connection.mode !== "local" || target.mode !== "local") {
    throw new Error("Speech playback is available only on a Local connection.");
  }
  if (
    getActiveConnection().connectionId !== target.connectionId ||
    target.revision !== providerTargetRevision(connection)
  ) {
    throw new Error("Speech connection changed; reload and retry.");
  }
}

export function getSpeechConfig(
  profile: string,
  target: ProviderRequestTarget,
): SpeechSettings {
  assertSpeechTarget(profile, target);
  const model = getConfigValue("tts.minimax.model", profile);
  const region = getConfigValue("tts.minimax.region", profile);
  return {
    model: MINIMAX_SPEECH_MODELS.includes(model as MiniMaxSpeechModel)
      ? (model as MiniMaxSpeechModel)
      : DEFAULT_MINIMAX_SPEECH_MODEL,
    region: region === "cn" || region === "global" ? region : "",
  };
}

export function setSpeechConfig(
  setting: SpeechConfigSetting,
  value: string,
  profile: string,
  target: ProviderRequestTarget,
): boolean {
  assertSpeechTarget(profile, target);
  if (
    setting === "model"
      ? !MINIMAX_SPEECH_MODELS.includes(value as MiniMaxSpeechModel)
      : setting !== "region" || !["", "global", "cn"].includes(value)
  ) {
    throw new Error("Invalid MiniMax speech setting.");
  }
  setMiniMaxSpeechConfigValue(setting, value, profile);
  return true;
}

// @lat: [[speech-playback#Owned synthesis cancellation]]
export async function runSpeechRequest(
  owner: SpeechOwner,
  request: SpeechRequest,
): Promise<SynthesizedSpeech> {
  assertSpeechTarget(request?.profile, request?.target);
  if (
    typeof request.requestId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(request.requestId)
  ) {
    throw new Error("A valid speech request ID is required.");
  }
  if (owner.isDestroyed()) throw new Error("Speech window is closed.");
  requests.get(owner.id)?.controller.abort();
  const pending = {
    requestId: request.requestId,
    controller: new AbortController(),
  };
  requests.set(owner.id, pending);
  const destroyed = (): void => {
    pending.controller.abort();
  };
  owner.once("destroyed", destroyed);
  try {
    const result = await synthesizeMiniMaxSpeech(
      request.text,
      request.profile,
      fetch,
      pending.controller.signal,
    );
    if (pending.controller.signal.aborted)
      throw new Error("Speech generation was cancelled.");
    assertSpeechTarget(request.profile, request.target);
    return result;
  } finally {
    owner.removeListener("destroyed", destroyed);
    if (requests.get(owner.id) === pending) requests.delete(owner.id);
  }
}

export function cancelSpeechRequest(
  ownerId: number,
  requestId: string,
): boolean {
  const pending = requests.get(ownerId);
  if (!pending || pending.requestId !== requestId) return false;
  pending.controller.abort();
  return true;
}
