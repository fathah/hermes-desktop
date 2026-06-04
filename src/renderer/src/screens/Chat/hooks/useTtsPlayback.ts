import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Text-to-speech playback for agent replies (WS4). A single shared <Audio>
 * element means starting playback of one message stops any other — the user
 * never gets two voices at once. Synthesis runs in the main process via the
 * profile's VOICE_TOOLS_OPENAI_KEY; here we just play the returned data URL.
 */
export interface TtsPlayback {
  /** VOICE_TOOLS_OPENAI_KEY is configured — gates the speaker buttons. */
  hasKey: boolean;
  /** Message id currently playing, or null. */
  playingId: string | null;
  /** Message id being synthesized (request in flight), or null. */
  busyId: string | null;
  error: string | null;
  play: (id: string, text: string) => void;
  stop: () => void;
}

export function useTtsPlayback(profile: string | undefined): TtsPlayback {
  const [hasKey, setHasKey] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Monotonic request id: a later play() supersedes an in-flight earlier one.
  const reqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .getVoiceStatus(profile)
      .then((s) => {
        if (!cancelled) setHasKey(s.hasKey);
      })
      .catch(() => {
        /* leave disabled */
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const play = useCallback(
    async (id: string, text: string): Promise<void> => {
      stop();
      setError(null);
      const req = ++reqRef.current;
      setBusyId(id);
      try {
        const res = await window.hermesAPI.speakText(text, undefined, profile);
        if (req !== reqRef.current) return; // superseded by a newer request
        if (res.error || !res.audioUrl) {
          setError(res.error ?? "No audio returned");
          return;
        }
        const audio = new Audio(res.audioUrl);
        audioRef.current = audio;
        audio.onended = (): void =>
          setPlayingId((cur) => (cur === id ? null : cur));
        audio.onerror = (): void => {
          setError("Playback failed");
          setPlayingId((cur) => (cur === id ? null : cur));
        };
        setPlayingId(id);
        await audio.play().catch(() => {});
      } catch (err) {
        if (req === reqRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (req === reqRef.current) setBusyId(null);
      }
    },
    [profile, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { hasKey, playingId, busyId, error, play, stop };
}
