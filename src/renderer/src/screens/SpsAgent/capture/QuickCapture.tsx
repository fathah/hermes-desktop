import { useState, useEffect, useRef } from "react";
import { buildCapture } from "../inbox/capture";
import { Icon } from "../components/Icon";
import type {
  SpsCaptureKind,
  SpsPageSchemaKey,
} from "../../../../../shared/sps-types";

const CAPTURE_KINDS: SpsCaptureKind[] = [
  "note",
  "source",
  "project",
  "person",
  "decision",
  "meeting",
  "task",
  "journal",
];

function schemaForCaptureKind(
  kind: SpsCaptureKind,
): SpsPageSchemaKey | undefined {
  return kind === "note" ? undefined : kind;
}

export function QuickCapture() {
  const [body, setBody] = useState("");
  const [captureKind, setCaptureKind] = useState<SpsCaptureKind>("note");
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the text area on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Timer for voice recording
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (recording) {
      timer = setInterval(() => {
        setRecordTime((t) => t + 1);
      }, 1000);
    } else {
      setRecordTime(0);
    }
    return () => clearInterval(timer);
  }, [recording]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const handleSnippet = async () => {
    try {
      const name = await window.hermesAPI.spsTriggerScreencapture();
      if (name) {
        setBody((b) => `${b}\n\n![Snippet](../_assets/${name})\n`);
      }
    } catch (err) {
      console.error("Failed to capture screen snippet:", err);
    }
  };

  const handleVoiceToggle = async () => {
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const arrayBuf = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuf);
          const name = await window.hermesAPI.spsAssetWrite(bytes, "webm");
          setBody((b) => `${b}\n\n[Voice Note](../_assets/${name})\n`);

          // stop all tracks
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setRecording(true);
      } catch (err) {
        console.error("Failed to start voice recording:", err);
      }
    }
  };

  const handleSave = async () => {
    const text = body.trim();
    if (!text) return;

    try {
      const capture = buildCapture({
        source: "quick-note",
        body: text,
        capturedAt: Date.now(),
        captureKind,
        schema: schemaForCaptureKind(captureKind),
        provenance: "SPS quick capture",
      });
      const ok = await window.hermesAPI.spsExportRow(
        "_inbox",
        capture.id,
        capture.markdown,
      );
      if (ok) {
        // Close window to hide Quick Capture
        window.close();
      }
    } catch (err) {
      console.error("Failed to save capture note:", err);
    }
  };

  return (
    <div className="qc-overlay">
      <div className="qc-panel">
        {/* Title/Header drag region */}
        <div className="qc-header">
          <span className="qc-title">⚡ QUICK CAPTURE</span>
          <button
            onClick={() => window.close()}
            className="qc-close-btn"
            title="Close"
            aria-label="Close"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Text Editor */}
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Capture your thought, screen snippet, or voice memo..."
          className="qc-textarea"
        />

        {/* Actions Bar */}
        <div className="qc-actions-bar">
          <div className="qc-left-buttons">
            <select
              className="qc-btn"
              value={captureKind}
              onChange={(e) => setCaptureKind(e.target.value as SpsCaptureKind)}
              title="Capture type"
              aria-label="Capture type"
            >
              {CAPTURE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>

            {/* Snippet button */}
            <button
              onClick={handleSnippet}
              className="qc-btn"
              title="Capture screen snippet"
              aria-label="Capture screen snippet"
            >
              <Icon name="callout" size={14} />
              <span>Snippet</span>
            </button>

            {/* Voice button */}
            <button
              onClick={handleVoiceToggle}
              className={`qc-btn ${recording ? "qc-btn-voice-recording" : ""}`}
              title={
                recording ? "Stop voice recording" : "Start voice recording"
              }
              aria-label={
                recording ? "Stop voice recording" : "Start voice recording"
              }
            >
              <span
                className={`qc-recording-dot ${recording ? "qc-recording-dot-active" : ""}`}
              />
              <span>
                {recording ? `Recording ${formatTime(recordTime)}` : "Voice"}
              </span>
            </button>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={!body.trim()}
            className="qc-save-btn"
            title="Save note to inbox"
            aria-label="Save note to inbox"
          >
            Save to Inbox
          </button>
        </div>
      </div>
    </div>
  );
}
