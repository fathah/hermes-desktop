import type { SynthesizedSpeech } from "../../../../shared/minimax-speech";

type Stage = "idle" | "loading" | "playing";
interface Snapshot {
  owner: string | null;
  stage: Stage;
  error: string | null;
}
interface Playback {
  owner: string;
  requestId: string;
  dispatched: boolean;
  audio?: HTMLAudioElement;
  url?: string;
}
let current: Playback | null = null;
let snapshot: Snapshot = { owner: null, stage: "idle", error: null };
const listeners = new Set<() => void>();
let disconnect: (() => void) | undefined;
function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}
function dispose(playback: Playback): void {
  if (playback.audio) {
    playback.audio.onended = null;
    playback.audio.onerror = null;
    playback.audio.pause();
  }
  if (playback.url) URL.revokeObjectURL(playback.url);
  if (playback.dispatched)
    void window.hermesAPI.cancelSpeech(playback.requestId).catch(() => {});
}
export function stopSpeechPlayback(owner?: string): void {
  if (!current || (owner && current.owner !== owner)) return;
  const previous = current;
  current = null;
  dispose(previous);
  publish({ owner: null, stage: "idle", error: null });
}
export function subscribeSpeechPlayback(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1)
    disconnect = window.hermesAPI.onConnectionConfigChanged(() =>
      stopSpeechPlayback(),
    );
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopSpeechPlayback();
      disconnect?.();
      disconnect = undefined;
    }
  };
}
export function speechPlaybackSnapshot(): Snapshot {
  return snapshot;
}
function fail(playback: Playback, error: unknown): void {
  if (current !== playback) return;
  current = null;
  dispose(playback);
  publish({
    owner: playback.owner,
    stage: "idle",
    error:
      error instanceof Error
        ? error.message
        : "Speech playback failed; try again.",
  });
}
function createAudio(result: SynthesizedSpeech): {
  audio: HTMLAudioElement;
  url: string;
} {
  if (!["audio/mpeg", "audio/wav", "audio/flac"].includes(result.mimeType))
    throw new Error("Unsupported speech audio format.");
  const bytes = new Uint8Array(result.audio);
  const url = URL.createObjectURL(
    new Blob([bytes.buffer], { type: result.mimeType }),
  );
  try {
    return { audio: new Audio(url), url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

// @lat: [[speech-playback#One playback owner]]
export async function startSpeechPlayback(
  owner: string,
  text: string,
  profile: string,
  connectionId: string,
): Promise<void> {
  stopSpeechPlayback();
  const playback: Playback = {
    owner,
    requestId: crypto.randomUUID(),
    dispatched: false,
  };
  current = playback;
  publish({ owner, stage: "loading", error: null });
  try {
    const target =
      await window.hermesAPI.getProviderRequestTarget(connectionId);
    if (current !== playback) return;
    if (target.mode !== "local")
      throw new Error(
        "Speech playback is available only on a Local connection.",
      );
    playback.dispatched = true;
    const result = await window.hermesAPI.synthesizeSpeech({
      requestId: playback.requestId,
      text,
      profile,
      target,
    });
    if (current !== playback) return;
    Object.assign(playback, createAudio(result));
    const audio = playback.audio!;
    audio.onended = () => {
      if (current === playback) stopSpeechPlayback(owner);
    };
    audio.onerror = () =>
      fail(
        playback,
        new Error(
          "Could not play this audio; check your output device and speech format.",
        ),
      );
    await audio.play();
    if (current !== playback) {
      audio.pause();
      return;
    }
    publish({ owner, stage: "playing", error: null });
  } catch (error) {
    fail(playback, error);
  }
}
