import { getConfigValue } from "./config";
import { getSecret } from "./secrets";
import {
  DEFAULT_MINIMAX_SPEECH_MODEL,
  MINIMAX_SPEECH_ENDPOINTS,
  MINIMAX_SPEECH_MODELS,
  type MiniMaxSpeechFormat,
  type MiniMaxSpeechModel,
  type MiniMaxSpeechRegion,
  type SynthesizedSpeech,
} from "../shared/minimax-speech";

const DEFAULT_VOICE_ID = "English_expressive_narrator";
const AUDIO_FORMATS = new Set<MiniMaxSpeechFormat>(["mp3", "wav", "flac"]);

interface MiniMaxSpeechResponse {
  data?: { audio?: unknown; status?: unknown };
  base_resp?: { status_code?: unknown; status_msg?: unknown };
}

function configuredRuntime(profile?: string): {
  region: MiniMaxSpeechRegion;
  keyName: "MINIMAX_API_KEY" | "MINIMAX_CN_API_KEY";
  apiKey: string | null;
} {
  const configured = (getConfigValue("tts.minimax.region", profile) || "")
    .trim()
    .toLowerCase();
  if (configured === "cn") {
    return {
      region: "cn",
      keyName: "MINIMAX_CN_API_KEY",
      apiKey: getSecret("MINIMAX_CN_API_KEY", profile),
    };
  }
  if (configured === "global") {
    return {
      region: "global",
      keyName: "MINIMAX_API_KEY",
      apiKey: getSecret("MINIMAX_API_KEY", profile),
    };
  }
  if (configured)
    throw new Error("Configure MiniMax speech region as global or cn.");
  const globalKey = getSecret("MINIMAX_API_KEY", profile);
  if (globalKey) {
    return {
      region: "global",
      keyName: "MINIMAX_API_KEY",
      apiKey: globalKey,
    };
  }
  return {
    region: "cn",
    keyName: "MINIMAX_CN_API_KEY",
    apiKey: getSecret("MINIMAX_CN_API_KEY", profile),
  };
}

function configuredModel(profile?: string): MiniMaxSpeechModel {
  const configured = (
    getConfigValue("tts.minimax.model", profile) || ""
  ).trim();
  return MINIMAX_SPEECH_MODELS.includes(configured as MiniMaxSpeechModel)
    ? (configured as MiniMaxSpeechModel)
    : DEFAULT_MINIMAX_SPEECH_MODEL;
}

function configuredFormat(profile?: string): MiniMaxSpeechFormat {
  const configured = (getConfigValue("tts.minimax.format", profile) || "")
    .trim()
    .toLowerCase() as MiniMaxSpeechFormat;
  if (configured && !AUDIO_FORMATS.has(configured)) {
    throw new Error(
      "MiniMax playback requires mp3, wav, or flac; raw PCM is unsupported.",
    );
  }
  return configured || "mp3";
}

function mimeTypeFor(format: MiniMaxSpeechFormat): string {
  if (format === "wav") return "audio/wav";
  if (format === "flac") return "audio/flac";
  return "audio/mpeg";
}

function decodeHexAudio(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(value)
  ) {
    throw new Error("MiniMax speech returned invalid audio data.");
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

export const SPEECH_TIMEOUT_MS = 45_000;

// @lat: [[speech-playback#Bounded encoded synthesis]]
export async function synthesizeMiniMaxSpeech(
  text: string,
  profile?: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SynthesizedSpeech> {
  if (signal?.aborted) throw new Error("Speech generation was cancelled.");
  const input = typeof text === "string" ? text.trim() : "";
  if (!input) throw new Error("Speech text is required.");
  if (input.length >= 10_000)
    throw new Error(
      "MiniMax speech text must be shorter than 10,000 characters.",
    );

  const { region, keyName, apiKey } = configuredRuntime(profile);
  if (!apiKey)
    throw new Error(`Configure ${keyName} before generating speech.`);
  const model = configuredModel(profile);
  const format = configuredFormat(profile);
  const voiceId =
    (getConfigValue("tts.minimax.voice_id", profile) || "").trim() ||
    DEFAULT_VOICE_ID;
  const controller = new AbortController();
  let timedOut = false;
  let rejectCancellation: (error: Error) => void = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const cancelled = (): void => {
    rejectCancellation(
      new Error(
        timedOut
          ? "Speech generation timed out; try again."
          : "Speech generation was cancelled.",
      ),
    );
  };
  controller.signal.addEventListener("abort", cancelled, { once: true });
  const abort = (): void => {
    controller.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SPEECH_TIMEOUT_MS);
  try {
    return await Promise.race([
      cancellation,
      (async (): Promise<SynthesizedSpeech> => {
        const response = await fetchImpl(MINIMAX_SPEECH_ENDPOINTS[region], {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            text: input,
            stream: false,
            output_format: "hex",
            voice_setting: { voice_id: voiceId },
            audio_setting: { format },
          }),
        });
        if (!response.ok)
          throw new Error(
            `MiniMax speech request failed (${response.status}).`,
          );
        let result: MiniMaxSpeechResponse;
        try {
          result = (await response.json()) as MiniMaxSpeechResponse;
          if (!result || typeof result !== "object")
            throw new Error("Invalid JSON result");
        } catch {
          throw new Error("MiniMax speech returned an invalid response.");
        }
        if (controller.signal.aborted)
          throw new Error("Speech generation was cancelled.");
        if (result.base_resp?.status_code !== 0) {
          const message = result.base_resp?.status_msg;
          throw new Error(
            typeof message === "string" && message
              ? `MiniMax speech failed: ${message}`
              : "MiniMax speech request was rejected.",
          );
        }
        if (result.data?.status !== undefined && result.data.status !== 2)
          throw new Error("MiniMax speech generation did not complete.");
        return {
          audio: decodeHexAudio(result.data?.audio),
          mimeType: mimeTypeFor(format),
        };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", cancelled);
  }
}
