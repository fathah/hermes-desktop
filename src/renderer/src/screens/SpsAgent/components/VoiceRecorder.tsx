// VoiceRecorder.tsx — in-app voice notes via the MediaRecorder API. Records mic
// audio, writes the clip to the vault asset store, and reports the stored asset
// + duration. Mic permission is granted to the app renderer in the main process
// (session.setPermissionRequestHandler).
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { writeAssetFromBlob, type WrittenAsset } from "../lib/assets";

interface Props {
  onRecorded: (asset: WrittenAsset, durationSec: number) => void;
}

type Phase = "idle" | "recording" | "saving" | "denied";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function VoiceRecorder({ onRecorded }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop the tick + the recorder if the block unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
    };
  }, []);

  const start = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const duration = Math.round((Date.now() - startRef.current) / 1000);
        setPhase("saving");
        const ext = type.includes("ogg") ? "ogg" : "webm";
        const asset = await writeAssetFromBlob(blob, `voice-note.${ext}`);
        setPhase("idle");
        setSecs(0);
        if (asset) onRecorded(asset, duration);
      };
      rec.start();
      recorderRef.current = rec;
      startRef.current = Date.now();
      setPhase("recording");
      setSecs(0);
      timerRef.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      // Permission denied or no device.
      setPhase("denied");
    }
  };

  const stop = (): void => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
  };

  if (phase === "recording") {
    return (
      <button className="vr-btn recording" onClick={stop}>
        <span className="vr-dot" />
        Stop · {mmss(secs)}
      </button>
    );
  }
  if (phase === "saving") {
    return (
      <button className="vr-btn" disabled>
        Saving…
      </button>
    );
  }
  return (
    <button
      className="vr-btn"
      onClick={() => void start()}
      title="Record a voice note"
    >
      <Icon name="mic" size={15} />
      {phase === "denied" ? "Mic blocked — retry" : "Record"}
    </button>
  );
}
