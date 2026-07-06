/**
 * Office layout in "canvas" space (0..1800 on both axes), matching the agent
 * simulation. A vertical partition splits the floor into a west **work area**
 * (one desk per agent) and an east **rest room** (lounge seating where agents
 * whose gateway is off go to sit). `facing` values are in radians.
 */

export type FurnitureType =
  | "desk"
  | "executiveDesk"
  | "chair"
  | "couch"
  | "sofaChair"
  | "beanbag"
  | "plant"
  | "whitePot"
  | "computer"
  | "pantry";

export interface FurniturePlacement {
  id: string;
  type: FurnitureType;
  /** Canvas-space placement point; interpreted by each furniture model's origin. */
  x: number;
  y: number;
  facingDeg: number;
  /** Optional tint override; `undefined` uses the type default, `null` keeps the model's own colors. */
  tint?: string | null;
}

export interface WallSegment {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Seat {
  x: number;
  y: number;
  facing: number;
}

export interface Workstation {
  id: string;
  agentId: string;
  deskX: number;
  deskY: number;
  deskFacingDeg: number;
  chairX: number;
  chairY: number;
  chairFacingDeg: number;
  seatX: number;
  seatY: number;
  seatFacing: number;
  /** The CEO's desk: rendered larger, tinted, and flanked with plants. */
  isExecutive?: boolean;
}

// ── Partition between work area (west) and rest room (east) ────────────────
export const DIVIDER_X = 1180;
// Doorway gap in the partition (agents pass through here between rooms).
export const DOOR_Y_MIN = 820;
export const DOOR_Y_MAX = 1000;
export const DOOR_Y = (DOOR_Y_MIN + DOOR_Y_MAX) / 2;

const WALL_TOP = 120;
const WALL_BOTTOM = 1680;
const PARTITION_THICKNESS = 16;

export const INTERIOR_WALLS: WallSegment[] = [
  {
    id: "partition-top",
    x: DIVIDER_X - PARTITION_THICKNESS / 2,
    y: WALL_TOP,
    w: PARTITION_THICKNESS,
    h: DOOR_Y_MIN - WALL_TOP,
  },
  {
    id: "partition-bottom",
    x: DIVIDER_X - PARTITION_THICKNESS / 2,
    y: DOOR_Y_MAX,
    w: PARTITION_THICKNESS,
    h: WALL_BOTTOM - DOOR_Y_MAX,
  },
];

// ── Desks (work area, west of the partition) ───────────────────────────────
const COLS = 5;
const ORIGIN_X = 145;
const ORIGIN_Y = 300;
const SPACING_X = 210;
const SPACING_Y = 240;
const DESK_W = 100;
const CHAIR_FOOTPRINT = 24;

// ── CEO executive desk ─────────────────────────────────────────────────────
// The CEO gets a private glass-walled corner office in the south-west of the
// work area (see CEO_OFFICE / GLASS_WALLS below), set apart from the employee
// grid which fills the rows to the north, with surrounding decor
// (EXECUTIVE_DECOR).
//
// NOTE: ceo_desk.glb is modelled with its origin at the footprint CENTRE
// (unlike employee desk.glb, whose origin is a back corner), so CEO_DESK_X/Y is
// the desk's centre point — not its top-left. The seat sits due north of that
// centre, just clear of the desk's back edge: half the model depth (0.847 world
// units × 0.85 desk scale ÷ 2 ÷ SCALE ≈ 20 canvas) plus a small clearance gap.
const CEO_DESK_X = 300;
const CEO_DESK_Y = 1390;
const CEO_SEAT_BACK = 30;

// ── CEO glass corner office (south-west of the work area) ──────────────────
// The west and south sides are the building's perimeter walls; the north and
// east sides are clear glass partitions. The doorway gap sits in the east
// glass wall, on the straight walk-in line from the spawn point so agents
// (which have no pathfinder) enter without clipping a pane.
export const CEO_OFFICE = {
  minX: 40,
  maxX: 560,
  minY: 1150,
  maxY: 1790,
  doorYMin: 1440,
  doorYMax: 1620,
};
export const CEO_DOOR_Y = (CEO_OFFICE.doorYMin + CEO_OFFICE.doorYMax) / 2;

export const GLASS_WALLS: WallSegment[] = [
  {
    id: "ceo-glass-north",
    x: CEO_OFFICE.minX,
    y: CEO_OFFICE.minY - PARTITION_THICKNESS / 2,
    w: CEO_OFFICE.maxX - CEO_OFFICE.minX,
    h: PARTITION_THICKNESS,
  },
  {
    id: "ceo-glass-east-top",
    x: CEO_OFFICE.maxX - PARTITION_THICKNESS / 2,
    y: CEO_OFFICE.minY,
    w: PARTITION_THICKNESS,
    h: CEO_OFFICE.doorYMin - CEO_OFFICE.minY,
  },
  {
    id: "ceo-glass-east-bottom",
    x: CEO_OFFICE.maxX - PARTITION_THICKNESS / 2,
    y: CEO_OFFICE.doorYMax,
    w: PARTITION_THICKNESS,
    h: CEO_OFFICE.maxY - CEO_OFFICE.doorYMax,
  },
];

function buildEmployeeWorkstation(agentId: string, index: number): Workstation {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const deskX = ORIGIN_X + col * SPACING_X;
  const deskY = ORIGIN_Y + row * SPACING_Y;

  const seatX = deskX + DESK_W / 2 - 10;
  // Desk at facingDeg=0 has drawers on the North side, and extends from deskY-31 to deskY+1.
  // We place the agent North of the desk, facing South towards the drawers.
  const SEAT_BACK = 16;
  const seatY = deskY - 20 - SEAT_BACK;
  const seatFacing = 0; // Faces South towards the desk

  return {
    id: `desk-${index}`,
    agentId,
    deskX,
    deskY,
    deskFacingDeg: 0, // Desk extends North, drawers are on the North side
    // Chair footprint is centered under the agent
    chairX: seatX - CHAIR_FOOTPRINT / 2,
    chairY: seatY - CHAIR_FOOTPRINT / 2,
    chairFacingDeg: 0, // Faces South
    seatX,
    seatY,
    seatFacing,
  };
}

function buildCeoWorkstation(agentId: string): Workstation {
  // CEO_DESK_X/Y is the desk's CENTRE (see note above). Seat the agent on the
  // same vertical axis, north of the desk's back edge, facing south into it.
  const seatX = CEO_DESK_X;
  const seatY = CEO_DESK_Y - CEO_SEAT_BACK;
  const deskCenterX = CEO_DESK_X;
  const deskCenterY = CEO_DESK_Y;
  const seatFacing = Math.atan2(deskCenterX - seatX, deskCenterY - seatY);

  return {
    id: "desk-ceo",
    agentId,
    deskX: CEO_DESK_X,
    deskY: CEO_DESK_Y,
    deskFacingDeg: 180,
    chairX: seatX - CHAIR_FOOTPRINT / 2,
    chairY: seatY - CHAIR_FOOTPRINT / 2,
    chairFacingDeg: (seatFacing * 180) / Math.PI,
    seatX,
    seatY,
    seatFacing,
    isExecutive: true,
  };
}

/**
 * One desk per agent. Employees fill a grid; the CEO (if any) gets a separate
 * executive desk and is removed from the grid so it doesn't leave a gap.
 */
export function buildWorkstations(
  agentIds: string[],
  ceoId?: string | null,
): Workstation[] {
  const hasCeo = ceoId != null && agentIds.includes(ceoId);
  const employees = hasCeo ? agentIds.filter((id) => id !== ceoId) : agentIds;

  const stations = employees.map((agentId, index) =>
    buildEmployeeWorkstation(agentId, index),
  );
  if (hasCeo) stations.push(buildCeoWorkstation(ceoId));
  return stations;
}

/**
 * Decorative furniture inside the CEO's glass corner office, rendered only
 * when a CEO exists: a visitor lounge (couch + two leather guest armchairs
 * around the coffee table — the table itself is rendered in Office3D),
 * greenery along the west wall and planters flanking the doorway. The desk
 * also gets two flanking plants from the executive workstation.
 */
export const EXECUTIVE_DECOR: FurniturePlacement[] = [
  // Visitor couch facing the desk across the coffee table.
  {
    id: "ceo-couch",
    type: "couch",
    x: CEO_DESK_X - 30,
    y: CEO_DESK_Y + 140,
    facingDeg: 180,
    tint: "#2f3a4a",
  },
  // Leather guest armchairs angled in toward the coffee table, pushed out
  // far enough that the desk's flanking plants don't clip them.
  {
    id: "ceo-guest-chair-west",
    type: "sofaChair",
    x: CEO_DESK_X - 185,
    y: CEO_DESK_Y + 80,
    facingDeg: 115,
    tint: "#6b4f3a",
  },
  {
    id: "ceo-guest-chair-east",
    type: "sofaChair",
    x: CEO_DESK_X + 185,
    y: CEO_DESK_Y + 80,
    facingDeg: 245,
    tint: "#6b4f3a",
  },
  // Greenery along the west (window) wall.
  {
    id: "ceo-plant-nw",
    type: "plant",
    x: CEO_OFFICE.minX + 35,
    y: CEO_OFFICE.minY + 70,
    facingDeg: 0,
  },
  {
    id: "ceo-plant-sw",
    type: "plant",
    x: CEO_OFFICE.minX + 35,
    y: CEO_OFFICE.maxY - 110,
    facingDeg: 0,
  },
  // White planters just inside the glass door.
  {
    id: "ceo-whitepot-door-north",
    type: "whitePot",
    x: CEO_OFFICE.maxX - 60,
    y: CEO_OFFICE.doorYMin - 60,
    facingDeg: 0,
  },
  {
    id: "ceo-whitepot-door-south",
    type: "whitePot",
    x: CEO_OFFICE.maxX - 60,
    y: CEO_OFFICE.doorYMax + 20,
    facingDeg: 0,
  },
];

// ── Rest room (east of the partition) ──────────────────────────────────────
const REST_CENTER_X = 1435;
const REST_CENTER_Y = 760;

// Beanbag seat centers — agents whose gateway is off sit here.
const BEANBAG_CENTERS: Array<[number, number]> = [
  [1300, 400],
  [1560, 400],
  [1300, 820],
  [1560, 820],
  [1300, 1240],
  [1560, 1240],
];

const BEANBAG_TINTS = [
  "#5a4870",
  "#3d5575",
  "#6b4f3a",
  "#4a5568",
  "#7b341e",
  "#2d6048",
];

function facingToCenter(x: number, y: number): number {
  return Math.atan2(REST_CENTER_X - x, REST_CENTER_Y - y);
}

/** Seats agents sit on while resting (one per beanbag). */
export const REST_SEATS: Seat[] = BEANBAG_CENTERS.map(([x, y]) => ({
  x,
  y,
  facing: facingToCenter(x, y),
}));

/** All rest-room furniture: a beanbag per seat plus decorative couch + plant. */
export const REST_FURNITURE: FurniturePlacement[] = [
  ...BEANBAG_CENTERS.map(([x, y], i) => ({
    id: `beanbag-${i}`,
    type: "beanbag" as const,
    x,
    y,
    facingDeg: (facingToCenter(x, y) * 180) / Math.PI,
    tint: BEANBAG_TINTS[i % BEANBAG_TINTS.length],
  })),
  { id: "rest-couch", type: "couch", x: 1320, y: 1520, facingDeg: 0 },
  { id: "rest-pantry", type: "pantry", x: 1660, y: 1760, facingDeg: 30 },
  { id: "rest-plant-1", type: "whitePot", x: 1520, y: 180, facingDeg: 0 },
  { id: "rest-plant-2", type: "whitePot", x: 1230, y: 180, facingDeg: 0 },
];
