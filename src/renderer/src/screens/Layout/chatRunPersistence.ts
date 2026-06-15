import type { ChatRun } from "./chatRuns";
import type {
  ChatBubbleMessage,
  ChatMessage,
  ClarifyMessage,
  ReasoningMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "../Chat/types";

const RUNS_STORAGE_KEY = "hermes.chat.runs.v1";
const TRANSCRIPT_STORAGE_PREFIX = "hermes.chat.transcript.";
const MAX_RESTORED_RUNS = 12;

interface PersistedRunsState {
  activeRunId?: string;
  runs?: PersistedRunMeta[];
}

interface PersistedRunMeta {
  runId?: string;
  profile?: string;
  sessionId?: string | null;
  title?: string;
  updatedAt?: number;
}

interface RestoredRunsState {
  activeProfile: string;
  activeRunId: string;
  runs: ChatRun[];
}

function transcriptStorageKey(runId: string): string {
  return `${TRANSCRIPT_STORAGE_PREFIX}${runId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeAttachments(value: unknown): ChatBubbleMessage["attachments"] {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.filter(isRecord) as unknown as NonNullable<
    ChatBubbleMessage["attachments"]
  >;
  return attachments.length > 0 ? attachments : undefined;
}

function sanitizeBubbleMessage(
  row: Record<string, unknown>,
): ChatBubbleMessage | null {
  const role = row.role === "agent" || row.role === "user" ? row.role : null;
  if (!role) return null;
  const content = optionalString(row.content) ?? "";
  const error = optionalString(row.error);
  const attachments = sanitizeAttachments(row.attachments);
  if (!content.trim() && !error?.trim() && !attachments?.length) return null;

  return {
    id: optionalString(row.id) || `restored-${role}-${Date.now()}`,
    role,
    content,
    ...(row.kind === "user" || row.kind === "assistant"
      ? { kind: row.kind }
      : {}),
    ...(attachments ? { attachments } : {}),
    ...(error ? { error } : {}),
    ...(optionalBoolean(row.localOnly) ? { localOnly: true } : {}),
    ...(optionalString(row.turnId)
      ? { turnId: optionalString(row.turnId) }
      : {}),
    // A restored renderer snapshot cannot still be actively streaming.  Dropping
    // the pending flag keeps recovered assistant text eligible as context when
    // the dashboard has to recreate a runtime session from the visible transcript.
    pending: false,
  };
}

function sanitizeReasoningMessage(
  row: Record<string, unknown>,
): ReasoningMessage | null {
  const text = optionalString(row.text) ?? "";
  if (!text.trim()) return null;
  return {
    id: optionalString(row.id) || `restored-reasoning-${Date.now()}`,
    kind: "reasoning",
    role: "agent",
    text,
  };
}

function sanitizeToolCallMessage(
  row: Record<string, unknown>,
): ToolCallMessage | null {
  const name = optionalString(row.name) ?? "";
  const args = optionalString(row.args) ?? "";
  const callId = optionalString(row.callId) ?? "";
  if (!name && !args && !callId) return null;
  return {
    id: optionalString(row.id) || `restored-tool-call-${Date.now()}`,
    kind: "tool_call",
    role: "agent",
    callId,
    name,
    args,
    ...(row.status === "running" ||
    row.status === "completed" ||
    row.status === "failed"
      ? { status: row.status }
      : {}),
  };
}

function sanitizeToolResultMessage(
  row: Record<string, unknown>,
): ToolResultMessage | null {
  const content = optionalString(row.content) ?? "";
  const attachments = sanitizeAttachments(row.attachments);
  if (!content.trim() && !attachments?.length) return null;
  return {
    id: optionalString(row.id) || `restored-tool-result-${Date.now()}`,
    kind: "tool_result",
    role: "agent",
    callId: optionalString(row.callId) ?? "",
    name: optionalString(row.name) ?? "",
    content,
    ...(attachments ? { attachments } : {}),
  };
}

function sanitizeClarifyMessage(
  row: Record<string, unknown>,
): ClarifyMessage | null {
  const requestId = optionalString(row.requestId) ?? "";
  const question = optionalString(row.question) ?? "";
  if (!requestId || !question) return null;
  return {
    id: optionalString(row.id) || `restored-clarify-${requestId}`,
    kind: "clarify",
    role: "agent",
    requestId,
    question,
    choices: Array.isArray(row.choices)
      ? row.choices.filter(
          (choice): choice is string => typeof choice === "string",
        )
      : [],
    ...(optionalString(row.answer)
      ? { answer: optionalString(row.answer) }
      : {}),
    ...(optionalBoolean(row.resolved) ? { resolved: true } : {}),
  };
}

function sanitizeChatMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "reasoning":
      return sanitizeReasoningMessage(value);
    case "tool_call":
      return sanitizeToolCallMessage(value);
    case "tool_result":
      return sanitizeToolResultMessage(value);
    case "clarify":
      return sanitizeClarifyMessage(value);
    default:
      return sanitizeBubbleMessage(value);
  }
}

export function loadChatRunTranscript(runId: string): ChatMessage[] {
  if (!runId) return [];
  try {
    const raw = window.localStorage.getItem(transcriptStorageKey(runId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeChatMessage)
      .filter((message): message is ChatMessage => message !== null);
  } catch {
    return [];
  }
}

export function saveChatRunTranscript(
  runId: string,
  messages: ReadonlyArray<ChatMessage>,
): void {
  if (!runId) return;
  try {
    if (messages.length === 0) {
      window.localStorage.removeItem(transcriptStorageKey(runId));
      return;
    }
    window.localStorage.setItem(
      transcriptStorageKey(runId),
      JSON.stringify(messages),
    );
  } catch {
    // localStorage can be unavailable or full.  The canonical Hermes session DB
    // still remains the primary source for completed turns; this snapshot is a
    // best-effort crash/reload safety net for renderer-visible state.
  }
}

export function deleteChatRunTranscript(runId: string): void {
  if (!runId) return;
  try {
    window.localStorage.removeItem(transcriptStorageKey(runId));
  } catch {
    /* ignore */
  }
}

export function persistChatRunsState(
  runs: ReadonlyArray<ChatRun>,
  activeRunId: string,
): void {
  try {
    const persisted: PersistedRunsState = {
      activeRunId,
      runs: runs.slice(-MAX_RESTORED_RUNS).map((run) => ({
        runId: run.runId,
        profile: run.profile,
        sessionId: run.sessionId,
        title: run.title,
        updatedAt: Date.now(),
      })),
    };
    window.localStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* ignore */
  }
}

export function restoreChatRunsState(): RestoredRunsState | null {
  try {
    const raw = window.localStorage.getItem(RUNS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.runs)) return null;

    const runs: ChatRun[] = [];
    const seen = new Set<string>();
    for (const item of parsed.runs) {
      if (!isRecord(item)) continue;
      const runId = optionalString(item.runId);
      const profile = optionalString(item.profile) || "default";
      if (!runId || seen.has(runId)) continue;
      seen.add(runId);
      runs.push({
        runId,
        profile,
        sessionId: optionalString(item.sessionId) ?? null,
        loading: false,
        ...(optionalString(item.title)
          ? { title: optionalString(item.title) }
          : {}),
        seed: loadChatRunTranscript(runId),
      });
    }

    if (runs.length === 0) return null;
    const storedActiveRunId = optionalString(parsed.activeRunId);
    const activeRunId =
      storedActiveRunId && runs.some((run) => run.runId === storedActiveRunId)
        ? storedActiveRunId
        : runs[0].runId;
    const activeProfile =
      runs.find((run) => run.runId === activeRunId)?.profile || runs[0].profile;

    return { activeRunId, activeProfile, runs };
  } catch {
    return null;
  }
}
