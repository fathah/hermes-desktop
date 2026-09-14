export interface ChatToolEvent {
  callId: string;
  hasStableCallId?: boolean;
  name: string;
  status: "running" | "completed" | "failed";
  label?: string;
  emoji?: string;
  preview?: string;
  result?: string;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function chatToolEventFromPayload(
  payload: Record<string, unknown>,
): ChatToolEvent {
  const tool = stringValue(payload.tool);
  const label = stringValue(payload.label) || tool;
  const name = tool || label || "tool";
  const rawStatus = stringValue(payload.status);
  const status =
    rawStatus === "completed" || rawStatus === "failed" ? rawStatus : "running";
  const explicitCallId =
    stringValue(payload.toolCallId) ||
    stringValue(payload.tool_call_id) ||
    stringValue(payload.callId);
  const callId = explicitCallId || `${name}:${label}`;
  const emoji = stringValue(payload.emoji);
  const preview = stringValue(payload.preview);
  const result = stringValue(payload.result);

  return {
    callId,
    hasStableCallId: !!explicitCallId,
    name,
    status,
    ...(label ? { label } : {}),
    ...(emoji ? { emoji } : {}),
    ...(preview ? { preview } : {}),
    ...(result ? { result } : {}),
  };
}

export function chatToolProgressLabel(event: ChatToolEvent): string {
  const label = event.label || event.name;
  return event.emoji ? `${event.emoji} ${label}` : label;
}
