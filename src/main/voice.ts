// Voice I/O (WS4): speech-to-text and text-to-speech for the desktop chat.
//
// The Hermes gateway is an OpenAI-compatible *chat* server with no audio API
// ("audio_api": false in /v1/capabilities), so we call OpenAI's audio
// endpoints directly with the user's VOICE_TOOLS_OPENAI_KEY — the same key the
// gateway's voice *tool* uses. The key is read here in the main process and
// never crosses to the renderer. All functions are non-throwing: they resolve
// to `{ error }` so the renderer can surface a message without a crash.

import { readEnv } from "./config";

const OPENAI_AUDIO_BASE = "https://api.openai.com/v1/audio";
const STT_MODEL = "whisper-1";
const TTS_MODEL = "tts-1";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // OpenAI transcription upload cap
const MAX_TTS_CHARS = 4096; // OpenAI speech input cap

const VALID_VOICES = new Set([
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
]);

/** Map a recorder MIME type to a filename OpenAI will accept by extension. */
export function audioFilename(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("webm")) return "audio.webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) {
    return "audio.m4a";
  }
  if (m.includes("mpeg") || m.includes("mp3")) return "audio.mp3";
  if (m.includes("wav")) return "audio.wav";
  if (m.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}

/** Clamp to OpenAI's supported voice set; default to a neutral voice. */
export function normalizeVoice(voice?: string): string {
  return voice && VALID_VOICES.has(voice) ? voice : "alloy";
}

function voiceKey(profile?: string): string {
  return (readEnv(profile).VOICE_TOOLS_OPENAI_KEY ?? "").trim();
}

export interface VoiceStatus {
  hasKey: boolean;
}

/** Whether voice is configured for this profile (gates the renderer buttons). */
export function getVoiceStatus(profile?: string): VoiceStatus {
  return { hasKey: voiceKey(profile).length > 0 };
}

export interface TranscribeResult {
  text?: string;
  error?: string;
}

/** Transcribe recorded audio to text via OpenAI Whisper. */
export async function transcribeAudio(
  audio: ArrayBuffer,
  mime: string,
  profile?: string,
): Promise<TranscribeResult> {
  const key = voiceKey(profile);
  if (!key) return { error: "VOICE_TOOLS_OPENAI_KEY not set" };
  if (!audio || audio.byteLength === 0) return { error: "No audio captured" };
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return { error: "Recording too long (max 25 MB)" };
  }
  try {
    const form = new FormData();
    const blob = new Blob([audio], { type: mime || "audio/webm" });
    form.append("file", blob, audioFilename(mime));
    form.append("model", STT_MODEL);
    const res = await fetch(`${OPENAI_AUDIO_BASE}/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        error: `Transcription failed (${res.status})${
          detail ? `: ${detail.slice(0, 200)}` : ""
        }`,
      };
    }
    const json = (await res.json()) as { text?: string };
    return { text: json.text ?? "" };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface SpeakResult {
  /** data:audio/mpeg;base64,… — playable via `new Audio(url)` in the renderer. */
  audioUrl?: string;
  error?: string;
}

/** Synthesize speech for `text` via OpenAI TTS; returns a base64 audio data URL. */
export async function speakText(
  text: string,
  voice: string | undefined,
  profile?: string,
): Promise<SpeakResult> {
  const key = voiceKey(profile);
  if (!key) return { error: "VOICE_TOOLS_OPENAI_KEY not set" };
  const input = (text ?? "").trim();
  if (!input) return { error: "Nothing to speak" };
  try {
    const res = await fetch(`${OPENAI_AUDIO_BASE}/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: normalizeVoice(voice),
        input: input.slice(0, MAX_TTS_CHARS),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        error: `Speech failed (${res.status})${
          detail ? `: ${detail.slice(0, 200)}` : ""
        }`,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { audioUrl: `data:audio/mpeg;base64,${buf.toString("base64")}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
