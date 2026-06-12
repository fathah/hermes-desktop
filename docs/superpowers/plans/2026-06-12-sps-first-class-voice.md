# SPS First-Class Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make voice a first-class SPS workflow for capture, review, page insertion, task creation, assistant prompts, and listen-back, without introducing always-listening behavior.

**Architecture:** Reuse the existing voice substrate: `getVoiceStatus`, `transcribeAudio`, `speakText`, vault asset storage, `VoiceRecorder`, and `AudioBlock`. Add a small profile-local `voice-captures.json` sidecar for pending/reviewed voice captures, a reusable capture button that records + stores + transcribes, and a new SPS **Voice** surface where employees decide what each capture becomes. Keep voice explicit, consent-based, and inspectable.

**Tech Stack:** Electron main/preload IPC, React 19, Zustand SPS store, TypeScript shared types, existing OpenAI audio bridge, existing vault asset store, Vitest/jsdom.

---

## Product Decisions

- Surface name: **Voice**.
- Sidebar placement: under **My Assistant**.
- Voice model: explicit press-to-talk / click-to-record only. No wake word and no always-listening in v1.
- Employee-facing copy: **Voice**, **voice note**, **transcript**, **Ask My Assistant**, **Add to page**, **Create task**, **Learn This**.
- Voice is part of SPS / My Assistant, not a second personality.
- Raw audio retention is explicit: v1 keeps audio only when the user saves a voice capture or inserts an audio block.
- Transcripts are review-first before memory, task creation, or page insertion.
- Existing chat push-to-talk and TTS remain working.

## V1 Scope

- Add profile-local voice capture metadata:
  - `<profileHome>/sps-agent/voice-captures.json`
- Add shared `VoiceCapture` types.
- Add main/preload APIs:
  - `spsListVoiceCaptures(profile?)`
  - `spsCreateVoiceCapture(input, profile?)`
  - `spsUpdateVoiceCapture(id, patch, profile?)`
  - `spsDeleteVoiceCapture(id, profile?)`
- Add a reusable `VoiceCaptureButton` that:
  - records audio with explicit user action,
  - writes the blob to the existing vault asset store via `spsAssetWrite`,
  - calls existing `transcribeAudio`,
  - creates a pending voice capture record.
- Add **Voice** surface:
  - status card showing whether voice key is configured,
  - capture button,
  - pending/reviewed capture list,
  - audio playback,
  - transcript editing,
  - actions: **Add to page**, **Ask My Assistant**, **Create task**, **Discard**.
- Extend audio blocks with optional transcript metadata.
- Update audio block UI to show transcript when present.
- Add lightweight Settings/Capabilities copy so voice is visible as a granted capability.

## Out Of Scope For V1

- No always-on listening.
- No wake word.
- No diarization.
- No real-time streaming transcription.
- No provider picker rewrite.
- No local/offline STT implementation.
- No automatic memory writes from voice.
- No automatic email/message/task action from voice without review.
- No mobile voice capture.

## File Structure

Create:

- `src/shared/voice-captures.ts`  
  Shared sidecar types.

- `src/main/voice-captures.ts`  
  Profile-local JSON sidecar implementation.

- `tests/voice-captures.test.ts`  
  Unit tests for empty store, create/update/list/delete, corrupt JSON tolerance.

- `src/renderer/src/screens/SpsAgent/voice/VoiceCaptureButton.tsx`  
  Reusable explicit record/transcribe/save control for SPS voice captures.

- `src/renderer/src/screens/SpsAgent/voice/VoiceSurface.tsx`  
  First-class Voice surface.

- `src/renderer/src/screens/SpsAgent/voice/VoiceSurface.test.tsx`  
  Renderer tests for rendering captures and triggering actions.

Modify:

- `src/shared/sps-types.ts`  
  Add optional audio transcript fields to `Block`.

- `src/renderer/src/screens/SpsAgent/editor/AudioBlock.tsx`  
  Show transcript when audio block has one.

- `src/renderer/src/screens/SpsAgent/editor/blockMarkdown.test.ts`  
  Cover audio transcript round-trip through existing tier-2 metadata.

- `src/main/ipc/sps.ts`  
  Register voice capture IPC.

- `src/preload/bridges/sps.ts` and `src/preload/index.d.ts`  
  Expose voice capture APIs.

- `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`  
  Add `"voice"` to `Surface`.

- `src/renderer/src/screens/SpsAgent/App.tsx`  
  Render `VoiceSurface`.

- `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`  
  Add **Voice** under **My Assistant**.

- `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx`  
  Assert Voice nav is present.

- `src/renderer/src/screens/Settings/CapabilitySummary.tsx`  
  Include voice status in capability summary copy if the voice key exists.

