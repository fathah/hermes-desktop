import type { ChatToolEvent } from "../../../../shared/chat-stream";
import type { ChatMessage, ToolCallMessage, ToolResultMessage } from "./types";

const TOOL_PROGRESS_EMOJI_RE =
  /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\s+(.+)$/u;

function toolProgressToNameAndPreview(progress: string): {
  emoji?: string;
  name: string;
  preview: string;
} {
  const trimmed = progress.trim();
  const emojiMatch = TOOL_PROGRESS_EMOJI_RE.exec(trimmed);
  const emoji = emojiMatch?.[1];
  const text = (emojiMatch?.[2] || trimmed).trim();
  const firstWord = text.split(/\s+/)[0] || "tool";
  const name =
    firstWord === "python" || firstWord === "python3" || firstWord === "cmd"
      ? "terminal"
      : firstWord;
  return {
    ...(emoji ? { emoji } : {}),
    name,
    preview: text,
  };
}

export function liveToolEventFromProgress(progress: string): ChatToolEvent {
  const { emoji, name, preview } = toolProgressToNameAndPreview(progress);
  return {
    callId: `progress:${name}:${preview}`,
    hasStableCallId: false,
    name,
    status: "running",
    label: preview,
    ...(emoji ? { emoji } : {}),
    preview,
  };
}

function toolEventArgs(event: ChatToolEvent): string {
  return event.preview || event.label || "";
}

function updatedToolArgs(
  current: ToolCallMessage,
  event: ChatToolEvent,
): string {
  const nextArgs = toolEventArgs(event);
  if (!nextArgs) return current.args;
  if (event.status !== "running") {
    return current.args || nextArgs;
  }
  if (current.args && nextArgs === event.name) {
    return current.args;
  }
  return nextArgs;
}

function syntheticPrefix(event: ChatToolEvent): string {
  return `live-tool:${event.callId}:`;
}

function isSyntheticToolMatch(
  msg: ToolCallMessage,
  event: ChatToolEvent,
): boolean {
  return (
    msg.name === event.name && msg.callId.startsWith(syntheticPrefix(event))
  );
}

function findStableToolIndex(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if (
      "kind" in msg &&
      msg.kind === "tool_call" &&
      msg.callId === event.callId
    ) {
      return i;
    }
  }
  return -1;
}

function findLatestRunningSyntheticToolIndex(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if (
      "kind" in msg &&
      msg.kind === "tool_call" &&
      msg.status === "running" &&
      isSyntheticToolMatch(msg, event)
    ) {
      return i;
    }
  }
  return -1;
}

function findLatestRunningSyntheticToolByNameIndex(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if (
      "kind" in msg &&
      msg.kind === "tool_call" &&
      msg.status === "running" &&
      msg.name === event.name &&
      (msg.callId.startsWith("live-tool:") || msg.id.includes("live-tool:"))
    ) {
      return i;
    }
  }
  return -1;
}

function activeTurnSyntheticCount(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if (
      "kind" in msg &&
      msg.kind === "tool_call" &&
      isSyntheticToolMatch(msg, event)
    ) {
      count += 1;
    }
  }
  return count;
}

function liveToolInsertIndex(messages: ReadonlyArray<ChatMessage>): number {
  return messages.length;
}

function findToolResultIndex(
  messages: ReadonlyArray<ChatMessage>,
  callId: string,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if ("kind" in msg && msg.kind === "tool_result" && msg.callId === callId) {
      return i;
    }
  }
  return -1;
}

function upsertToolResultAfterCall(
  messages: ReadonlyArray<ChatMessage>,
  toolIndex: number,
  event: ChatToolEvent,
): ChatMessage[] {
  const result = event.result?.trim();
  if (!result) return [...messages];

  const call = messages[toolIndex] as ToolCallMessage | undefined;
  const callId = call?.callId || event.callId;
  const existingIndex = findToolResultIndex(messages, callId);
  const row: ToolResultMessage = {
    id: `tool-result-${callId}`,
    kind: "tool_result",
    role: "agent",
    callId,
    name: event.name || call?.name || "tool",
    content: result,
  };

  if (existingIndex >= 0) {
    return [
      ...messages.slice(0, existingIndex),
      row,
      ...messages.slice(existingIndex + 1),
    ];
  }

  const insertAt = Math.min(toolIndex + 1, messages.length);
  return [...messages.slice(0, insertAt), row, ...messages.slice(insertAt)];
}

function findActiveTurnToolIndex(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): number {
  if (event.hasStableCallId !== false) {
    const stableIndex = findStableToolIndex(messages, event);
    if (stableIndex >= 0) return stableIndex;
    const syntheticIndex = findLatestRunningSyntheticToolByNameIndex(
      messages,
      event,
    );
    if (syntheticIndex >= 0) return syntheticIndex;
    return -1;
  }
  if (event.status === "running") {
    return -1;
  }
  return findLatestRunningSyntheticToolIndex(messages, event);
}

export function upsertLiveToolEvent(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): ChatMessage[] {
  const index = findActiveTurnToolIndex(messages, event);
  if (index >= 0) {
    const current = messages[index] as ToolCallMessage;
    const callId =
      event.hasStableCallId === false
        ? current.callId
        : event.callId || current.callId;
    const updated = [
      ...messages.slice(0, index),
      {
        ...current,
        callId,
        name: event.name || current.name,
        args: updatedToolArgs(current, event),
        status: event.status,
      },
      ...messages.slice(index + 1),
    ];
    return upsertToolResultAfterCall(updated, index, event);
  }

  const callId =
    event.hasStableCallId === false
      ? `${syntheticPrefix(event)}${activeTurnSyntheticCount(messages, event) + 1}`
      : event.callId || `${event.name}-${Date.now()}`;
  const insertAt = liveToolInsertIndex(messages);
  const row: ToolCallMessage = {
    id: `tool-call-${callId}`,
    kind: "tool_call",
    role: "agent",
    callId,
    name: event.name || "tool",
    args: toolEventArgs(event),
    status: event.status,
  };
  const inserted = [
    ...messages.slice(0, insertAt),
    row,
    ...messages.slice(insertAt),
  ];
  return upsertToolResultAfterCall(inserted, insertAt, event);
}
