import type { ChatToolEvent } from "../shared/chat-stream";

export interface GatewayEvent {
  payload?: Record<string, unknown>;
  session_id?: string;
  type: string;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function resultText(payload: Record<string, unknown>): string {
  const explicit = stringValue(payload.result_text);
  if (explicit) return explicit;

  const summary = stringValue(payload.summary);
  const result = payload.result;
  if (typeof result === "string") return result;
  if (result == null) return summary;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return summary;
  }
}

function previewText(payload: Record<string, unknown>): string {
  return (
    stringValue(payload.context) ||
    stringValue(payload.args_text) ||
    stringValue(payload.summary) ||
    stringValue(payload.name)
  );
}

export function gatewayReasoningText(event: GatewayEvent): string {
  // `reasoning.delta` is the live reasoning callback. `reasoning.available`
  // is a generic post-hoc preview signal from the gateway bridge; on some
  // transports/providers it can carry visible assistant text rather than
  // private reasoning, so canonical post-stream reasoning is left to the DB
  // reconciliation path instead.
  if (event.type !== "reasoning.delta") return "";
  return stringValue(event.payload?.text);
}

export function gatewayMessageDelta(event: GatewayEvent): string {
  if (event.type !== "message.delta") return "";
  return stringValue(event.payload?.text);
}

export function gatewayMessageCompleteText(event: GatewayEvent): string {
  if (event.type !== "message.complete") return "";
  return (
    stringValue(event.payload?.text) || stringValue(event.payload?.rendered)
  );
}

export function gatewayCompletionSuffix(
  streamedText: string,
  finalText: string,
): string {
  if (!finalText) return "";
  if (!streamedText.trim()) return finalText;
  if (finalText === streamedText) return "";
  if (finalText.startsWith(streamedText)) {
    return finalText.slice(streamedText.length);
  }
  if (finalText.trim() === streamedText.trim()) return "";
  return "";
}

export function gatewayUsage(event: GatewayEvent): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
} | null {
  if (event.type !== "message.complete") return null;
  const usage = event.payload?.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const u = usage as Record<string, unknown>;
  const promptTokens =
    numberValue(u.input) ??
    numberValue(u.prompt) ??
    numberValue(u.prompt_tokens);
  const completionTokens =
    numberValue(u.output) ??
    numberValue(u.completion) ??
    numberValue(u.completion_tokens);
  const totalTokens = numberValue(u.total) ?? undefined;
  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return null;
  }
  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: totalTokens ?? prompt + completion,
    ...(numberValue(u.cost_usd) != null
      ? { cost: numberValue(u.cost_usd) }
      : {}),
    ...(numberValue(u.cache_read) != null
      ? { cacheReadTokens: numberValue(u.cache_read) }
      : {}),
    ...(numberValue(u.cache_write) != null
      ? { cacheWriteTokens: numberValue(u.cache_write) }
      : {}),
  };
}

export function gatewayToolEvent(event: GatewayEvent): ChatToolEvent | null {
  if (event.type !== "tool.start" && event.type !== "tool.complete") {
    return null;
  }
  const payload = event.payload || {};
  const name = stringValue(payload.name) || "tool";
  const callId =
    stringValue(payload.tool_id) || `${event.session_id || "gateway"}:${name}`;
  const result = event.type === "tool.complete" ? resultText(payload) : "";
  return {
    callId,
    hasStableCallId: !!payload.tool_id,
    name,
    status: event.type === "tool.complete" ? "completed" : "running",
    label: name,
    preview: previewText(payload),
    ...(result ? { result } : {}),
  };
}
