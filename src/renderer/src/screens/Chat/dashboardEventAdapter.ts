import type { ChatToolEvent } from "../../../../shared/chat-stream";
import type { ActiveTurn, ChatBubbleMessage, ChatMessage } from "./types";

export interface DashboardStreamEvent<T = unknown> {
  payload?: T;
  session_id?: string;
  type: string;
}

export interface DashboardEventState {
  messages: ChatMessage[];
  reasoningSegmentClosed: boolean;
}

interface ApplyDashboardEventOptions {
  activeTurn?: ActiveTurn | null;
  now?: number;
  renderAssistantDeltas?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

const THINKING_STATUS_PREFIX_RE =
  /^\s*(?:(?:[^\s.]{1,16})\s+)?(?:processing|thinking|reasoning|analyzing|pondering|contemplating|musing|cogitating|ruminating|deliberating|mulling|reflecting|computing|synthesizing|formulating|brainstorming)\.\.\.\s*/i;

const EMPTY_THINKING_PLACEHOLDER_RE =
  /\b(?:current rewritten thinking|next thinking to process|provide the thinking content|don't see any .*thinking)\b/i;

function coerceGatewayText(value: unknown): string {
  const direct = stringValue(value);
  if (direct) return direct;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!isRecord(item)) return "";
        return stringValue(item.text) || stringValue(item.output_text);
      })
      .join("");
  }
  if (isRecord(value)) {
    return stringValue(value.text) || stringValue(value.output_text);
  }
  return String(value);
}

function coerceThinkingText(value: unknown): string {
  const raw = coerceGatewayText(value).replace(THINKING_STATUS_PREFIX_RE, "");
  return EMPTY_THINKING_PLACEHOLDER_RE.test(raw) ? "" : raw;
}

function textFromPayload(payload: unknown, ...keys: string[]): string {
  if (!isRecord(payload)) return "";
  for (const key of keys) {
    const value = coerceGatewayText(payload[key]);
    if (value) return value;
  }
  return "";
}

function thinkingTextFromPayload(payload: unknown, ...keys: string[]): string {
  if (!isRecord(payload)) return "";
  for (const key of keys) {
    const value = coerceThinkingText(payload[key]);
    if (value) return value;
  }
  return "";
}

function stableStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function previewFromPayload(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const direct = textFromPayload(
    payload,
    "preview",
    "label",
    "command",
    "context",
    "message",
  );
  if (direct) return direct;
  return (
    stableStringify(payload.args) ||
    stableStringify(payload.input) ||
    stableStringify(payload.arguments)
  );
}

function resultFromPayload(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const result =
    stableStringify(payload.result) ||
    stableStringify(payload.output) ||
    stableStringify(payload.content) ||
    textFromPayload(payload, "text");
  const error = stableStringify(payload.error);
  if (error && result) return `${result}\n\n${error}`;
  return error || result;
}

function payloadToolName(payload: unknown): string {
  if (!isRecord(payload)) return "";
  return textFromPayload(payload, "name", "tool", "function", "function_name");
}

function isClarifyToolEvent(event: DashboardStreamEvent): boolean {
  return payloadToolName(event.payload).toLowerCase() === "clarify";
}

function appendClarifyRequest(
  messages: ReadonlyArray<ChatMessage>,
  payload: unknown,
  now = Date.now(),
): ChatMessage[] {
  if (!isRecord(payload)) return [...messages];
  const requestId = textFromPayload(payload, "request_id", "id");
  const question = textFromPayload(payload, "question", "message", "text");
  if (!question.trim()) return [...messages];

  const choices = Array.isArray(payload.choices)
    ? payload.choices
        .map((choice) => stringValue(choice))
        .filter((choice) => choice.trim())
    : [];
  const content =
    choices.length > 0
      ? `${question}\n\n${choices
          .map((choice, index) => `${index + 1}. ${choice}`)
          .join("\n")}`
      : question;
  const id = `clarify-${requestId || `${now}-${messages.length}`}`;
  const existingIndex = messages.findIndex((message) => message.id === id);
  const bubble: ChatBubbleMessage = {
    id,
    role: "agent",
    content,
    pending: false,
    localOnly: true,
  };
  if (existingIndex >= 0) {
    return [
      ...messages.slice(0, existingIndex),
      bubble,
      ...messages.slice(existingIndex + 1),
    ];
  }
  return [...messages, bubble];
}

