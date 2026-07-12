import { createAgentAvatarProfileFromSeed } from "./avatars/profile";
import type { OfficeAgent } from "./core/types";

/**
 * A profile as surfaced by the desktop's `listProfiles` IPC. Only the fields
 * the office needs to render an agent are required here.
 */
export interface OfficeProfileInput {
  id?: string;
  name: string;
  /**
   * Unique, stable identifier for the profile (the on-disk profile path from
   * `listProfiles`). Used as the agent's React key / lookup id so two profiles
   * sharing a display name don't collapse into one agent. Falls back to the
   * name when absent.
   */
  path?: string;
  model?: string;
  provider?: string;
  gatewayRunning?: boolean;
}

// Stable, pleasant accent colors keyed off the profile name so each agent keeps
// the same color between renders.
const AGENT_COLORS = [
  "#7090ff",
  "#34d399",
  "#f59e0b",
  "#f43f5e",
  "#8b5cf6",
  "#0891b2",
  "#db2777",
  "#22c55e",
];

function hashName(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Map a desktop profile to an office agent. Each profile becomes one 3D agent;
 * a running gateway reads as "working" (green), otherwise "idle" (amber).
 */
export function profileToOfficeAgent(profile: OfficeProfileInput): OfficeAgent {
  const id = profile.id || profile.name;
  const seed = id || "agent";
  const agentName = profile.name;
  const color = AGENT_COLORS[hashName(seed) % AGENT_COLORS.length];
  // Use the profile id as the stable identifier for routing/gateway calls.
  return {
    id,
    name: agentName,
    subtitle: profile.model || profile.provider || null,
    status: profile.gatewayRunning ? "working" : "idle",
    color,
    item: "desk",
    avatarProfile: createAgentAvatarProfileFromSeed(seed),
    model: profile.model,
    provider: profile.provider,
    gatewayRunning: profile.gatewayRunning,
    position: "employee",
  };
}

export function profilesToOfficeAgents(
  profiles: OfficeProfileInput[],
): OfficeAgent[] {
  return profiles.map(profileToOfficeAgent);
}

export function officeAgentsChanged(
  previous: OfficeAgent[],
  next: OfficeAgent[],
): boolean {
  if (next.length !== previous.length) return true;
  const previousById = new Map(previous.map((agent) => [agent.id, agent]));
  return next.some((agent) => {
    const before = previousById.get(agent.id);
    return (
      !before ||
      before.name !== agent.name ||
      before.subtitle !== agent.subtitle ||
      before.status !== agent.status ||
      before.model !== agent.model ||
      before.provider !== agent.provider ||
      before.gatewayRunning !== agent.gatewayRunning
    );
  });
}
