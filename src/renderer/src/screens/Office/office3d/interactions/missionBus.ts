/**
 * Mission bus: the imperative bridge between the DOM side of the Office tab
 * (chat, modals, camera in Office.tsx) and the 3D simulation (AgentsLayer's
 * per-frame controller inside the r3f Canvas). React context doesn't cross
 * the Canvas boundary and the sim mutates refs without re-rendering, so this
 * is a tiny module-level pub/sub — plain Sets, no React, no allocations in
 * the frame path.
 *
 * A mission is one commanded errand: an agent walks the existing trip route
 * to a destination, optionally stops at a facility (teller counter, ATM),
 * reports arrival, holds while the interaction modal is open, and walks home
 * when the mission is completed (or times out).
 */
import type { RepActionId } from "./registry";
import type { WorldPlace } from "./worldActions";

export interface MissionInteraction {
  /** Space representative to stop at and open (registry id). */
  repId: string;
  /** Rep-panel action to auto-run when the modal opens. */
  actionId: RepActionId;
}

export interface Mission {
  id: string;
  agentId: string;
  dest: WorldPlace;
  interaction: MissionInteraction | null;
}

export type MissionEvent =
  | { type: "arrived"; mission: Mission }
  | { type: "ended"; mission: Mission };

type Listener<T> = (value: T) => void;

const missionListeners = new Set<Listener<Mission>>();
const completeListeners = new Set<Listener<string>>();
const eventListeners = new Set<Listener<MissionEvent>>();

let missionSeq = 0;

export function makeMissionId(): string {
  missionSeq += 1;
  return `mission-${missionSeq}`;
}

/** Command an agent onto a mission (consumed by AgentsLayer). */
export function dispatchMission(mission: Mission): void {
  for (const cb of missionListeners) cb(mission);
}

export function onMission(cb: Listener<Mission>): () => void {
  missionListeners.add(cb);
  return () => missionListeners.delete(cb);
}

/** The interaction finished (modal closed) — the agent may head home. */
export function completeMission(missionId: string): void {
  for (const cb of completeListeners) cb(missionId);
}

export function onMissionComplete(cb: Listener<string>): () => void {
  completeListeners.add(cb);
  return () => completeListeners.delete(cb);
}

/** Sim → UI progress (arrival at the destination, mission over). */
export function emitMissionEvent(event: MissionEvent): void {
  for (const cb of eventListeners) cb(event);
}

export function onMissionEvent(cb: Listener<MissionEvent>): () => void {
  eventListeners.add(cb);
  return () => eventListeners.delete(cb);
}
