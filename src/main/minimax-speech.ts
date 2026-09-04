import { getConfigValue } from "./config";
import { getSecret } from "./secrets";
import {
  DEFAULT_MINIMAX_SPEECH_MODEL,
  MINIMAX_SPEECH_ENDPOINTS,
  MINIMAX_SPEECH_MODELS,
  type MiniMaxSpeechFormat,
  type MiniMaxSpeechModel,
  type MiniMaxSpeechRegion,
} from "../shared/minimax-speech";

const DEFAULT_VOICE_ID = "English_expressive_narrator";
const AUDIO_FORMATS = new Set<MiniMaxSpeechFormat>([
  "mp3",
  "wav",
  "flac",
  "pcm",
]);

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mimeType: string;
}

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
  return AUDIO_FORMATS.has(configured) ? configured : "mp3";
}

function mimeTypeFor(format: MiniMaxSpeechFormat): string {
  if (format === "wav") return "audio/wav";
  if (format === "flac") return "audio/flac";
  if (format === "pcm") return "audio/L16";
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

export async function synthesizeMiniMaxSpeech(
  text: string,
  profile?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SynthesizedSpeech> {
  const input = text.trim();
  if (!input) throw new Error("Speech text is required.");
  if (input.length > 10_000)
    throw new Error("MiniMax speech text cannot exceed 10,000 characters.");

  const { region, keyName, apiKey } = configuredRuntime(profile);
  if (!apiKey)
    throw new Error(`Configure ${keyName} before generating speech.`);

  const model = configuredModel(profile);
  const format = configuredFormat(profile);
  const voiceId =
    (getConfigValue("tts.minimax.voice_id", profile) || "").trim() ||
    DEFAULT_VOICE_ID;
  const response = await fetchImpl(MINIMAX_SPEECH_ENDPOINTS[region], {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      text: input,
      output_format: "hex",
      voice_setting: { voice_id: voiceId },
      audio_setting: { format },
    }),
  });

  if (!response.ok) {
    throw new Error(`MiniMax speech request failed (${response.status}).`);
  }

  let result: MiniMaxSpeechResponse;
  try {
    result = (await response.json()) as MiniMaxSpeechResponse;
  } catch {
    throw new Error("MiniMax speech returned an invalid response.");
  }
  const statusCode = result.base_resp?.status_code;
  if (statusCode !== 0) {
    const message = result.base_resp?.status_msg;
    throw new Error(
      typeof message === "string" && message
        ? `MiniMax speech failed: ${message}`
        : "MiniMax speech request was rejected.",
    );
  }
  if (result.data?.status !== undefined && result.data.status !== 2) {
    throw new Error("MiniMax speech generation did not complete.");
  }

  return {
    audio: decodeHexAudio(result.data?.audio),
    mimeType: mimeTypeFor(format),
  };
}