function toolEventFromGatewayEvent(event: DashboardStreamEvent): ChatToolEvent {
  const payload = isRecord(event.payload) ? event.payload : {};
  const name =
    textFromPayload(payload, "name", "tool", "function", "function_name") ||
    "tool";
  const callId =
    textFromPayload(payload, "tool_id", "tool_call_id", "callId", "id") ||
    `${name}:${previewFromPayload(payload) || event.type}`;
  const complete = event.type === "tool.complete";
  const failed = !!payload.error || stringValue(payload.status) === "failed";
  const status = complete ? (failed ? "failed" : "completed") : "running";
  const label = previewFromPayload(payload);
  const result = complete ? resultFromPayload(payload) : "";

  return {
    callId,
    hasStableCallId: !!textFromPayload(
      payload,
      "tool_id",
      "tool_call_id",
      "callId",
      "id",
    ),
    name,
    status,
    ...(label ? { label, preview: label } : {}),
    ...(result ? { result } : {}),
  };
}

function isAssistantBubble(msg: ChatMessage): msg is ChatBubbleMessage {
  const kind = (msg as { kind?: string }).kind;
  return msg.role === "agent" && (!kind || kind === "assistant");
}

function appendAssistantDelta(
  messages: ReadonlyArray<ChatMessage>,
  chunk: string,
  activeTurn?: ActiveTurn | null,
  now = Date.now(),
): ChatMessage[] {
  if (!chunk) return [...messages];
  const last = messages[messages.length - 1];
  if (
    last &&
    isAssistantBubble(last) &&
    !last.error &&
    (!activeTurn || !last.turnId || last.turnId === activeTurn.turnId)
  ) {
    return [
      ...messages.slice(0, -1),
      {
        ...last,
        content: last.content + chunk,
        pending: true,
        turnId: last.turnId || activeTurn?.turnId,
      },
    ];
  }

  return [
    ...messages,
    {
      id: `agent-dashboard-${now}-${messages.length}`,
      role: "agent",
      content: chunk,
      pending: true,
      ...(activeTurn?.turnId ? { turnId: activeTurn.turnId } : {}),
    },
  ];
}

function appendReasoningDelta(
  messages: ReadonlyArray<ChatMessage>,
  chunk: string,
  forceNewSegment: boolean,
  now = Date.now(),
): ChatMessage[] {
  if (!chunk) return [...messages];
  const last = messages[messages.length - 1];
  if (
    !forceNewSegment &&
    last &&
    last.role === "agent" &&
    "kind" in last &&
    last.kind === "reasoning"
  ) {
    return [
      ...messages.slice(0, -1),
      {
        ...last,
        text: last.text + chunk,
      },
    ];
  }

  return [
    ...messages,
    {
      id: `reasoning-dashboard-${now}-${messages.length}`,
      kind: "reasoning",
      role: "agent",
      text: chunk,
    },
  ];
}

function appendReasoningSnapshot(
  messages: ReadonlyArray<ChatMessage>,
  text: string,
  activeTurn?: ActiveTurn | null,
  now = Date.now(),
): ChatMessage[] {
  if (!text) return [...messages];
  if (hasAssistantText(messages, activeTurn)) return [...messages];

  const lastUserIndex = findLastUserIndex(messages);
  const keepReasoning = (msg: ChatMessage): boolean =>
    !("kind" in msg && msg.kind === "reasoning");

  return [
    ...messages.slice(0, lastUserIndex + 1),
    ...messages.slice(lastUserIndex + 1).filter(keepReasoning),
    {
      id: `reasoning-dashboard-${now}-${messages.length}`,
      kind: "reasoning",
      role: "agent",
      text,
    },
  ];
}

