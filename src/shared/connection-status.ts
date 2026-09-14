import type { AgentCapabilitySnapshot } from "./agent-capabilities";

export interface ConnectionStatusSnapshot {
  connectionId: string;
  checkedAt: number;
  health: "online" | "offline";
  latencyMs: number;
  authentication: "authenticated" | "required" | "not-required" | "unknown";
  version: string | null;
  capabilities: AgentCapabilitySnapshot;
}