## Shared Types

Create `src/shared/voice-captures.ts`:

```ts
export type VoiceCaptureStatus =
  | "pending"
  | "added_to_page"
  | "sent_to_assistant"
  | "task_created"
  | "dismissed";

export interface VoiceCaptureSource {
  type: "voice_surface" | "audio_block" | "chat" | "global_shortcut";
  pageId?: string;
  pageTitle?: string;
}

export interface VoiceCapture {
  id: string;
  status: VoiceCaptureStatus;
  createdAt: number;
  updatedAt: number;
  assetPath: string;
  mime: string;
  name: string;
  size: number;
  duration?: number;
  transcript: string;
  source: VoiceCaptureSource;
  error?: string;
}

export interface VoiceCaptureCreateInput {
  assetPath: string;
  mime: string;
  name: string;
  size: number;
  duration?: number;
  transcript: string;
  source: VoiceCaptureSource;
  error?: string;
}

export interface VoiceCapturePatch {
  status?: VoiceCaptureStatus;
  transcript?: string;
  error?: string | null;
}
```

Extend `Block` in `src/shared/sps-types.ts`:

```ts
  // audio: optional reviewed transcript for voice notes/audio clips.
  transcript?: string;
  transcriptStatus?: "pending" | "reviewed";
```

## Task 1: Voice Capture Sidecar Tests

**Files:**
- Create: `tests/voice-captures.test.ts`
- Create later: `src/shared/voice-captures.ts`
- Create later: `src/main/voice-captures.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/voice-captures.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  listVoiceCaptures,
  createVoiceCapture,
  updateVoiceCapture,
  deleteVoiceCapture,
} from "../src/main/voice-captures";

let home: string;
const PROFILE = "default";

function sidecarPath(): string {
  return join(home, "profiles", PROFILE, "sps-agent", "voice-captures.json");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sps-voice-"));
  process.env.HERMES_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("voice captures sidecar", () => {
  it("returns [] when no sidecar exists", async () => {
    expect(await listVoiceCaptures(PROFILE)).toEqual([]);
  });

  it("creates a pending capture", async () => {
    const capture = await createVoiceCapture(
      {
        assetPath: "abc.webm",
        mime: "audio/webm",
        name: "voice-note.webm",
        size: 123,
        duration: 4,
        transcript: "Call Priya about payroll.",
        source: { type: "voice_surface", pageId: "home", pageTitle: "Home" },
      },
      PROFILE,
    );

    expect(capture.status).toBe("pending");
    expect(capture.transcript).toBe("Call Priya about payroll.");
    expect(capture.createdAt).toBeGreaterThan(0);
    expect(await listVoiceCaptures(PROFILE)).toEqual([capture]);
  });

  it("updates transcript and status", async () => {
    const capture = await createVoiceCapture(
      {
        assetPath: "abc.webm",
        mime: "audio/webm",
        name: "voice-note.webm",
        size: 123,
        transcript: "Draft",
        source: { type: "voice_surface" },
      },
      PROFILE,
    );

    const updated = await updateVoiceCapture(
      capture.id,
      { transcript: "Final", status: "added_to_page" },
      PROFILE,
    );

    expect(updated?.transcript).toBe("Final");
    expect(updated?.status).toBe("added_to_page");
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(capture.updatedAt);
  });

  it("deletes a capture", async () => {
    const capture = await createVoiceCapture(
      {
        assetPath: "abc.webm",
        mime: "audio/webm",
        name: "voice-note.webm",
        size: 123,
        transcript: "Remove me",
        source: { type: "voice_surface" },
      },
      PROFILE,
    );

    expect(await deleteVoiceCapture(capture.id, PROFILE)).toBe(true);
    expect(await listVoiceCaptures(PROFILE)).toEqual([]);
  });

  it("returns false/null for missing captures", async () => {
    expect(await updateVoiceCapture("missing", { status: "dismissed" }, PROFILE)).toBeNull();
    expect(await deleteVoiceCapture("missing", PROFILE)).toBe(false);
  });

  it("treats corrupt JSON as empty", async () => {
    mkdirSync(join(home, "profiles", PROFILE, "sps-agent"), { recursive: true });
    writeFileSync(sidecarPath(), "{broken", "utf-8");
    expect(await listVoiceCaptures(PROFILE)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/voice-captures.test.ts
```

Expected: FAIL because `src/main/voice-captures.ts` does not exist.

## Task 2: Shared Types And Main Sidecar

**Files:**
- Create: `src/shared/voice-captures.ts`
- Create: `src/main/voice-captures.ts`
- Test: `tests/voice-captures.test.ts`