function findToolCallIndex(
  messages: ReadonlyArray<ChatMessage>,
  callId: string,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if ("kind" in msg && msg.kind === "tool_call" && msg.callId === callId) {
      return i;
    }
  }
  return -1;
}

function hasMatchingToolResult(
  messages: ReadonlyArray<ChatMessage>,
  callId: string,
  content: string,
): boolean {
  return messages.some(
    (msg) =>
      "kind" in msg &&
      msg.kind === "tool_result" &&
      msg.callId === callId &&
      msg.content === content,
  );
}

function appendToolEvent(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): ChatMessage[] {
  const detail = event.preview || event.label || "";
  if (
    event.status === "running" &&
    event.hasStableCallId === false &&
    !detail.trim()
  ) {
    return [...messages];
  }

  const toolIndex = findToolCallIndex(messages, event.callId);
  const next = [...messages];

  if (toolIndex >= 0) {
    const current = next[toolIndex];
    if ("kind" in current && current.kind === "tool_call") {
      next[toolIndex] = {
        ...current,
        name: event.name || current.name,
        args: detail || current.args,
        status: event.status,
      };
    }
  } else {
    next.push({
      id: `tool-call-${event.callId}`,
      kind: "tool_call",
      role: "agent",
      callId: event.callId,
      name: event.name || "tool",
      args: detail,
      status: event.status,
    });
  }

  if (event.result) {
    if (hasMatchingToolResult(next, event.callId, event.result)) {
      return next;
    }
    next.push({
      id: `tool-result-${event.callId}-${next.length}`,
      kind: "tool_result",
      role: "agent",
      callId: event.callId,
      name: event.name || "tool",
      content: event.result,
    });
  }

  return next;
}

