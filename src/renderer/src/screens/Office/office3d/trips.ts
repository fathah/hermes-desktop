/**
 * Walking trips agents take from the office to the other buildings. Routes
 * are hand-authored waypoint chains in the same canvas space the office
 * simulation uses — the canvas↔world mapping is linear, so points outside the
 * office's 0..1800 rectangle (the bank sits at canvas x≈5150) work unchanged.
 * Idle agents occasionally follow a route out, wander the destination's
 * interior for a while, then walk the same route home in reverse.
 */
import { worldToCanvas } from "./core/geometry";
import {
  BANK_X,
  BANK_Z,
  SHOWROOM_X,
  SHOWROOM_Z,
  OFFICE_DOOR_X,
} from "./core/cityPlan";
import type { AgentPlace } from "./core/types";

export interface TripRoute {
  /** Destination building (used for the agent's `place` while inside). */
  dest: Extract<AgentPlace, "bank" | "showroom">;
  /** Waypoints from the rest room to just inside the destination's door. */
  points: Array<[number, number]>;
  /** First index that lies outside the office building. */
  exitOfficeIdx: number;
  /** Interior wander stops inside the destination. */
  wander: Array<[number, number]>;
}

// ── Tuning ─────────────────────────────────────────────────────────────────
/** At most this many agents are away from the office at once. */
export const TRIP_MAX_TRAVELLERS = 2;
/** Per-second chance an idle, seated agent decides to head out. */
export const TRIP_CHANCE_PER_SEC = 0.02;
/** How long an agent hangs around inside the destination (ms). */
export const TRIP_WANDER_MS: [number, number] = [15_000, 35_000];
/** Pause at each interior wander stop (ms). */
export const TRIP_DWELL_MS: [number, number] = [2_500, 6_000];
/** Outdoor walking speed (canvas units/s) — brisker than the office amble. */
export const TRIP_WALK_SPEED = 170;

// Inside-office leg: from the rest room straight to just inside the south
// entrance doorway. Trips only start from rest-room seats (east of the
// partition) and the doorway is also east of the partition, so the line
// never crosses the divider wall.
const OFFICE_TO_DOOR: Array<[number, number]> = [
  worldToCanvas(OFFICE_DOOR_X, 15.4),
];

// City legs are authored in world coordinates (cityPlan space) and converted.
// z≈17.2 is the sidewalk strip between the office's south wall (z=16.2) and
// the south road's edge (z≈17.95).
const SIDEWALK_Z = 17.2;

const BANK_OUTDOOR_WORLD: Array<[number, number]> = [
  [OFFICE_DOOR_X, SIDEWALK_Z], // straight out through the doorway
  [20.7, SIDEWALK_Z],
  [46, SIDEWALK_Z],
  [BANK_X, SIDEWALK_Z],
  [BANK_X, 14.3], // outside the bank's south-wall doorway
  [BANK_X, 10.6], // just inside
];

// Wander stops inside the bank: entry hall, waiting sofas, the counter, and
// the east ATMs — mirrors where the bank's ambient NPCs walk.
const BANK_WANDER_WORLD: Array<[number, number]> = [
  [BANK_X, BANK_Z + 3.5],
  [BANK_X - 5.5, BANK_Z],
  [BANK_X, BANK_Z - 4.4],
  [BANK_X + 5, BANK_Z],
];

const SHOWROOM_OUTDOOR_WORLD: Array<[number, number]> = [
  [OFFICE_DOOR_X, SIDEWALK_Z], // straight out through the doorway
  [-20.7, SIDEWALK_Z],
  [SHOWROOM_X + 10, 6],
  [SHOWROOM_X + 9.8, SHOWROOM_Z], // outside the open entrance bay (east face)
  [SHOWROOM_X + 4.2, SHOWROOM_Z], // just inside
];

// Display-floor stops, clear of the parked cars and the hero pedestal.
const SHOWROOM_WANDER_WORLD: Array<[number, number]> = [
  [SHOWROOM_X + 5.3, SHOWROOM_Z - 4.5],
  [SHOWROOM_X + 4.2, SHOWROOM_Z],
  [SHOWROOM_X + 5.3, SHOWROOM_Z + 4.5],
];

function toCanvasPoints(
  world: Array<[number, number]>,
): Array<[number, number]> {
  return world.map(([wx, wz]) => worldToCanvas(wx, wz));
}

function buildRoute(
  dest: TripRoute["dest"],
  outdoorWorld: Array<[number, number]>,
  wanderWorld: Array<[number, number]>,
): TripRoute {
  return {
    dest,
    points: [...OFFICE_TO_DOOR, ...toCanvasPoints(outdoorWorld)],
    exitOfficeIdx: OFFICE_TO_DOOR.length,
    wander: toCanvasPoints(wanderWorld),
  };
}

export const TRIP_ROUTES: TripRoute[] = [
  buildRoute("bank", BANK_OUTDOOR_WORLD, BANK_WANDER_WORLD),
  buildRoute("showroom", SHOWROOM_OUTDOOR_WORLD, SHOWROOM_WANDER_WORLD),
];

/** Pick a destination — the bank is the more popular errand. */
export function pickTripRoute(rand: number): TripRoute {
  return TRIP_ROUTES[rand < 0.6 ? 0 : 1];
}

/**
 * Where an agent is while heading to (or back from, walking the same points
 * in reverse) `route.points[idx]`.
 */
export function classifyTripPlace(route: TripRoute, idx: number): AgentPlace {
  if (idx >= route.points.length - 1) return route.dest;
  if (idx >= route.exitOfficeIdx) return "outside";
  return "office";
}
