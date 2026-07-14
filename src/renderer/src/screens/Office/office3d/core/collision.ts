/**
 * Lightweight collision for the world's people: a crowd registry so movers
 * softly push apart instead of overlapping, and per-place static colliders
 * (wall boxes with door gaps, furniture circles) with push-out resolution so
 * nobody walks through walls or objects — the only way in or out of a
 * building is its doorway. Everything works in world coordinates; the office
 * simulation converts its canvas positions at the boundary.
 */
import { toWorld } from "./geometry";
import { WORLD_W, WORLD_H } from "./constants";
import {
  BANK_X,
  BANK_Z,
  BANK_W,
  BANK_D,
  SHOWROOM_W,
  SHOWROOM_D,
  SHOWROOM_X,
  SHOWROOM_Z,
  OFFICE_DOOR_X,
  OFFICE_DOOR_W,
} from "./cityPlan";
import {
  INTERIOR_WALLS,
  GLASS_WALLS,
  REST_FURNITURE,
  EXECUTIVE_DECOR,
  type Workstation,
} from "../layout";
import type { AgentPlace } from "./types";

export type StaticCollider =
  | { kind: "box"; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: "circle"; x: number; z: number; r: number };

/** Personal-space radius of every person (world units). */
export const PERSON_RADIUS = 0.34;

// ── Crowd registry (person ↔ person separation) ───────────────────────────

interface CrowdBody {
  place: AgentPlace;
  x: number;
  z: number;
  r: number;
}

const bodies = new Map<string, CrowdBody>();

export function setCrowdBody(
  id: string,
  place: AgentPlace,
  x: number,
  z: number,
  r = PERSON_RADIUS,
): void {
  const b = bodies.get(id);
  if (b) {
    b.place = place;
    b.x = x;
    b.z = z;
    b.r = r;
  } else {
    bodies.set(id, { place, x, z, r });
  }
}

export function removeCrowdBody(id: string): void {
  bodies.delete(id);
}

/**
 * Push `p` away from every other registered person in the same place. Soft
 * (fractional push per frame) so two people meeting in a doorway slide past
 * each other instead of deadlocking.
 */
export function applyCrowdSeparation(
  id: string,
  place: AgentPlace,
  p: { x: number; z: number },
  r = PERSON_RADIUS,
): void {
  for (const [otherId, b] of bodies) {
    if (otherId === id || b.place !== place) continue;
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d2 = dx * dx + dz * dz;
    const rsum = r + b.r;
    if (d2 >= rsum * rsum) continue;
    if (d2 < 1e-8) {
      // Perfectly stacked (e.g. shared waypoint) — nudge deterministically.
      p.x += rsum * 0.5;
      continue;
    }
    const d = Math.sqrt(d2);
    const push = (rsum - d) * 0.6;
    p.x += (dx / d) * push;
    p.z += (dz / d) * push;
  }
}

// ── Static collider resolution ─────────────────────────────────────────────

/**
 * Push `p` (a circle of radius `r`) out of every collider it penetrates.
 * When `pushOut` is given, it receives the total displacement applied — the
 * obstacle's push normal, which walkers use to slide along the blocking
 * face instead of shoving at it.
 */
export function resolveStaticColliders(
  colliders: StaticCollider[],
  p: { x: number; z: number },
  r = PERSON_RADIUS,
  pushOut?: { x: number; z: number },
): void {
  const startX = p.x;
  const startZ = p.z;
  // Two passes: escaping one collider can land inside a neighbour (e.g. a
  // wall corner); a second pass settles it.
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const c of colliders) {
      if (c.kind === "circle") {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const rsum = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rsum * rsum) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) {
          p.x = c.x + rsum;
        } else {
          p.x = c.x + (dx / d) * rsum;
          p.z = c.z + (dz / d) * rsum;
        }
        moved = true;
      } else {
        const cx = Math.min(Math.max(p.x, c.minX), c.maxX);
        const cz = Math.min(Math.max(p.z, c.minZ), c.maxZ);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-8) {
          // Centre inside the box — exit through the nearest face.
          const toMinX = p.x - c.minX;
          const toMaxX = c.maxX - p.x;
          const toMinZ = p.z - c.minZ;
          const toMaxZ = c.maxZ - p.z;
          const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          if (m === toMinX) p.x = c.minX - r;
          else if (m === toMaxX) p.x = c.maxX + r;
          else if (m === toMinZ) p.z = c.minZ - r;
          else p.z = c.maxZ + r;
        } else {
          const d = Math.sqrt(d2);
          const push = r - d;
          p.x += (dx / d) * push;
          p.z += (dz / d) * push;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (pushOut) {
    pushOut.x = p.x - startX;
    pushOut.z = p.z - startZ;
  }
}

// ── Collider construction helpers ──────────────────────────────────────────

function box(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): StaticCollider {
  return { kind: "box", minX, maxX, minZ, maxZ };
}