function completeAssistantBubbles(
  messages: ReadonlyArray<ChatMessage>,
): ChatMessage[] {
  return messages.map((msg) =>
    isAssistantBubble(msg) && msg.pending ? { ...msg, pending: false } : msg,
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Length of the longest suffix of `a` that is also a prefix of `b`, used to
 * stitch a re-streamed boundary without duplicating the shared run. The
 * overlap is rejected when it would splice the middle of a word on either
 * side (e.g. `"…worl" + "d…"`), so a coincidental shared character isn't
 * treated as a real seam. Punctuation and whitespace are valid seams.
 */
function commonSuffixLength(a: string, b: string): number {
  let i = a.length - 1;
  let j = b.length - 1;
  let n = 0;
  while (i >= 0 && j >= 0 && a[i] === b[j]) {
    i--;
    j--;
    n++;
  }
  return n;
}

function tailHeadOverlap(a: string, b: string): number {
  const word = /\w/;
  const max = Math.min(a.length, b.length);
  for (let k = max; k > 0; k--) {
    if (!a.endsWith(b.slice(0, k))) continue;
    const aStart = a.length - k;
    const startsMidWord =
      aStart > 0 && word.test(a[aStart - 1]) && word.test(a[aStart]);
    const endsMidWord = k < b.length && word.test(b[k - 1]) && word.test(b[k]);
    if (!startsMidWord && !endsMidWord) return k;
  }
  return 0;
}

/**
 * Reconcile the text accumulated from streamed `message.delta` chunks with the
 * `final_response` delivered on `message.complete`.
 *
 * The streamed bubble can hold text produced *before* a tool call, while
 * `final_response` may carry only the last turn's text — so blindly
 * overwriting with the final text drops the pre-tool-call content (#746).
 * Other times the final text is the fuller version. Resolve both:
 *   - empty streamed   → final (the remote path never renders deltas, so the
 *                        bubble starts empty and final is all we have)
 *   - final ⊇ streamed → final
 *   - streamed ⊇ final → streamed (keeps the pre-tool-call text)
 *   - tail/head overlap → stitch, dropping the duplicated seam
 *   - otherwise        → concatenate with a blank-line separator so the two
 *                        segments don't run together ("check.It's" / "4answer")
 *
 * Comparison is whitespace-insensitive; every branch returns trimmed text so
 * the result doesn't depend on which branch ran.
 */
export function mergeStreamedWithFinal(
  streamed: string,
  final: string,
): string {
  const streamedContent = streamed.trim();
  const finalContent = final.trim();
  if (!streamedContent) return finalContent;
  if (!finalContent) return streamedContent;

  const normStreamed = normalizeText(streamedContent);
  const normFinal = normalizeText(finalContent);
  if (normFinal.includes(normStreamed)) return finalContent;
  if (normStreamed.includes(normFinal)) return streamedContent;

  const overlap = tailHeadOverlap(streamedContent, finalContent);
  if (overlap > 0) return `${streamedContent}${finalContent.slice(overlap)}`;

  // A re-streamed correction: the streamed deltas were garbled (e.g. a
  // corrupted CJK prefix) but converged on the same ending as the final text.
  // When the two share a substantial common tail they are the *same* sentence,
  // not the pre-tool-call + answer pair that the concatenate branch handles —
  // so the clean final replaces the garbled stream instead of stacking a near
  // duplicate above it.
  const suffix = commonSuffixLength(streamedContent, finalContent);
  if (suffix > 0) {
    const shared = finalContent.slice(finalContent.length - suffix);
    const meaningful = shared.replace(/[\s\p{P}]/gu, "").length;
    const shorter = Math.min(streamedContent.length, finalContent.length);
    if (meaningful >= 3 && suffix / shorter >= 0.5) return finalContent;
  }

  return `${streamedContent}\n\n${finalContent}`;
}

function findLastUserIndex(messages: ReadonlyArray<ChatMessage>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function hasAssistantText(
  messages: ReadonlyArray<ChatMessage>,
  activeTurn?: ActiveTurn | null,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if (!isAssistantBubble(msg) || msg.error) continue;
    if (activeTurn && msg.turnId && msg.turnId !== activeTurn.turnId) continue;
    if (normalizeText(msg.content)) return true;
  }
  return false;
}

function removeDuplicateReasoning(
  messages: ReadonlyArray<ChatMessage>,
  finalText: string,
  activeTurn?: ActiveTurn | null,
): ChatMessage[] {
  const final = normalizeText(finalText);
  if (!final) return [...messages];

  const lastUserIndex = findLastUserIndex(messages);
  return messages.filter((msg, index) => {
    if (index <= lastUserIndex) return true;
    if (!("kind" in msg) || msg.kind !== "reasoning") return true;
    if (
      activeTurn &&
      "turnId" in msg &&
      msg.turnId &&
      msg.turnId !== activeTurn.turnId
    ) {
      return true;
    }

    const reasoning = normalizeText(msg.text);
    return !(
      reasoning &&
      (final.startsWith(reasoning) || reasoning.startsWith(final))
    );
  });
}

function hasReasoningSinceLastUser(
  messages: ReadonlyArray<ChatMessage>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if ("kind" in msg && msg.kind === "reasoning" && normalizeText(msg.text)) {
      return true;
    }
  }
  return false;
}

function addCompletionReasoningFallback(
  messages: ReadonlyArray<ChatMessage>,
  finalText: string,
  reasoningText: string,
  now = Date.now(),
): ChatMessage[] {
  const reasoning = normalizeText(reasoningText);
  if (!reasoning || hasReasoningSinceLastUser(messages)) return [...messages];

  const final = normalizeText(finalText);
  if (final && (final.startsWith(reasoning) || reasoning.startsWith(final))) {
    return [...messages];
  }

  const reasoningRow: ChatMessage = {
    id: `reasoning-dashboard-${now}-${messages.length}`,
    kind: "reasoning",
    role: "agent",
    text: reasoningText,
  };

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if (isAssistantBubble(msg)) {
      return [...messages.slice(0, i), reasoningRow, ...messages.slice(i)];
    }
  }

  return [...messages, reasoningRow];
}

