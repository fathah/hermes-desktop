/**
 * Extracted SSE parsing logic — testable without Electron or HTTP.
 */

export interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

/**
 * A dangerous-command approval request the gateway wants the user to decide.
 * Field shapes are normalized here from whatever aliases the gateway emits so
 * downstream (IPC + renderer) sees one stable contract. `id` is required — the
 * desktop must echo it back on /approve · /deny, and a default-deny on timeout
 * needs something to address.
 */
export interface ApprovalRequest {
  id: string;
  command?: string;
  toolName?: string;
  patternKey?: string;
  description?: string;
}

/** A filesystem checkpoint the gateway recorded before a mutating turn. */
export interface CheckpointEvent {
  id: string;
  label?: string;
  turn?: number;
  createdAt?: string;
}

/** Progress from a delegated subagent (parent→child delegation tree). */
export interface DelegateProgress {
  id: string;
  parentId?: string;
  goal?: string;
  status: string;
  depth?: number;
  tool?: string;
  label?: string;
}

export interface SseCallbacks {
  onChunk: (text: string) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: ParsedUsage) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  /** Gateway requested approval for a dangerous command (idea B1). */
  onApprovalRequest?: (req: ApprovalRequest) => void;
  /** Gateway recorded a filesystem checkpoint (idea B2). */
  onCheckpoint?: (cp: CheckpointEvent) => void;
  /** A delegated subagent reported progress (idea B3). */
  onDelegateProgress?: (p: DelegateProgress) => void;
}

/** Tool progress pattern: `emoji tool_name` or `emoji description` */
const toolProgressRe = /^`([^\s`]+)\s+([^`]+)`$/;

/**
 * Handler for one custom SSE `event:` type. Receives the already-parsed JSON
 * payload and the callback bag; returns true iff it consumed the event (the
 * relevant callback existed and the payload was well-formed enough to fire).
 */
type CustomEventHandler = (
  payload: Record<string, unknown>,
  cb: Partial<SseCallbacks>,
) => boolean;

/** Coerce an unknown value to a non-empty string, else undefined. */
function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/**
 * Dispatch table of custom SSE event types → handlers. Adding a new gateway
 * event is a single entry here; unknown event names fall through to "not
 * handled" so the stream is never corrupted by an unrecognized event.
 */
const CUSTOM_EVENT_HANDLERS: Record<string, CustomEventHandler> = {
  "hermes.tool.progress": (payload, cb) => {
    if (!cb.onToolProgress) return false;
    const label = str(payload.label) ?? str(payload.tool);
    if (!label) return false;
    const emoji = str(payload.emoji);
    cb.onToolProgress(emoji ? `${emoji} ${label}` : label);
    return true;
  },

  "hermes.approval.request": (payload, cb) => {
    if (!cb.onApprovalRequest) return false;
    const id =
      str(payload.id) ?? str(payload.approval_id) ?? str(payload.request_id);
    if (!id) return false; // can't address an approval without an id
    cb.onApprovalRequest({
      id,
      command: str(payload.command) ?? str(payload.cmd),
      toolName: str(payload.tool) ?? str(payload.tool_name),
      patternKey: str(payload.pattern) ?? str(payload.pattern_key),
      description: str(payload.description) ?? str(payload.reason),
    });
    return true;
  },

  "hermes.checkpoint": (payload, cb) => {
    if (!cb.onCheckpoint) return false;
    const id = str(payload.id) ?? str(payload.checkpoint_id);
    if (!id) return false;
    cb.onCheckpoint({
      id,
      label: str(payload.label) ?? str(payload.title),
      turn: typeof payload.turn === "number" ? payload.turn : undefined,
      createdAt:
        str(payload.created_at) ?? str(payload.createdAt) ?? str(payload.ts),
    });
    return true;
  },

  "hermes.delegate.progress": (payload, cb) => {
    if (!cb.onDelegateProgress) return false;
    const id = str(payload.id) ?? str(payload.task_id) ?? str(payload.agent_id);
    if (!id) return false;
    cb.onDelegateProgress({
      id,
      parentId: str(payload.parent_id) ?? str(payload.parentId),
      goal: str(payload.goal),
      status: str(payload.status) ?? "running",
      depth: typeof payload.depth === "number" ? payload.depth : undefined,
      tool: str(payload.tool) ?? str(payload.tool_name),
      label: str(payload.label),
    });
    return true;
  },
};

/**
 * Process a custom SSE event (e.g. hermes.tool.progress, hermes.approval.request).
 * Returns true if the event was recognized AND handled (callback fired).
 */
export function processCustomEvent(
  eventType: string,
  data: string,
  cb: Partial<SseCallbacks>,
): boolean {
  const handler = CUSTOM_EVENT_HANDLERS[eventType];
  if (!handler) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return false; // malformed — skip
  }
  if (typeof payload !== "object" || payload === null) return false;
  return handler(payload as Record<string, unknown>, cb);
}

export interface SseDataResult {
  done: boolean;
  hasContent: boolean;
  error?: string;
}

/**
 * Process a single SSE data payload (after `data: ` prefix is stripped).
 * Returns parsing result.
 */
export function processSseData(
  data: string,
  cb: SseCallbacks,
  state: { hasContent: boolean; lastError: string },
): SseDataResult {
  if (data === "[DONE]") {
    if (state.hasContent) {
      cb.onDone?.();
    }
    return { done: true, hasContent: state.hasContent, error: state.lastError };
  }

  try {
    const parsed = JSON.parse(data);

    // Capture error responses forwarded through SSE
    if (parsed.error) {
      state.lastError = parsed.error.message || JSON.stringify(parsed.error);
      return { done: false, hasContent: state.hasContent };
    }

    const delta = parsed.choices?.[0]?.delta;

    // Extract usage from final chunk
    if (parsed.usage && cb.onUsage) {
      cb.onUsage({
        promptTokens: parsed.usage.prompt_tokens || 0,
        completionTokens: parsed.usage.completion_tokens || 0,
        totalTokens: parsed.usage.total_tokens || 0,
        cost: parsed.usage.cost,
        rateLimitRemaining: parsed.usage.rate_limit_remaining,
        rateLimitReset: parsed.usage.rate_limit_reset,
      });
    }

    if (delta?.content) {
      const content = delta.content.trim();
      // Legacy: Detect tool progress lines injected into content
      const match = toolProgressRe.exec(content);
      if (match && cb.onToolProgress) {
        cb.onToolProgress(`${match[1]} ${match[2]}`);
      } else {
        state.hasContent = true;
        cb.onChunk(delta.content);
      }
    }
  } catch {
    /* malformed chunk — skip */
  }

  return { done: false, hasContent: state.hasContent };
}

/**
 * Parse a full SSE block (may contain `event:` and `data:` lines).
 * Returns { eventType, data } or null if no data line found.
 */
export function parseSseBlock(
  block: string,
): { eventType: string; data: string } | null {
  let eventType = "";
  let dataLine = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice(6);
    }
  }
  if (!dataLine) return null;
  return { eventType, data: dataLine };
}
