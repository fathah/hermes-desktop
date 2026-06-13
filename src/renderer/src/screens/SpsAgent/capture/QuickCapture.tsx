import { useState, useEffect, useRef } from "react";
import { buildCapture } from "../inbox/capture";
import { Icon } from "../components/Icon";

export function QuickCapture() {
  const [body, setBody] = useState("");
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      });
      const ok = await window.hermesAPI.spsExportRow("_inbox", capture.id, capture.markdown);
      if (ok) {
        // Close window to hide Quick Capture
        window.close();
      }
    } catch (err) {
      console.error("Failed to save capture note:", err);
    }
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        fontFamily: "var(--font-sans, -apple-system, sans-serif)",
      }}
    >
      <div
        style={{
          width: "580px",
          height: "330px",
          background: "rgba(25, 25, 27, 0.82)",
          backdropFilter: "blur(18px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "14px",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          color: "#fff",
        }}
      >
        {/* Title/Header drag region */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            userSelect: "none",
            WebkitAppRegion: "drag",
          } as any}
        >
          <span style={{ fontSize: "14px", fontWeight: "600", color: "var(--sukhi-gold, #f2b705)" }}>
            ⚡ QUICK CAPTURE
          </span>
          <button
            onClick={() => window.close()}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              WebkitAppRegion: "no-drag",
            } as any}
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
          style={{
            flex: 1,
            background: "rgba(0,0,0,0.18)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            borderRadius: "8px",
            padding: "12px",
            color: "#fff",
            fontSize: "14px",
            lineHeight: "1.5",
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
          }}
        />

        {/* Actions Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10 }}>
            {/* Snippet button */}
            <button
              onClick={handleSnippet}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
                color: "#fff",
                padding: "8px 12px",
                fontSize: "13px",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")}
            >
              <Icon name="callout" size={14} />
              <span>Snippet</span>
            </button>

            {/* Voice button */}
            <button
              onClick={handleVoiceToggle}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: recording ? "rgba(229, 72, 77, 0.2)" : "rgba(255, 255, 255, 0.06)",
                border: recording ? "1px solid rgba(229, 72, 77, 0.4)" : "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
                color: recording ? "#e5484d" : "#fff",
                padding: "8px 12px",
                fontSize: "13px",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!recording) e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
              }}
              onMouseLeave={(e) => {
                if (!recording) e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: recording ? "#e5484d" : "rgba(255,255,255,0.4)",
                  display: "inline-block",
                  animation: recording ? "vrPulse 1s ease-in-out infinite" : "none",
                }}
              />
              <span>{recording ? `Recording ${formatTime(recordTime)}` : "Voice"}</span>
            </button>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={!body.trim()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: body.trim() ? "var(--accent, #f2b705)" : "rgba(255, 255, 255, 0.03)",
              border: "none",
              borderRadius: "8px",
              color: body.trim() ? "#1a1810" : "rgba(255,255,255,0.25)",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: body.trim() ? "pointer" : "default",
            }}
          >
            Save to Inbox
          </button>
        </div>
      </div>
    </div>
  );
}
