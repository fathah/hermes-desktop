import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Push-to-talk speech-to-text for the chat composer (WS4). Click to start
 * capturing the microphone, click again to stop and transcribe; the resulting
 * text is handed to `onText`. Recording only ever happens on an explicit user
 * click (never auto-starts), and getUserMedia surfaces the OS mic prompt, so
 * consent is always explicit. Transcription runs in the main process via the
 * profile's VOICE_TOOLS_OPENAI_KEY — the key never reaches the renderer.
 */

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported?.(c)
    ) {
      return c;
    }
  }
  return "";
}

export interface VoiceInput {
  /** Browser supports microphone capture. */
  supported: boolean;
  /** VOICE_TOOLS_OPENAI_KEY is configured for the active profile. */
  hasKey: boolean;
  recording: boolean;
  /** Transcription request in flight. */
  busy: boolean;
  error: string | null;
  /** Start recording when idle; stop + transcribe when recording. */
  toggle: () => void;
}

export function useVoiceInput(
  profile: string | undefined,
  onText: (text: string) => void,
): VoiceInput {
  const [hasKey, setHasKey] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof MediaRecorder !== "undefined";

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

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e): void => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async (): Promise<void> => {
        stopTracks();
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        setRecording(false);
        if (blob.size === 0) return;
        setBusy(true);
        try {
          const buf = await blob.arrayBuffer();
          const res = await window.hermesAPI.transcribeAudio(
            buf,
            blob.type,
            profile,
          );
          if (res.error) setError(res.error);
          else if (res.text?.trim()) onTextRef.current(res.text.trim());
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      stopTracks();
      setRecording(false);
      setError(err instanceof Error ? err.message : "Microphone unavailable");
    }
  }, [profile, stopTracks]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
  }, []);

  const toggle = useCallback(() => {
    if (busy) return;
    if (recording) stop();
    else void start();
  }, [busy, recording, start, stop]);

  // Stop capture if the component unmounts mid-recording.
  useEffect(
    () => () => {
      stop();
      stopTracks();
    },
    [stop, stopTracks],
  );

  return { supported, hasKey, recording, busy, error, toggle };
}
