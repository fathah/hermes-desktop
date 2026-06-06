// useDictation.ts — voice-to-text for the assistant composer (Milestone 3, hack #4).
// Wraps the browser SpeechRecognition API (available in Electron's Chromium). Voice-
// to-LLM tolerates imperfect transcription because the agent fills the gaps, so this
// stays deliberately simple: tap to dictate, the recognized text is handed back via
// the callback. Renderer-only — no main/IPC/gateway involvement.
import { useCallback, useEffect, useRef, useState } from "react";

// Minimal local typings — the DOM lib doesn't ship SpeechRecognition types.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (event: SpeechRecognitionEventLike) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
}

export function useDictation(onText: (text: string) => void): Dictation {
  const Ctor = getCtor();
  const supported = Ctor !== null;
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep the latest callback without re-creating `toggle`.
  const cbRef = useRef(onText);
  cbRef.current = onText;

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* already stopped */
      }
    };
  }, []);

  const toggle = useCallback(() => {
    if (!Ctor) return;
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        /* already stopped */
      }
      return;
    }
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      const trimmed = text.trim();
      if (trimmed) cbRef.current(trimmed);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [Ctor, listening]);

  return { supported, listening, toggle };
}