- [ ] **Step 1: Add shared types**

Create `src/shared/voice-captures.ts` with the exact content from the **Shared Types** section.

- [ ] **Step 2: Implement main sidecar**

Create `src/main/voice-captures.ts`:

```ts
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { profileHome, getActiveProfileNameSync } from "./utils";
import type {
  VoiceCapture,
  VoiceCaptureCreateInput,
  VoiceCapturePatch,
} from "../shared/voice-captures";

function capturesPath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "voice-captures.json",
  );
}

function id(): string {
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readCaptures(profile?: string): Promise<VoiceCapture[]> {
  try {
    const raw = await fs.readFile(capturesPath(profile), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VoiceCapture[]) : [];
  } catch {
    return [];
  }
}

async function writeCaptures(
  captures: VoiceCapture[],
  profile?: string,
): Promise<void> {
  const p = capturesPath(profile);
  await fs.mkdir(dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(captures, null, 2), "utf-8");
}

export async function listVoiceCaptures(
  profile?: string,
): Promise<VoiceCapture[]> {
  const captures = await readCaptures(profile);
  return captures.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createVoiceCapture(
  input: VoiceCaptureCreateInput,
  profile?: string,
): Promise<VoiceCapture> {
  const now = Date.now();
  const capture: VoiceCapture = {
    id: id(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    assetPath: input.assetPath,
    mime: input.mime,
    name: input.name,
    size: input.size,
    duration: input.duration,
    transcript: input.transcript,
    source: input.source,
    error: input.error,
  };
  const captures = await readCaptures(profile);
  await writeCaptures([capture, ...captures], profile);
  return capture;
}

export async function updateVoiceCapture(
  captureId: string,
  patch: VoiceCapturePatch,
  profile?: string,
): Promise<VoiceCapture | null> {
  const captures = await readCaptures(profile);
  const idx = captures.findIndex((c) => c.id === captureId);
  if (idx < 0) return null;
  const current = captures[idx];
  const next: VoiceCapture = {
    ...current,
    ...patch,
    error: patch.error === null ? undefined : patch.error ?? current.error,
    updatedAt: Date.now(),
  };
  captures[idx] = next;
  await writeCaptures(captures, profile);
  return next;
}

export async function deleteVoiceCapture(
  captureId: string,
  profile?: string,
): Promise<boolean> {
  const captures = await readCaptures(profile);
  const next = captures.filter((c) => c.id !== captureId);
  if (next.length === captures.length) return false;
  await writeCaptures(next, profile);
  return true;
}
```

- [ ] **Step 3: Run sidecar tests**

Run:

```bash
npx vitest run tests/voice-captures.test.ts
```

Expected: PASS.

## Task 3: IPC And Preload

**Files:**
- Modify: `src/main/ipc/sps.ts`
- Modify: `src/preload/bridges/sps.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `tests/preload-api-surface.test.ts`

- [ ] **Step 1: Register IPC**

In `src/main/ipc/sps.ts`, import:

```ts
import {
  listVoiceCaptures,
  createVoiceCapture,
  updateVoiceCapture,
  deleteVoiceCapture,
} from "../voice-captures";
import type {
  VoiceCaptureCreateInput,
  VoiceCapturePatch,
} from "../../shared/voice-captures";
```

Inside `registerSpsIpc()`, add:

```ts
safeHandle("sps-voice-captures-list", (_event, profile?: string) =>
  listVoiceCaptures(profile),
);
safeHandle(
  "sps-voice-captures-create",
  (_event, input: VoiceCaptureCreateInput, profile?: string) =>
    createVoiceCapture(input, profile),
);
safeHandle(
  "sps-voice-captures-update",
  (_event, id: string, patch: VoiceCapturePatch, profile?: string) =>
    updateVoiceCapture(id, patch, profile),
);
safeHandle("sps-voice-captures-delete", (_event, id: string, profile?: string) =>
  deleteVoiceCapture(id, profile),
);
```

- [ ] **Step 2: Add preload bridge methods**

In `src/preload/bridges/sps.ts`, import:

```ts
import type {
  VoiceCapture,
  VoiceCaptureCreateInput,
  VoiceCapturePatch,
} from "../../shared/voice-captures";
```

Add methods:

```ts
spsListVoiceCaptures: (profile?: string): Promise<VoiceCapture[]> =>
  ipcRenderer.invoke("sps-voice-captures-list", profile),
spsCreateVoiceCapture: (
  input: VoiceCaptureCreateInput,
  profile?: string,
): Promise<VoiceCapture> =>
  ipcRenderer.invoke("sps-voice-captures-create", input, profile),
