import type { ChatToolEvent } from "../shared/chat-stream";

export interface HermesApiCapabilities {
  features?: Record<string, unknown>;
  endpoints?: Record<string, { path?: unknown } | unknown>;
}

function boolFeature(
  capabilities: HermesApiCapabilities | null | undefined,
  name: string,
): boolean {
  return capabilities?.features?.[name] === true;
}

function endpointPath(
  capabilities: HermesApiCapabilities | null | undefined,
  name: string,
): string {
  const endpoint = capabilities?.endpoints?.[name];
  if (!endpoint || typeof endpoint !== "object") return "";
  const path = (endpoint as { path?: unknown }).path;
  return typeof path === "string" ? path : "";
}

export function supportsHermesRunsTransport(
  capabilities: HermesApiCapabilities | null | undefined,
): boolean {
  return (
    boolFeature(capabilities, "run_submission") &&
    boolFeature(capabilities, "run_events_sse") &&
    boolFeature(capabilities, "run_stop") &&
    boolFeature(capabilities, "run_approval_response") &&
    boolFeature(capabilities, "tool_progress_events") &&
    endpointPath(capabilities, "runs") === "/v1/runs" &&
    endpointPath(capabilities, "run_events") === "/v1/runs/{run_id}/events" &&
    endpointPath(capabilities, "run_approval") ===
      "/v1/runs/{run_id}/approval" &&
    endpointPath(capabilities, "run_stop") === "/v1/runs/{run_id}/stop"
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function runToolName(event: Record<string, unknown>): string {
  return stringValue(event.tool) || stringValue(event.tool_name) || "tool";
}

export function chatToolEventFromRunEvent(
  event: Record<string, unknown>,
): ChatToolEvent | null {
  const eventName = stringValue(event.event);
  if (!["tool.started", "tool.completed", "tool.failed"].includes(eventName)) {
    return null;
  }

  const name = runToolName(event);
  const status =
    eventName === "tool.completed"
      ? "completed"
      : eventName === "tool.failed"
        ? "failed"
        : "running";
  const runId = stringValue(event.run_id) || "run";
  const preview = stringValue(event.preview);
  const result =
    stringValue(event.result_text) ||
    stringValue(event.output) ||
    stringValue(event.result);

  return {
    callId: `${runId}:${name}`,
    hasStableCallId: false,
    name,
    status,
    ...(preview ? { preview } : {}),
    ...(result ? { result } : {}),
  };
}

export function runEventReasoningText(event: Record<string, unknown>): string {
  if (event.event !== "reasoning.available") return "";
  return stringValue(event.text) || stringValue(event.delta);
}

export function runCompletedUsage(event: Record<string, unknown>): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | null {
  if (event.event !== "run.completed") return null;
  const usage = event.usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  return {
    promptTokens: Number(u.input_tokens) || 0,
    completionTokens: Number(u.output_tokens) || 0,
    totalTokens: Number(u.total_tokens) || 0,
  };
}

export function parseRunSseBlock(
  block: string,
): { eventType: string; data: string } | null {
  let eventType = "";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6));
    }
  }
  if (dataLines.length === 0) return null;
  return { eventType, data: dataLines.join("\n") };
}