function circle(x: number, z: number, r: number): StaticCollider {
  return { kind: "circle", x, z, r };
}

/** Canvas-space rect (top-left + size, layout convention) → world box. */
function canvasBox(x: number, y: number, w: number, h: number): StaticCollider {
  const [minX, , minZ] = toWorld(x, y);
  const [maxX, , maxZ] = toWorld(x + w, y + h);
  return box(minX, maxX, minZ, maxZ);
}

/** Canvas-space centre point → world circle (radius in world units). */
function canvasCircle(cx: number, cy: number, r: number): StaticCollider {
  const [x, , z] = toWorld(cx, cy);
  return circle(x, z, r);
}

// ── Office ─────────────────────────────────────────────────────────────────

const OFFICE_HALF_W = WORLD_W / 2;
const OFFICE_HALF_H = WORLD_H / 2;
const WALL_PAD = 0.15;

const OFFICE_WALLS: StaticCollider[] = [
  // North / east / west perimeter.
  box(
    -OFFICE_HALF_W,
    OFFICE_HALF_W,
    -OFFICE_HALF_H - WALL_PAD,
    -OFFICE_HALF_H + WALL_PAD,
  ),
  box(
    OFFICE_HALF_W - WALL_PAD,
    OFFICE_HALF_W + WALL_PAD,
    -OFFICE_HALF_H,
    OFFICE_HALF_H,
  ),
  box(
    -OFFICE_HALF_W - WALL_PAD,
    -OFFICE_HALF_W + WALL_PAD,
    -OFFICE_HALF_H,
    OFFICE_HALF_H,
  ),
  // South perimeter, split around the entrance doorway.
  box(
    -OFFICE_HALF_W,
    OFFICE_DOOR_X - OFFICE_DOOR_W / 2,
    OFFICE_HALF_H - WALL_PAD,
    OFFICE_HALF_H + WALL_PAD,
  ),
  box(
    OFFICE_DOOR_X + OFFICE_DOOR_W / 2,
    OFFICE_HALF_W,
    OFFICE_HALF_H - WALL_PAD,
    OFFICE_HALF_H + WALL_PAD,
  ),
  // Interior partition + CEO glass walls (door gaps are between segments).
  ...INTERIOR_WALLS.map((w) => canvasBox(w.x, w.y, w.w, w.h)),
  ...GLASS_WALLS.map((w) => canvasBox(w.x, w.y, w.w, w.h)),
];

// Blocking furniture. Seats (chairs, beanbags) are deliberately absent —
// agents must reach them to sit.
const OFFICE_FURNITURE: StaticCollider[] = [
  ...REST_FURNITURE.flatMap((f): StaticCollider[] => {
    if (f.type === "couch") return [canvasBox(f.x, f.y, 100, 40)];
    if (f.type === "pantry") return [canvasCircle(f.x + 60, f.y + 40, 1.35)];
    if (f.type === "whitePot") return [canvasCircle(f.x + 15, f.y + 15, 0.4)];
    return [];
  }),
];

const CEO_FURNITURE: StaticCollider[] = [
  ...EXECUTIVE_DECOR.flatMap((f): StaticCollider[] => {
    if (f.type === "couch") return [canvasBox(f.x, f.y, 100, 40)];
    if (f.type === "sofaChair") return [canvasCircle(f.x, f.y, 0.55)];
    if (f.type === "plant") return [canvasCircle(f.x + 12, f.y + 12, 0.4)];
    if (f.type === "whitePot") return [canvasCircle(f.x + 15, f.y + 15, 0.4)];
    return [];
  }),
  // Coffee table between the CEO desk and the couch (see CeoOfficeExtras).
  canvasCircle(300, 1475, 0.85),
];

/**
 * Full office collider set. Desk boxes cover only the desk body away from
 * the seat side so an agent's own chair (just north of the desk) stays
 * reachable. The CEO's executive desk is skipped for the same reason — its
 * seat and visitor lounge hug it on every side.
 */
export function buildOfficeColliders(
  workstations: Workstation[],
  hasCeo: boolean,
): StaticCollider[] {
  const list = [...OFFICE_WALLS, ...OFFICE_FURNITURE];
  if (hasCeo) list.push(...CEO_FURNITURE);
  for (const w of workstations) {
    if (w.isExecutive) continue;
    list.push(canvasBox(w.deskX, w.deskY - 14, 100, 15));
  }
  return list;
}

// ── Bank ───────────────────────────────────────────────────────────────────

const BHW = BANK_W / 2;
const BHD = BANK_D / 2;