spsUpdateVoiceCapture: (
  id: string,
  patch: VoiceCapturePatch,
  profile?: string,
): Promise<VoiceCapture | null> =>
  ipcRenderer.invoke("sps-voice-captures-update", id, patch, profile),
spsDeleteVoiceCapture: (id: string, profile?: string): Promise<boolean> =>
  ipcRenderer.invoke("sps-voice-captures-delete", id, profile),
```

- [ ] **Step 3: Add preload types**

In `src/preload/index.d.ts`, import:

```ts
import type {
  VoiceCapture,
  VoiceCaptureCreateInput,
  VoiceCapturePatch,
} from "../shared/voice-captures";
```

Add methods:

```ts
spsListVoiceCaptures: (profile?: string) => Promise<VoiceCapture[]>;
spsCreateVoiceCapture: (
  input: VoiceCaptureCreateInput,
  profile?: string,
) => Promise<VoiceCapture>;
spsUpdateVoiceCapture: (
  id: string,
  patch: VoiceCapturePatch,
  profile?: string,
) => Promise<VoiceCapture | null>;
spsDeleteVoiceCapture: (id: string, profile?: string) => Promise<boolean>;
```

- [ ] **Step 4: Extend preload parity test**

In `tests/preload-api-surface.test.ts`, add:

```ts
it("has SPS voice capture APIs", () => {
  expect(preloadMethods).toContain("spsListVoiceCaptures");
  expect(typeMethods).toContain("spsListVoiceCaptures");
  expect(preloadMethods).toContain("spsCreateVoiceCapture");
  expect(typeMethods).toContain("spsCreateVoiceCapture");
  expect(preloadMethods).toContain("spsUpdateVoiceCapture");
  expect(typeMethods).toContain("spsUpdateVoiceCapture");
  expect(preloadMethods).toContain("spsDeleteVoiceCapture");
  expect(typeMethods).toContain("spsDeleteVoiceCapture");
});
```

- [ ] **Step 5: Validate**

Run:

```bash
npx vitest run tests/preload-api-surface.test.ts tests/voice-captures.test.ts
npm run typecheck
```

Expected: PASS.

## Task 4: Audio Block Transcript Metadata

**Files:**
- Modify: `src/shared/sps-types.ts`
- Modify: `src/renderer/src/screens/SpsAgent/editor/AudioBlock.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/editor/blockMarkdown.test.ts`

- [ ] **Step 1: Extend `Block`**

In `src/shared/sps-types.ts`, add the transcript fields shown in **Shared Types** near `duration`.

- [ ] **Step 2: Add serializer test**

In `blockMarkdown.test.ts`, update the audio fixture in the existing “audio/video/file ride the tier-2 meta comment losslessly” test:

```ts
transcript: "Remember to call Priya about payroll.",
transcriptStatus: "reviewed",
```

Then add assertions after round-trip:

```ts
if (b.type === "audio") {
  expect(back.transcript).toBe("Remember to call Priya about payroll.");
  expect(back.transcriptStatus).toBe("reviewed");
}
```

Because audio already rides tier-2 metadata, this should pass without serializer changes.

- [ ] **Step 3: Render transcript in `AudioBlock`**

In `AudioBlock.tsx`, under the `<audio>` element, add:

```tsx
{block.transcript ? (
  <div className="audio-transcript">
    <div className="audio-transcript-label">Transcript</div>
    <div>{block.transcript}</div>
  </div>
) : null}
```

- [ ] **Step 4: Validate**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/editor/blockMarkdown.test.ts
npm run typecheck
```

Expected: PASS.

## Task 5: Reusable Voice Capture Button

**Files:**
- Create: `src/renderer/src/screens/SpsAgent/voice/VoiceCaptureButton.tsx`
- Test through `VoiceSurface.test.tsx` in Task 7.

- [ ] **Step 1: Create `VoiceCaptureButton`**

