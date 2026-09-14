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

/** Minimal Kanban task shape needed to derive live Office activity. */
export interface OfficeTaskInput {
  assignee?: string | null;
  status?: string | null;
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
 * Map a desktop profile to an office agent. When Kanban activity is available,
 * a running assignment reads as "working" (green), otherwise "idle" (amber).
 * Gateway liveness is retained as separate metadata and as a compatibility
 * fallback for connection modes that cannot query Kanban.
 */
export function profileToOfficeAgent(
  profile: OfficeProfileInput,
  activeTaskCount?: number,
): OfficeAgent {
  const id = profile.id || profile.name;
  const seed = id || "agent";
  const agentName = profile.name;
  const color = AGENT_COLORS[hashName(seed) % AGENT_COLORS.length];
  // Use the profile id as the stable identifier for routing/gateway calls.
  return {
    id,
    name: agentName,
    subtitle: profile.model || profile.provider || null,
    status:
      activeTaskCount === undefined
        ? profile.gatewayRunning
          ? "working"
          : "idle"
        : activeTaskCount > 0
          ? "working"
          : "idle",
    color,
    item: "desk",
    avatarProfile: createAgentAvatarProfileFromSeed(seed),
    model: profile.model,
    provider: profile.provider,
    gatewayRunning: profile.gatewayRunning,
    activeTaskCount,
    position: "employee",
  };
}

function normalizeProfileId(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function countRunningTasksByAssignee(
  tasks: OfficeTaskInput[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status !== "running" || !task.assignee?.trim()) continue;
    const assignee = normalizeProfileId(task.assignee);
    counts.set(assignee, (counts.get(assignee) ?? 0) + 1);
  }
  return counts;
}

export function profilesToOfficeAgents(
  profiles: OfficeProfileInput[],
  tasks?: OfficeTaskInput[] | null,
): OfficeAgent[] {
  if (tasks == null) {
    return profiles.map((profile) => profileToOfficeAgent(profile));
  }

  const activeTasks = countRunningTasksByAssignee(tasks);
  return profiles.map((profile) => {
    const id = normalizeProfileId(profile.id || profile.name);
    return profileToOfficeAgent(profile, activeTasks.get(id) ?? 0);
  });
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
      before.gatewayRunning !== agent.gatewayRunning ||
      before.activeTaskCount !== agent.activeTaskCount
    );
  });
}
