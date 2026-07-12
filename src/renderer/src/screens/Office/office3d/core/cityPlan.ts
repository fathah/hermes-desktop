/**
 * The city's master plan: where the bank, roads and showroom sit relative to
 * the office. Every system that needs to agree on geography (backdrop
 * generation, traffic, street furniture, building exclusion zones) reads from
 * here, so adding e.g. a ninth road is a one-line change.
 */
import { WORLD_W, WORLD_H } from "./constants";

// ── Bank dimensions (world units) ─────────────────────────────────────────
export const BANK_W = 22;
export const BANK_D = 18;
export const BANK_WALL_H = 3.2;
export const BANK_WALL_T = 0.25;
// Gap (street) between the south bank wall and the north office wall
export const BANK_STREET_GAP = 4.0;
// Bank centre (world units). Set explicitly so moving the bank doesn't drag
// the north road, which still keys off the office's original north lot below.
export const BANK_X = 67.63;
export const BANK_Z = 3.67;

// ── Office entrance (south wall doorway) ──────────────────────────────────
// The south perimeter wall has a real gap here: agents leaving on trips walk
// out through it (never through a wall), and the collision system keys its
// wall colliders off the same numbers. East of centre so it clears the
// HERMES HQ logo decal (which spans x -4..4 on the same wall).
export const OFFICE_DOOR_X = 6.0;
export const OFFICE_DOOR_W = 2.4;

// ── Backdrop roads (shared by CityBackdrop + TrafficLayer) ────────────────
export const ROAD_SOUTH_Z = WORLD_H / 2 + 4.5; // E-W road in front of office
export const ROAD_NORTH_Z = -(WORLD_H / 2 + BANK_STREET_GAP + BANK_D + 5); // E-W road behind the office's north lot
export const ROAD_EAST_X = WORLD_W / 2 + 4.5; // N-S roads, east/west (mirrored)
export const ROAD_WIDTH = 5.5;
// Road surface + centre-line dashes span this length so the carriageways run
// out into the fog (far = 280) instead of ending at a visible hard edge. The
// dashes are instanced (one draw call) so the long span is essentially free.
export const ROAD_LEN = 600;
// Cars loop only over the in-view stretch: looping the full ROAD_LEN would make
// traffic too sparse to read near the office and cost needless GLB instances.
export const TRAFFIC_LEN = 320;
// Outer ring spacing — a second set of roads one city block further out, so
// the grid reads as a district rather than a single block.
export const ROAD_OUTER_GAP = 27;
// Decal stacking heights above the ground plane (y = -0.02). Generous gaps —
// anything tighter z-fights at far camera distances.
export const ROAD_Y = 0.01;
export const ROAD_MARKING_Y = 0.03;

export interface RoadDef {
  /** Axis the road runs along ("x" = E-W, "z" = N-S). */
  axis: "x" | "z";
  /** The fixed cross-axis coordinate of the road's centre line. */
  center: number;
}

export const ROADS: RoadDef[] = [
  { axis: "x", center: ROAD_SOUTH_Z },
  { axis: "x", center: ROAD_NORTH_Z },
  { axis: "x", center: ROAD_SOUTH_Z + ROAD_OUTER_GAP },
  { axis: "x", center: ROAD_NORTH_Z - ROAD_OUTER_GAP },
  { axis: "z", center: ROAD_EAST_X },
  { axis: "z", center: -ROAD_EAST_X },
  { axis: "z", center: ROAD_EAST_X + ROAD_OUTER_GAP },
  { axis: "z", center: -ROAD_EAST_X - ROAD_OUTER_GAP },
];

// ── Car showroom (west of the office, glass front facing the HQ) ──────────
export const SHOWROOM_W = 16; // x extent
export const SHOWROOM_D = 20; // z extent
// Centred in the block between the west inner and outer roads.
export const SHOWROOM_X = -(ROAD_EAST_X + ROAD_OUTER_GAP / 2);
export const SHOWROOM_Z = 0;
export const SHOWROOM_WALL_H = 3.0;
export const SHOWROOM_WALL_T = 0.25;

// Cell centres kept building-free because the towers the grid rolled there
// blocked the default camera's view: one wedged in the gap between the office
// and bank lots, one right in front of the office entrance. Coordinates match
// the CityBackdrop grid (cell 5.0, 20×20).
export const VIEW_BLOCKER_SPOTS: Array<[number, number]> = [
  [-12.5, -17.5],
  [-7.5, 27.5],
];
