export const MINIMAX_SPEECH_MODELS = [
  "speech-2.8-hd",
  "speech-2.8-turbo",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "speech-02-hd",
  "speech-02-turbo",
  "speech-01-hd",
  "speech-01-turbo",
] as const;

export type MiniMaxSpeechModel = (typeof MINIMAX_SPEECH_MODELS)[number];
export type MiniMaxSpeechRegion = "global" | "cn";
export type MiniMaxSpeechFormat = "mp3" | "wav" | "flac" | "pcm";

export const DEFAULT_MINIMAX_SPEECH_MODEL: MiniMaxSpeechModel = "speech-2.8-hd";

export const MINIMAX_SPEECH_ENDPOINTS: Record<MiniMaxSpeechRegion, string> = {
  global: "https://api.minimax.io/v1/t2a_v2",
  cn: "https://api.minimaxi.com/v1/t2a_v2",
};
