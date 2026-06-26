import { useState, useEffect, useRef } from "react";
import { buildCapture } from "../inbox/capture";
import { Icon } from "../components/Icon";
import { rowToMarkdown } from "../editor/rowMarkdown";
import type {
  SpsCaptureKind,
  SpsPageSchemaKey,
} from "../../../../../shared/sps-types";
import type {
  RouteTaskOutcome,
  TaskTriageResult,
} from "../../../../../shared/tasks-dump";
import {
  PERSON_FOLDER,
  personToRowProps,
  slugifyPersonId,
  type PersonFrontmatter,
} from "../../../../../shared/contacts";
import {
  buildVisualCaptureBody,
  visualCaptureMimeFromPath,
  visualCaptureTitle,
  type VisualCaptureOrigin,
} from "../../../../../shared/visual-capture";

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

// The folder-backed query database the ToDo page reads. A task capture writes a
// row here (not the generic _inbox) so it shows up as an actual task.
const TASKS_DB_FOLDER = "tasks";
const TASK_CHIP_DISMISS_MS = 1600;

/** The one-line "what happened to this task" chip shown after routing. */
function routeChipLabel(
  outcome: RouteTaskOutcome,
  triage: TaskTriageResult,
): string {
  if (outcome.route === "ai") {
    return outcome.dispatched
      ? "🤖 Hermes is on it"
      : "🔍 Flagged for your review";
  }
  const due = triage.due ? ` · due ${triage.due}` : "";
  if (outcome.fellBackToHuman) {
    return `⏰ Added to your list (agent unavailable)${due}`;
  }
  return `⏰ On your list — I'll remind you${due}`;
}