Create `src/renderer/src/screens/SpsAgent/voice/VoiceCaptureButton.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { writeAssetFromBlob } from "../lib/assets";
import type { VoiceCapture } from "../../../../../shared/voice-captures";

type Phase = "idle" | "recording" | "saving" | "transcribing" | "denied";

interface Props {
  source: {
    type: "voice_surface" | "audio_block" | "chat" | "global_shortcut";
    pageId?: string;
    pageTitle?: string;
  };
  onCaptured: (capture: VoiceCapture) => void;
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function extForMime(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}

export function VoiceCaptureButton({ source, onCaptured }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
    };
  }, []);

  async function start(): Promise<void> {
    setError("");
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
        chunksRef.current = [];
        if (timerRef.current) clearInterval(timerRef.current);
        setPhase("saving");
        const asset = await writeAssetFromBlob(
          blob,
          `voice-capture.${extForMime(type)}`,
        );
        if (!asset) {
          setError("Could not save audio.");
          setPhase("idle");
          return;
        }
        setPhase("transcribing");
        const buf = await blob.arrayBuffer();
        const res = await window.hermesAPI.transcribeAudio(buf, type);
        const capture = await window.hermesAPI.spsCreateVoiceCapture({
          ...asset,
          duration,
          transcript: res.text?.trim() || "",
          source,
          error: res.error,
        });
        setSecs(0);
        setPhase("idle");
        onCaptured(capture);
      };
      rec.start();
      recorderRef.current = rec;
      startRef.current = Date.now();
      setSecs(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch (err) {
      setPhase("denied");
      setError(err instanceof Error ? err.message : "Microphone unavailable.");
    }
  }

  function stop(): void {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
  }

  if (phase === "recording") {
    return (
      <button className="vr-btn recording" onClick={stop}>
        <span className="vr-dot" />
        Stop · {mmss(secs)}
      </button>
    );
  }

  return (
    <div className="voice-capture-control">
      <button
        className="vr-btn"
        onClick={() => void start()}
        disabled={phase === "saving" || phase === "transcribing"}
        title="Record a voice capture"
      >
        <Icon name="mic" size={15} />
        {phase === "saving"
          ? "Saving..."
          : phase === "transcribing"
            ? "Transcribing..."
            : phase === "denied"
              ? "Mic blocked - retry"
              : "Record"}
      </button>
      {error && <div className="settings-field-hint">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Validate typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS after preload APIs from Task 3 exist.

## Task 6: Voice Surface Shell

**Files:**
- Create: `src/renderer/src/screens/SpsAgent/voice/VoiceSurface.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`
- Modify: `src/renderer/src/screens/SpsAgent/App.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Add surface type**

In `storeTypes.ts`, add `"voice"` to the `Surface` union.

- [ ] **Step 2: Create initial Voice surface**

