/** FleetSnapshot types — Phase 6B.
 *  Aligned with ~/.hermes/projections/fleet/snapshot.json Schema (fleet_v1).
 *  Desktop MUST NOT re-compute online/idle/offline, working, error,
 *  24h recency, agent assignment, or today stats.
 */
export interface FleetDiagnostic {
  code: string;
  message: string;
}

export interface FleetAgentStatus {
  fleet_agent_id: string;
  display_name: string;
  role: string;
  runtime: string | null;
  status: "online" | "idle" | "offline";
  working: boolean;
  error: boolean;
  current_task_id: string | null;
  current_run_id: string | null;
  last_active_at: string | null;
  today_task_count: number;
  today_cost_usd: number | null;
  session_count: number;
  diagnostics: FleetDiagnostic[];
}

export interface FleetSourceWatermark {
  gateway_state_updated_at: string | null;
  gateway_pid_alive: boolean;
}

export interface FleetUnassigned {
  unassigned_delegate_runs: number;
  unassigned_kanban_assignees: string[];
}

export interface FleetSummary {
  total: number;
  online: number;
  idle: number;
  offline: number;
  working: number;
  error: number;
}

export interface FleetSnapshot {
  schema_version: string;
  observed_at: string;
  source_watermark: FleetSourceWatermark;
  agents: FleetAgentStatus[];
  unassigned: FleetUnassigned;
  summary: FleetSummary;
  diagnostics: FleetDiagnostic[];
}

export type FleetSnapshotResult =
  | { ok: true; snapshot: FleetSnapshot }
  | { ok: false; error: string };

/** Runtime validator — TypeScript types are NOT a substitute. */
export function validateFleetSnapshot(data: unknown): FleetSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.schema_version !== "fleet_v1") return null;
  if (!Array.isArray(d.agents)) return null;
  if (!d.summary || typeof d.summary !== "object") return null;
  if (!d.observed_at || typeof d.observed_at !== "string") return null;
  return data as FleetSnapshot;
}
