import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input for the chat box.
 *
 * Primary path: the browser SpeechRecognition API, which streams results live
 * as the user speaks. Fallback (when SpeechRecognition is missing or fails —
 * the norm in Electron's Chromium, which has no speech backend): record with
 * MediaRecorder and transcribe via the active profile's provider (Groq/OpenAI
 * Whisper) through the main process.
 *
 * Groq has no streaming ASR over HTTP, so to keep the recorder path *live* we
 * re-transcribe the growing recording every {@link LIVE_INTERVAL_MS} and push
 * the running transcript out as an interim result; on stop we do a final pass
 * over the whole clip. It's a little wasteful (each tick re-sends the audio so
 * far) but Whisper is fast/cheap and voice input is short.
 *
 * `onResult(text, isFinal)` fires with the cumulative transcript: repeatedly
 * (interim) while listening, and once (final) when done. The caller renders it
 * into the input live and commits on `isFinal`.
 */
const LIVE_INTERVAL_MS = 2500;
const RECORDER_TIMESLICE_MS = 1000;

export interface UseVoiceInput {
  supported: boolean;
  recording: boolean;
  /** A transcription request is in flight (final pass on the recorder path). */
  transcribing: boolean;
  error: string | null;
  toggle: () => void;
}

// SpeechRecognition is non-standard; the DOM lib doesn't type it.
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useVoiceInput(
  onResult: (text: string, isFinal: boolean) => void,
  profile?: string,
): UseVoiceInput {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // True while a re-transcription request is in flight (so interim ticks don't
  // pile up) and once the user has hit stop (so a late interim can't clobber
  // the final, more-complete transcript).
  const inFlightRef = useRef(false);
  const finalizingRef = useRef(false);
  // Keep the latest onResult without re-creating callbacks each render.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const SpeechCtor = getSpeechRecognitionCtor();
  const canRecord =
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;
  const supported = !!SpeechCtor || canRecord;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  // Transcribe the audio captured so far. `isFinal` marks the post-stop pass.
  const transcribeAccumulated = useCallback(
    async (isFinal: boolean): Promise<void> => {
      if (chunksRef.current.length === 0) return;
      if (!isFinal && inFlightRef.current) return; // skip overlapping interims
      inFlightRef.current = true;
      try {
        const type = recorderRef.current?.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) return;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const text = await window.hermesAPI.transcribeAudio(
          bytes,
          blob.type,
          profile,
        );
        // A late interim must not overwrite the final transcript.
        if (!isFinal && finalizingRef.current) return;
        if (text) onResultRef.current(text, isFinal);
        else if (isFinal) setError("No speech detected.");
      } catch (e) {
        // Interim failures are transient — only surface the final one.
        if (isFinal) setError((e as Error).message || "Transcription failed.");
      } finally {
        inFlightRef.current = false;
      }
    },
    [profile],
  );

  const startMediaRecorder = useCallback(async () => {
    if (!canRecord) {
      setError("Voice input isn't available here.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      finalizingRef.current = false;
      inFlightRef.current = false;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        finalizingRef.current = true;
        if (liveTimerRef.current) {
          clearInterval(liveTimerRef.current);
          liveTimerRef.current = null;
        }
        stopStream();
        recorderRef.current = null;
        setRecording(false);
        setTranscribing(true);
        await transcribeAccumulated(true);
        chunksRef.current = [];
        setTranscribing(false);
      };
      // Timeslice so chunks accumulate; the interval re-transcribes them live.
      recorder.start(RECORDER_TIMESLICE_MS);
      liveTimerRef.current = setInterval(() => {
        void transcribeAccumulated(false);
      }, LIVE_INTERVAL_MS);
      setRecording(true);
      setError(null);
    } catch {
      setError("Microphone access was denied or is unavailable.");
      setRecording(false);
    }
  }, [canRecord, stopStream, transcribeAccumulated]);

  const startSpeechRecognition = useCallback(() => {
    if (!SpeechCtor) {
      void startMediaRecorder();
      return;
    }
    let gotResult = false;
    const rec = new SpeechCtor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      gotResult = true;
      let text = "";
      let isFinal = false;
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        text += r[0].transcript;
        isFinal = r.isFinal;
      }
      onResultRef.current(text.trim(), isFinal);
    };
    rec.onerror = (event) => {
      recognitionRef.current = null;
      setRecording(false);
      // Electron's Chromium usually can't reach a speech backend → fall back to
      // recording + server-side transcription transparently.
      if (
        !gotResult &&
        (event.error === "network" ||
          event.error === "service-not-allowed" ||
          event.error === "not-allowed" ||
          event.error === "audio-capture")
      ) {
        void startMediaRecorder();
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setRecording(false);
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setRecording(true);
      setError(null);
    } catch {
      recognitionRef.current = null;
      void startMediaRecorder();
    }
  }, [SpeechCtor, startMediaRecorder]);

  const toggle = useCallback(() => {
    if (recording) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          /* ignore */
        }
        recognitionRef.current = null;
      }
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop(); // onstop runs the final transcription
      } else {
        setRecording(false);
      }
      return;
    }
    if (transcribing) return;
    setError(null);
    if (SpeechCtor) startSpeechRecognition();
    else void startMediaRecorder();
  }, [
    recording,
    transcribing,
    SpeechCtor,
    startSpeechRecognition,
    startMediaRecorder,
  ]);

  // Tear down any live capture on unmount.
  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      stopStream();
    },
    [stopStream],
  );

  return { supported, recording, transcribing, error, toggle };
}