Create `src/renderer/src/screens/SpsAgent/voice/VoiceSurface.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { assetUrl } from "../lib/assets";
import { uid } from "../lib/ids";
import { useStore } from "../store";
import { VoiceCaptureButton } from "./VoiceCaptureButton";
import type { VoiceCapture } from "../../../../../shared/voice-captures";
import type { Block } from "../types";

function mmss(total?: number): string {
  if (!total) return "";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function VoiceSurface() {
  const [captures, setCaptures] = useState<VoiceCapture[]>([]);
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState("");
  const page = useStore((s) => s.page);
  const meta = useStore((s) => s.meta);
  const setBlocks = useStore((s) => s.setBlocks);
  const runAgent = useStore((s) => s.runAgent);

  async function refresh(): Promise<void> {
    try {
      setError("");
      const [voiceStatus, rows] = await Promise.all([
        window.hermesAPI.getVoiceStatus(),
        window.hermesAPI.spsListVoiceCaptures(),
      ]);
      setHasKey(voiceStatus.hasKey);
      setCaptures(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load voice captures.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function updateTranscript(id: string, transcript: string): Promise<void> {
    await window.hermesAPI.spsUpdateVoiceCapture(id, { transcript });
    setCaptures((rows) =>
      rows.map((row) => (row.id === id ? { ...row, transcript } : row)),
    );
  }

  async function addToPage(capture: VoiceCapture): Promise<void> {
    const audioBlock: Block = {
      id: uid("b"),
      type: "audio",
      text: "",
      assetPath: capture.assetPath,
      mime: capture.mime,
      name: capture.name,
      size: capture.size,
      duration: capture.duration,
      transcript: capture.transcript,
      transcriptStatus: "reviewed",
    };
    const transcriptBlock: Block | null = capture.transcript.trim()
      ? {
          id: uid("b"),
          type: "p",
          text: capture.transcript.trim(),
        }
      : null;
    setBlocks((blocks) => [
      ...blocks,
      audioBlock,
      ...(transcriptBlock ? [transcriptBlock] : []),
    ]);
    await window.hermesAPI.spsUpdateVoiceCapture(capture.id, {
      status: "added_to_page",
    });
    await refresh();
  }

  async function askAssistant(capture: VoiceCapture): Promise<void> {
    const text = capture.transcript.trim();
    if (!text) return;
    runAgent(text, `Voice: ${text.slice(0, 48)}`);
    await window.hermesAPI.spsUpdateVoiceCapture(capture.id, {
      status: "sent_to_assistant",
    });
    await refresh();
  }

  async function createTask(capture: VoiceCapture): Promise<void> {
    const text = capture.transcript.trim() || "Voice task";
    setBlocks((blocks) => [
      ...blocks,
      {
        id: uid("b"),
        type: "todo",
        text,
        done: false,
      },
    ]);
    await window.hermesAPI.spsUpdateVoiceCapture(capture.id, {
      status: "task_created",
    });
    await refresh();
  }

  async function discard(capture: VoiceCapture): Promise<void> {
    await window.hermesAPI.spsUpdateVoiceCapture(capture.id, {
      status: "dismissed",
    });
    await refresh();
  }

  return (
    <div className="surface voice-surface">
      <div className="surface-head">
        <div>
          <h1>Voice</h1>
          <p>Capture thoughts, review transcripts, and decide what they become.</p>
        </div>
      </div>

      {!hasKey && (
        <div className="settings-field-hint">
          Voice transcription is not configured. Add VOICE_TOOLS_OPENAI_KEY to use transcription.
        </div>
      )}
      {error && (
        <div className="settings-field-hint" style={{ color: "var(--danger, #c00)" }}>
          {error}
        </div>
      )}

      <section className="voice-capture-panel">
        <VoiceCaptureButton
          source={{
            type: "voice_surface",
            pageId: page,
            pageTitle: meta[page]?.title,
          }}
          onCaptured={(capture) => setCaptures((rows) => [capture, ...rows])}
        />
      </section>

      <section className="voice-capture-list">
        {captures.length === 0 ? (
          <div className="ck-empty">No voice captures yet.</div>
        ) : (
          captures.map((capture) => (
            <article key={capture.id} className={`voice-capture-card is-${capture.status}`}>
              <header>
                <strong>{capture.source.pageTitle || "Voice capture"}</strong>
                <span>{capture.status}</span>
              </header>
              <audio src={assetUrl(capture.assetPath)} controls preload="metadata" />
              <div className="voice-capture-meta">
                <span>{capture.mime}</span>
                {capture.duration ? <span>{mmss(capture.duration)}</span> : null}
              </div>
              {capture.error && (
                <div className="settings-field-hint">{capture.error}</div>
              )}
              <textarea
                aria-label="Transcript"
                value={capture.transcript}
                onChange={(e) => {
                  const value = e.target.value;
                  setCaptures((rows) =>
                    rows.map((row) =>
                      row.id === capture.id ? { ...row, transcript: value } : row,
                    ),
                  );
                }}
                onBlur={(e) => void updateTranscript(capture.id, e.target.value)}
                placeholder="Transcript will appear here..."
              />
              <footer className="voice-capture-actions">
                <button className="cover-btn" onClick={() => void addToPage(capture)}>
                  <Icon name="doc" size={14} /> Add to page
                </button>
                <button className="cover-btn" onClick={() => void askAssistant(capture)}>
                  <Icon name="sparkle" size={14} /> Ask My Assistant
                </button>
                <button className="cover-btn" onClick={() => void createTask(capture)}>
                  <Icon name="checkbox" size={14} /> Create task
                </button>
                <button className="cover-btn" onClick={() => void discard(capture)}>
                  Discard
                </button>
              </footer>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Render surface**

In `App.tsx`, import and render:

```tsx
import { VoiceSurface } from "./voice/VoiceSurface";
```

```tsx
{surface === "voice" && <VoiceSurface />}
```

- [ ] **Step 4: Add sidebar item**

In `Sidebar.tsx`, under **My Assistant**, add:

```tsx
<button
  type="button"
  className={`nav-item ${surface === "voice" ? "active" : ""}`}
  onClick={() => setSurface("voice")}
  title="Capture and review voice notes"
  style={{ paddingLeft: 24 }}
>
  <Icon name="mic" size={17} />
  <span className="nav-label">Voice</span>
</button>
```

- [ ] **Step 5: Update sidebar test**

In `Sidebar.test.tsx`, assert:

```ts
expect(screen.getByText("Voice")).toBeInTheDocument();
```

- [ ] **Step 6: Validate shell**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 7: Voice Surface Renderer Tests

**Files:**
- Create: `src/renderer/src/screens/SpsAgent/voice/VoiceSurface.test.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/voice/VoiceSurface.tsx` if tests expose issues.

- [ ] **Step 1: Add tests**

Create `src/renderer/src/screens/SpsAgent/voice/VoiceSurface.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceSurface } from "./VoiceSurface";
import { useStore } from "../store";
import type { VoiceCapture } from "../../../../../shared/voice-captures";

const capture: VoiceCapture = {
  id: "voice-1",
  status: "pending",
  createdAt: 1,
  updatedAt: 1,
  assetPath: "abc.webm",
  mime: "audio/webm",
  name: "voice-note.webm",
  size: 100,
  duration: 5,
  transcript: "Follow up on payroll.",
  source: { type: "voice_surface", pageId: "home", pageTitle: "Home" },
};

