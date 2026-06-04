import type { ChatToolEvent } from "../../../../shared/chat-stream";
import type { ChatMessage, ToolCallMessage } from "./types";

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

function isBubbleMessage(msg: ChatMessage): boolean {
  const kind = (msg as { kind?: string }).kind;
  return !kind || kind === "user" || kind === "assistant";
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
  const last = messages[messages.length - 1];
  if (last && last.role === "agent" && isBubbleMessage(last)) {
    return messages.length - 1;
  }
  return messages.length;
}

function findActiveTurnToolIndex(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): number {
  if (event.hasStableCallId !== false) {
    return findStableToolIndex(messages, event);
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
    return [
      ...messages.slice(0, index),
      {
        ...current,
        callId: event.callId || current.callId,
        name: event.name || current.name,
        args: updatedToolArgs(current, event),
        status: event.status,
      },
      ...messages.slice(index + 1),
    ];
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
  return [...messages.slice(0, insertAt), row, ...messages.slice(insertAt)];
}