interface QuickVisualCapture {
  source: "image" | "screenshot";
  assetPath: string;
  originalName: string;
  captureOrigin: VisualCaptureOrigin;
  mime: string;
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function QuickCapture() {
  const [body, setBody] = useState("");
  const [captureKind, setCaptureKind] = useState<SpsCaptureKind>("note");
  const [visualCapture, setVisualCapture] = useState<QuickVisualCapture | null>(
    null,
  );
  const [cameraError, setCameraError] = useState("");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [routeChip, setRouteChip] = useState("");
  const [saving, setSaving] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the text area on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Default to the capture kind the opener requested (the task hotkey sets
  // "task"). Read-once on mount for a fresh window, plus a live listener so an
  // already-open window switches too.
  useEffect(() => {
    let active = true;
    const api = window.hermesAPI;
    void api.spsTakeCaptureKind?.().then((kind) => {
      if (active && kind) setCaptureKind(kind as SpsCaptureKind);
    });
    const unsubscribe = api.onCaptureKind?.((kind) =>
      setCaptureKind(kind as SpsCaptureKind),
    );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = cameraStream;
    return () => stopMediaStream(cameraStream);
  }, [cameraStream]);

  // Timer for voice recording
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
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
        setVisualCapture({
          source: "screenshot",
          assetPath: name,
          originalName: name,
          captureOrigin: "screen-snippet",
          mime: visualCaptureMimeFromPath(name),
        });
      }
    } catch (err) {
      console.error("Failed to capture screen snippet:", err);
    }
  };

  const handleCamera = async () => {
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is unavailable in this window.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      setCameraStream(stream);
    } catch (err) {
      setCameraStream(null);
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError");
      setCameraError(
        denied
          ? "Camera access was denied."
          : err instanceof Error
            ? err.message
            : "Camera access failed.",
      );
    }
  };

  const handleCameraCancel = () => {
    stopMediaStream(cameraStream);
    setCameraStream(null);
  };

  const handleCameraCapture = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Camera capture failed.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) {
      setCameraError("Camera capture failed.");
      return;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const assetPath = await window.hermesAPI.spsAssetWrite(bytes, "png");
    setVisualCapture({
      source: "image",
      assetPath,
      originalName: "camera.png",
      captureOrigin: "camera",
      mime: "image/png",
    });
    handleCameraCancel();
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

          // Transcribe so the spoken thought becomes editable task text, then
          // keep the audio note for provenance. Transcription is best-effort:
          // a missing VOICE_TOOLS_OPENAI_KEY just leaves the link on its own.
          let transcript = "";
          try {
            const result = await window.hermesAPI.transcribeAudio(
              arrayBuf,
              "audio/webm",
            );
            if (result.text) transcript = result.text.trim();
            else if (result.error)
              console.warn("Voice transcription:", result.error);
          } catch (err) {
            console.error("Voice transcription failed:", err);
          }
          const voiceLink = `[Voice Note](../_assets/${name})`;
          const addition = transcript
            ? `${transcript}\n\n${voiceLink}\n`
            : `\n\n${voiceLink}\n`;
          setBody((b) => (b ? `${b}\n${addition}` : addition));

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

  // Task capture: write a real task row to the ToDo database, classify it, and
  // record the routing decision on the row. Persist-first so a captured task is
  // never lost even if the classifier is slow or the gateway is unreachable.
  const saveTask = async (text: string): Promise<void> => {
    setSaving(true);
    try {
      const capturedAt = Date.now();
      const rowId = `task-${capturedAt.toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const firstLine = text.split("\n")[0]?.trim() || "Untitled task";
      const title =
        firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
      const detail = text.trim() !== firstLine ? text.trim() : "";

      const draft = rowToMarkdown({ title, status: "inbox" }, detail);
      const saved = await window.hermesAPI.spsExportRow(
        TASKS_DB_FOLDER,
        rowId,
        draft,
      );
      if (!saved) {
        setSaving(false);
        return;
      }

      const triage = await window.hermesAPI.spsClassifyTask(text);
      // Organize: dispatch to Kanban / hold for review / schedule the nag.
      const outcome = await window.hermesAPI.spsRouteTask({
        rowId,
        title,
        body: detail,
        triage,
      });
      const props: Record<string, unknown> = {
        title,
        status: outcome.status,
        route: outcome.route,
        assigneeId: triage.assigneeId,
        // Mirror onto `who` so the existing ToDo views render the assignee.
        who: triage.assigneeId,
      };
      if (triage.due) props.due = triage.due;
      // For a dispatched AI task the row only points at the Kanban record;
      // execution status lives there (read-only), so the ToDo row can't drift.
      if (outcome.delegatedTo) props.delegatedTo = outcome.delegatedTo;
      await window.hermesAPI.spsExportRow(
        TASKS_DB_FOLDER,
        rowId,
        rowToMarkdown(props, detail),
      );

      setRouteChip(routeChipLabel(outcome, triage));
      setTimeout(() => window.close(), TASK_CHIP_DISMISS_MS);
    } catch (err) {
      console.error("Failed to save task:", err);
      setSaving(false);
    }
  };

  // Person capture: create a real contact row (vault/people/<id>.md) so the
  // who-picker can find them by name, alias, tag, or any captured fragment.
  const saveContact = async (text: string): Promise<void> => {
    setSaving(true);
    try {
      const firstLine = text.split("\n")[0]?.trim() || "Unnamed contact";
      const name =
        firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
      const rest = text.trim().slice(firstLine.length).trim();
      const id =
        slugifyPersonId(name) ||
        `person-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
      // Keep the captured context as a fragment so the contact is searchable
      // by it immediately (richer enrichment is a later phase).
      const fm: PersonFrontmatter = rest
        ? { fragments: [{ text: rest, source: "capture" }] }
        : {};
      const markdown = rowToMarkdown(personToRowProps(name, fm), text.trim());
      const ok = await window.hermesAPI.spsExportRow(
        PERSON_FOLDER,
        id,
        markdown,
      );
      if (!ok) {
        setSaving(false);
        return;
      }
      setRouteChip(`👤 Added ${name} to Contacts`);
      setTimeout(() => window.close(), TASK_CHIP_DISMISS_MS);
    } catch (err) {
      console.error("Failed to save contact:", err);
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const text = body.trim();
    if (!text && !visualCapture) return;
    if (captureKind === "task" && !visualCapture) {
      await saveTask(text);
      return;
    }
    if (captureKind === "person" && !visualCapture) {
      await saveContact(text);
      return;
    }

    try {
      const capturedAt = Date.now();
      const capture = buildCapture({
        source: visualCapture ? visualCapture.source : "quick-note",
        body: visualCapture
          ? buildVisualCaptureBody({
              assetPath: visualCapture.assetPath,
              originalName: visualCapture.originalName,
              note: text,
            })
          : text,
        title: visualCapture
          ? visualCaptureTitle({
              captureOrigin: visualCapture.captureOrigin,
              originalName: visualCapture.originalName,
              capturedAt,
            })
          : undefined,
        capturedAt,
        captureKind: visualCapture ? "source" : captureKind,
        schema: visualCapture ? "source" : schemaForCaptureKind(captureKind),
        provenance: visualCapture
          ? "SPS quick capture visual"
          : "SPS quick capture",
        assetPath: visualCapture?.assetPath,
        originalName: visualCapture?.originalName,
        mime: visualCapture?.mime,
        captureOrigin: visualCapture?.captureOrigin,
        ocrStatus: visualCapture ? "not-run" : undefined,
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

            <button
              onClick={handleCamera}
              className="qc-btn"
              title="Camera"
              aria-label="Camera"
            >
              <Icon name="file" size={14} />
              <span>Camera</span>
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
            disabled={(!body.trim() && !visualCapture) || saving}
            className="qc-save-btn"
            title={captureKind === "task" ? "Save task" : "Save note to inbox"}
            aria-label={
              captureKind === "task" ? "Save task" : "Save note to inbox"
            }
          >
            {saving
              ? "Saving…"
              : captureKind === "task"
                ? "Save Task"
                : "Save to Inbox"}
          </button>
        </div>
        {routeChip && <div className="qc-visual-chip">{routeChip}</div>}
        {visualCapture && (
          <div className="qc-visual-chip">
            {visualCapture.captureOrigin === "camera"
              ? "Camera photo"
              : "Screen snippet"}{" "}
            ready
          </div>
        )}
        {cameraStream && (
          <div className="qc-camera-preview">
            <video ref={videoRef} autoPlay muted playsInline />
            <div className="qc-camera-actions">
              <button
                className="qc-btn"
                onClick={() => void handleCameraCapture()}
              >
                Capture photo
              </button>
              <button className="qc-btn" onClick={handleCameraCancel}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {cameraError && <div className="qc-error">{cameraError}</div>}
      </div>
    </div>
  );
}