beforeEach(() => {
  window.hermesAPI = {
    ...window.hermesAPI,
    getVoiceStatus: vi.fn().mockResolvedValue({ hasKey: true }),
    spsListVoiceCaptures: vi.fn().mockResolvedValue([capture]),
    spsUpdateVoiceCapture: vi.fn().mockResolvedValue(capture),
    spsCreateVoiceCapture: vi.fn(),
    transcribeAudio: vi.fn(),
  } as typeof window.hermesAPI;

  useStore.setState({
    page: "home",
    meta: { home: { title: "Home", icon: "🏠", cover: null } },
    docs: { home: [] },
  });
});

describe("VoiceSurface", () => {
  it("renders voice captures with transcript", async () => {
    render(<VoiceSurface />);
    expect(await screen.findByText("Follow up on payroll.")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("adds a capture to the current page", async () => {
    render(<VoiceSurface />);
    fireEvent.click(await screen.findByRole("button", { name: /Add to page/ }));

    await waitFor(() => {
      const blocks = useStore.getState().docs.home;
      expect(blocks.some((b) => b.type === "audio" && b.transcript === "Follow up on payroll.")).toBe(true);
      expect(blocks.some((b) => b.type === "p" && b.text === "Follow up on payroll.")).toBe(true);
      expect(window.hermesAPI.spsUpdateVoiceCapture).toHaveBeenCalledWith(
        "voice-1",
        { status: "added_to_page" },
      );
    });
  });

  it("creates a todo from a capture", async () => {
    render(<VoiceSurface />);
    fireEvent.click(await screen.findByRole("button", { name: /Create task/ }));

    await waitFor(() => {
      const blocks = useStore.getState().docs.home;
      expect(blocks.some((b) => b.type === "todo" && b.text === "Follow up on payroll.")).toBe(true);
    });
  });
});
```

If the store requires a full reset helper in existing tests, follow the local SPS store test pattern instead of partial `setState`.

- [ ] **Step 2: Run renderer tests**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/voice/VoiceSurface.test.tsx
```

Expected: PASS.

## Task 8: Global Voice Trigger Opens Voice Surface

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/App.tsx` or the nearest SPS shell component that registers app-level listeners.
- Test if existing shell tests cover global triggers; otherwise validate manually through smoke.

- [ ] **Step 1: Locate existing global voice listener**

Run:

```bash
rg -n "onGlobalVoiceTrigger|global-voice-trigger" src/renderer/src
```

Expected: find the current Chat listener.

- [ ] **Step 2: Add SPS listener**

In the SPS top-level component where `useStore` is available, add:

```tsx
useEffect(() => {
  const off = window.hermesAPI.onGlobalVoiceTrigger?.(() => {
    useStore.getState().setSurface("voice");
  });
  return () => {
    off?.();
  };
}, []);
```

If this conflicts with Chat’s existing listener, gate it so the listener only runs while the SPS app is mounted and does not steal focus from the standalone Chat screen.

- [ ] **Step 3: Validate typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

## Task 9: Voice In Capability Summary

**Files:**
- Modify: `src/renderer/src/screens/Settings/CapabilitySummary.tsx`

- [ ] **Step 1: Load voice status**

In `CapabilitySummary`, add:

```ts
voice: { hasKey: boolean };
```

to `CapabilitySnapshot`.

Change loading to include:

```ts
const loadVoice = window.hermesAPI.getVoiceStatus(profile);
Promise.all([loadSkills, loadTools, loadMcp, loadVoice])
  .then(([skills, tools, mcp, voice]) => {
    if (cancelled) return;
    setData({ skillCount: skills.length, tools, mcp, voice });
    setLoaded(true);
  })
```

- [ ] **Step 2: Render voice capability**

Add a count chip:

```tsx
<span className="cap-count">
  Voice {data.voice.hasKey ? "configured" : "not configured"}
</span>
```

Add a row when configured:

```tsx
{data.voice.hasKey && (
  <div className="cap-summary-row">
    <span className="cap-summary-label">Voice:</span>{" "}
    Press-to-talk transcription and read-aloud are enabled for this profile.
  </div>
)}
```

- [ ] **Step 3: Validate**

Run:

```bash
npm run typecheck
npx eslint --quiet src/renderer/src/screens/Settings/CapabilitySummary.tsx
```

Expected: PASS.

## Task 10: Styling

**Files:**
- Modify the smallest SPS stylesheet that owns `.vr-btn`, `.audio-transcript`, or surface cards.

- [ ] **Step 1: Locate styles**

Run:

```bash
rg -n "vr-btn|audio-transcript|surface-head|ck-empty|cover-btn" src/renderer/src/screens/SpsAgent/styles src/renderer/src/assets/main.css
```

Expected: identify existing SPS stylesheet.

- [ ] **Step 2: Add minimal styles**

Add:

```css
.voice-surface {
  padding: 24px;
}

.voice-capture-panel {
  margin: 16px 0;
}

.voice-capture-list {
  display: grid;
  gap: 12px;
}

.voice-capture-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-1);
  padding: 12px;
  display: grid;
  gap: 8px;
}

.voice-capture-card header,
.voice-capture-actions,
.voice-capture-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.voice-capture-card header {
  justify-content: space-between;
}

.voice-capture-meta {
  color: var(--tx-3);
  font-size: 12px;
}

.voice-capture-card textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
}