function completeAssistantWithFinalText(
  messages: ReadonlyArray<ChatMessage>,
  finalText: string,
  activeTurn?: ActiveTurn | null,
  now = Date.now(),
): ChatMessage[] {
  if (!finalText.trim()) return completeAssistantBubbles(messages);

  const messagesWithoutDuplicateReasoning = removeDuplicateReasoning(
    messages,
    finalText,
    activeTurn,
  );

  for (let i = messagesWithoutDuplicateReasoning.length - 1; i >= 0; i--) {
    const msg = messagesWithoutDuplicateReasoning[i];
    if (msg.role === "user") break;
    if (!isAssistantBubble(msg) || msg.error) continue;
    if (activeTurn && msg.turnId && msg.turnId !== activeTurn.turnId) continue;

    // Merge streamed text with finalText so content streamed before tool
    // calls is preserved rather than clobbered by a last-turn-only
    // final_response (#746).
    const merged = mergeStreamedWithFinal(msg.content, finalText);

    return [
      ...messagesWithoutDuplicateReasoning.slice(0, i),
      {
        ...msg,
        content: merged,
        pending: false,
        turnId: msg.turnId || activeTurn?.turnId,
      },
      ...messagesWithoutDuplicateReasoning.slice(i + 1),
    ];
  }

  return [
    ...messagesWithoutDuplicateReasoning,
    {
      id: `agent-dashboard-${now}-${messagesWithoutDuplicateReasoning.length}`,
      role: "agent",
      content: finalText,
      pending: false,
      ...(activeTurn?.turnId ? { turnId: activeTurn.turnId } : {}),
    },
  ];
}

export function applyDashboardStreamEvent(
  state: DashboardEventState,
  event: DashboardStreamEvent,
  options: ApplyDashboardEventOptions = {},
): DashboardEventState {
  const now = options.now ?? Date.now();
  switch (event.type) {
    case "message.start":
      return { ...state, reasoningSegmentClosed: false };
    case "message.delta":
      if (options.renderAssistantDeltas === false) {
        return {
          ...state,
          reasoningSegmentClosed: false,
        };
      }
      return {
        messages: appendAssistantDelta(
          state.messages,
          textFromPayload(event.payload, "text", "delta"),
          options.activeTurn,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    case "thinking.delta":
      return state;
    case "reasoning.delta":
      return {
        messages: appendReasoningDelta(
          state.messages,
          thinkingTextFromPayload(event.payload, "text", "delta", "reasoning"),
          state.reasoningSegmentClosed,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    case "reasoning.available":
      return {
        messages: appendReasoningSnapshot(
          state.messages,
          thinkingTextFromPayload(event.payload, "text", "delta", "reasoning"),
          options.activeTurn,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    case "tool.start":
    case "tool.progress":
    case "tool.generating":
    case "tool.complete":
      if (isClarifyToolEvent(event)) {
        return { ...state, reasoningSegmentClosed: true };
      }
      return {
        messages: appendToolEvent(
          state.messages,
          toolEventFromGatewayEvent(event),
        ),
        reasoningSegmentClosed: true,
      };
    case "clarify.request":
      return {
        messages: appendClarifyRequest(state.messages, event.payload, now),
        reasoningSegmentClosed: true,
      };
    case "message.complete": {
      const finalText = textFromPayload(event.payload, "text", "rendered");
      const finalReasoning = thinkingTextFromPayload(
        event.payload,
        "reasoning",
      );
      const messagesWithReasoning = addCompletionReasoningFallback(
        state.messages,
        finalText,
        finalReasoning,
        now,
      );
      return {
        messages: completeAssistantWithFinalText(
          messagesWithReasoning,
          finalText,
          options.activeTurn,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    }
    default:
      return state;
  }
}
