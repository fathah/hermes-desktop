/**
 * IPC handlers for the four per-subsystem telemetry endpoints
 * (tools / memory / schedules / kanban). Each one is a thin
 * pass-through to the backend's `/v1/telemetry/<name>` endpoint.
 *
 * Kept in a single file because the bodies are tiny and share
 * the same shape — splitting them four ways would just add
 * import noise.
 */

import { telemetryGet } from "./client";
import type {
  KanbanTelemetry,
  MemoryTelemetry,
  SchedulesTelemetry,
  TelemetryEnvelope,
  ToolsTelemetry,
} from "../../shared/telemetry-types";

export async function fetchTools(
  profile?: string,
): Promise<TelemetryEnvelope<ToolsTelemetry>> {
  const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return telemetryGet<ToolsTelemetry>(`/v1/telemetry/tools${qs}`);
}

export async function fetchMemory(): Promise<
  TelemetryEnvelope<MemoryTelemetry>
> {
  return telemetryGet<MemoryTelemetry>("/v1/telemetry/memory");
}

export async function fetchSchedules(): Promise<
  TelemetryEnvelope<SchedulesTelemetry>
> {
  return telemetryGet<SchedulesTelemetry>("/v1/telemetry/schedules");
}

export async function fetchKanban(): Promise<
  TelemetryEnvelope<KanbanTelemetry>
> {
  return telemetryGet<KanbanTelemetry>("/v1/telemetry/kanban");
}