export const BANK_COLLIDERS: StaticCollider[] = [
  // Walls; the south wall keeps its 2-unit doorway gap at the centre.
  box(
    BANK_X - BHW,
    BANK_X + BHW,
    BANK_Z - BHD - WALL_PAD,
    BANK_Z - BHD + WALL_PAD,
  ),
  box(
    BANK_X - BHW,
    BANK_X - 1,
    BANK_Z + BHD - WALL_PAD,
    BANK_Z + BHD + WALL_PAD,
  ),
  box(
    BANK_X + 1,
    BANK_X + BHW,
    BANK_Z + BHD - WALL_PAD,
    BANK_Z + BHD + WALL_PAD,
  ),
  box(
    BANK_X - BHW - WALL_PAD,
    BANK_X - BHW + WALL_PAD,
    BANK_Z - BHD,
    BANK_Z + BHD,
  ),
  box(
    BANK_X + BHW - WALL_PAD,
    BANK_X + BHW + WALL_PAD,
    BANK_Z - BHD,
    BANK_Z + BHD,
  ),
  // Teller counter row.
  box(BANK_X - 5.1, BANK_X + 5.1, BANK_Z - 7.1, BANK_Z - 5.9),
  // ATMs (two by the south entrance, two on the north-east wall).
  circle(BANK_X - BHW + 1.2, BANK_Z + BHD - 2, 0.5),
  circle(BANK_X - BHW + 3.0, BANK_Z + BHD - 2, 0.5),
  circle(BANK_X + BHW - 1.2, BANK_Z - BHD + 4, 0.5),
  circle(BANK_X + BHW - 3.0, BANK_Z - BHD + 4, 0.5),
  // Waiting area sofa + chairs, corner plants.
  circle(BANK_X - BHW + 3.5, BANK_Z + 2.5, 1.05),
  circle(BANK_X - BHW + 1.2, BANK_Z + 1.2, 0.6),
  circle(BANK_X - BHW + 1.2, BANK_Z + 3.8, 0.6),
  circle(BANK_X - BHW + 0.8, BANK_Z - BHD + 0.8, 0.45),
  circle(BANK_X + BHW - 0.8, BANK_Z - BHD + 0.8, 0.45),
  circle(BANK_X - BHW + 0.8, BANK_Z + BHD - 0.8, 0.45),
  circle(BANK_X + BHW - 0.8, BANK_Z + BHD - 0.8, 0.45),
  // Standing tellers behind the counter (see BankTellers).
  circle(BANK_X - 10 / 3, BANK_Z - BHD + 1.1, 0.4),
  circle(BANK_X, BANK_Z - BHD + 1.1, 0.4),
  circle(BANK_X + 10 / 3, BANK_Z - BHD + 1.1, 0.4),
];

// ── Showroom ───────────────────────────────────────────────────────────────

const SHW = SHOWROOM_W / 2;
const SHD = SHOWROOM_D / 2;
const SX = SHOWROOM_X;
const SZ = SHOWROOM_Z;

export const SHOWROOM_COLLIDERS: StaticCollider[] = [
  // Back (west), north, south walls; glass front (east) with the open
  // entrance bay between z −2 and +2.
  box(SX - SHW - WALL_PAD, SX - SHW + WALL_PAD, SZ - SHD, SZ + SHD),
  box(SX - SHW, SX + SHW, SZ - SHD - WALL_PAD, SZ - SHD + WALL_PAD),
  box(SX - SHW, SX + SHW, SZ + SHD - WALL_PAD, SZ + SHD + WALL_PAD),
  box(SX + SHW - WALL_PAD, SX + SHW + WALL_PAD, SZ - SHD, SZ - 2),
  box(SX + SHW - WALL_PAD, SX + SHW + WALL_PAD, SZ + 2, SZ + SHD),
  // Hero pedestal + display cars.
  circle(SX + 1.5, SZ, 2.4),
  circle(SX - 4, SZ - 7, 1.5),
  circle(SX - 4, SZ - 2.5, 1.5),
  circle(SX - 4, SZ + 2.5, 1.5),
  circle(SX - 4, SZ + 7, 1.5),
  circle(SX + 2.5, SZ - 6.5, 1.5),
  circle(SX + 2.5, SZ + 6.5, 1.5),
  // Standing staff (salesperson at the entrance, manager at the back).
  circle(SX + 5.8, SZ + 3.2, 0.4),
  circle(SX - 6.3, SZ, 0.4),
];

/**
 * Colliders for people walking the streets: every building's walls (door
 * gaps included), so nobody outside can clip through a facade — entering a
 * building means walking through its doorway.
 */
export const OUTSIDE_COLLIDERS: StaticCollider[] = [
  ...OFFICE_WALLS,
  ...BANK_COLLIDERS,
  ...SHOWROOM_COLLIDERS,
];

/** Static colliders for the place a person is currently in. */
export function collidersForPlace(
  place: AgentPlace,
  officeColliders: StaticCollider[],
): StaticCollider[] {
  if (place === "bank") return BANK_COLLIDERS;
  if (place === "showroom") return SHOWROOM_COLLIDERS;
  if (place === "office") return officeColliders;
  return OUTSIDE_COLLIDERS;
}
