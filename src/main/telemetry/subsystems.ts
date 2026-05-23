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
  PersonaTelemetry,
  ProfilesTelemetry,
  ProvidersTelemetry,
  RecentEventsTelemetry,
  SchedulesTelemetry,
  SessionsTelemetry,
  SkillsTelemetry,
  TelemetryEnvelope,
  ToolsTelemetry,
  UsageSummaryTelemetry,
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

export async function fetchSessions(
  limit?: number,
): Promise<TelemetryEnvelope<SessionsTelemetry>> {
  const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
  return telemetryGet<SessionsTelemetry>(`/v1/telemetry/sessions${qs}`);
}

export async function fetchSkills(): Promise<
  TelemetryEnvelope<SkillsTelemetry>
> {
  return telemetryGet<SkillsTelemetry>("/v1/telemetry/skills");
}

export async function fetchProfiles(): Promise<
  TelemetryEnvelope<ProfilesTelemetry>
> {
  return telemetryGet<ProfilesTelemetry>("/v1/telemetry/profiles");
}

export async function fetchProviders(): Promise<
  TelemetryEnvelope<ProvidersTelemetry>
> {
  return telemetryGet<ProvidersTelemetry>("/v1/telemetry/providers");
}

export async function fetchPersona(): Promise<
  TelemetryEnvelope<PersonaTelemetry>
> {
  return telemetryGet<PersonaTelemetry>("/v1/telemetry/persona");
}

export async function fetchRecentEvents(
  limit?: number,
  since?: string,
): Promise<TelemetryEnvelope<RecentEventsTelemetry>> {
  const params: string[] = [];
  if (limit) params.push(`limit=${encodeURIComponent(String(limit))}`);
  if (since) params.push(`since=${encodeURIComponent(since)}`);
  const qs = params.length ? "?" + params.join("&") : "";
  return telemetryGet<RecentEventsTelemetry>(
    `/v1/telemetry/recent-events${qs}`,
  );
}

export async function fetchUsageSummary(
  since?: string,
): Promise<TelemetryEnvelope<UsageSummaryTelemetry>> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  return telemetryGet<UsageSummaryTelemetry>(
    `/v1/telemetry/usage-summary${qs}`,
  );
}