.voice-capture-control {
  display: grid;
  gap: 6px;
  justify-items: start;
}

.audio-transcript {
  margin-top: 8px;
  color: var(--tx-2);
  font-size: 13px;
}

.audio-transcript-label {
  color: var(--tx-3);
  font-size: 11px;
  text-transform: uppercase;
  margin-bottom: 3px;
}
```

- [ ] **Step 3: Validate**

Run:

```bash
npm run typecheck
```

Expected: PASS.

## Task 11: End-To-End Validation

**Files:** no edits unless validation exposes a real defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/voice.test.ts tests/voice-captures.test.ts tests/preload-api-surface.test.ts src/renderer/src/screens/SpsAgent/editor/blockMarkdown.test.ts src/renderer/src/screens/SpsAgent/voice/VoiceSurface.test.tsx src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run changed-file lint**

Run:

```bash
npx eslint --quiet src/shared/voice-captures.ts src/shared/sps-types.ts src/main/voice-captures.ts src/main/ipc/sps.ts src/preload/bridges/sps.ts src/preload/index.d.ts src/renderer/src/screens/SpsAgent/voice/VoiceCaptureButton.tsx src/renderer/src/screens/SpsAgent/voice/VoiceSurface.tsx src/renderer/src/screens/SpsAgent/editor/AudioBlock.tsx src/renderer/src/screens/SpsAgent/App.tsx src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx src/renderer/src/screens/Settings/CapabilitySummary.tsx
```

Expected: PASS. If repo-wide lint fails on unrelated existing files, report that separately.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Smoke**

Run after build:

```bash
node scripts/sps-smoke.mjs
```

Expected: PASS. Manually verify **Voice** appears under **My Assistant**, renders without a voice key, shows existing captures if any, and does not auto-start the microphone.

## Acceptance Criteria

- **Voice** appears under **My Assistant**.
- Voice surface loads without a configured voice key.
- Voice capture is explicit user action only.
- Captured audio is stored via the existing vault asset store.
- Transcription uses existing `transcribeAudio`; the key remains main-process only.
- Each capture is saved to `<profileHome>/sps-agent/voice-captures.json`.
- Captures show audio playback, transcript, status, and source page title where available.
- Transcript is editable before action.
- **Add to page** inserts an audio block plus transcript paragraph.
- Audio blocks can display a reviewed transcript.
- Audio block transcript metadata round-trips through existing markdown tier-2 metadata.
- **Ask My Assistant** sends the reviewed transcript through existing SPS assistant flow.
- **Create task** inserts a todo block from the reviewed transcript.
- **Discard** marks the capture dismissed.
- Settings capability summary shows whether voice is configured.
- Existing Chat push-to-talk and TTS tests still pass.
- No always-listening behavior is added.

## Follow-On Slice After V1

- Add “Learn This” action to create a pending learning proposal from a voice transcript.
- Add “Brief me” read-aloud presets for current page, today, and Active Work.
- Add voice command parsing for safe local intents: create task, search page, start note.
- Add optional raw-audio deletion after transcription.
- Add voice preference settings: default voice, playback speed, transcript language, retention.
- Add per-action confirmation for mutating commands.
- Consider realtime transcription only after the explicit capture workflow is trusted.

## Self-Review

- Spec coverage: voice becomes a dedicated surface, has capture/review/action lifecycle, remains consent-based, connects to pages/tasks/assistant, and exposes capability status.
- Placeholder scan: v1 tasks contain concrete files, code snippets, tests, and validation commands. Follow-on work is explicitly out of v1.
- Type consistency: `VoiceCapture`, `VoiceCaptureCreateInput`, `VoiceCapturePatch`, `transcript`, and `transcriptStatus` are used consistently across shared, main, preload, and renderer tasks.

