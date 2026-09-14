/**
 * Waypoint routing inside the office building. There is no full pathfinder:
 * walkers steer straight at a target and rely on wall-follow to skim past
 * convex obstacles. That makes doorways the one thing that must be routed
 * explicitly — a straight line at a target beyond a wall pins the walker
 * against it, and in a concave pocket (a wall corner plus furniture) the
 * wall-follow re-derives opposite slides every frame and deadlocks in place.
 *
 * Every room crossing is therefore a two-hop "door gate": first walk to the
 * gate point on the NEAR side of the doorway, then to the far-side gate. The
 * near gate is reachable in a straight line from anywhere in its room, and
 * the near→far hop crosses the wall inside the door gap by construction —
 * so routing is position-independent. (The old single-hop version aimed
 * straight at the far gate; from a CEO seat or anywhere south of the door
 * band the line crossed the wall outside the gap and stranded the agent —
 * unnoticed while walks only ever started from desks and rest seats, exposed
 * by chat-commanded missions that can start anywhere.)
 */
import { CEO_OFFICE, CEO_DOOR_Y, DIVIDER_X, DOOR_Y } from "../layout";

/** How far a gate point sits from its wall, on each side of the doorway. */
const GATE_OFFSET = 60;
/**
 * "At the gate" tolerance: within this box around the near gate the walker
 * is inside the door band, so the straight hop to the far gate passes
 * through the gap. The y band stays inside the narrower of the two door
 * gaps (±90); x allows the walker to have been pushed around a little.
 */
const GATE_BAND_Y = 80;
const GATE_BAND_X = 140;

function throughGate(
  ax: number,
  ay: number,
  wallX: number,
  doorY: number,
  crossingEast: boolean,
): { x: number; y: number } {
  const atGate =
    Math.abs(ay - doorY) <= GATE_BAND_Y && Math.abs(ax - wallX) <= GATE_BAND_X;
  const side = atGate === crossingEast ? 1 : -1;
  return { x: wallX + side * GATE_OFFSET, y: doorY };
}

function inCeoBox(x: number, y: number): boolean {
  return x < CEO_OFFICE.maxX && y > CEO_OFFICE.minY;
}

/**
 * Next waypoint on the way to (finalX, finalY), recomputed every frame.
 * Returns the final target unchanged when no room boundary is in the way.
 */
export function routeTarget(
  ax: number,
  ay: number,
  finalX: number,
  finalY: number,
): { x: number; y: number } {
  // Leaving the CEO glass office always goes through its own doorway first —
  // checked before the divider, or a CEO→east walk aims at the divider door
  // and pins against the glass (the original stuck-in-the-corner bug).
  const inCeo = inCeoBox(ax, ay);
  const targetInCeo = inCeoBox(finalX, finalY);
  if (inCeo && !targetInCeo) {
    return throughGate(ax, ay, CEO_OFFICE.maxX, CEO_DOOR_Y, true);
  }

  const onEast = ax > DIVIDER_X;
  const targetEast = finalX > DIVIDER_X;
  if (onEast !== targetEast) {
    return throughGate(ax, ay, DIVIDER_X, DOOR_Y, targetEast);
  }

  if (!inCeo && targetInCeo) {
    return throughGate(ax, ay, CEO_OFFICE.maxX, CEO_DOOR_Y, false);
  }
  return { x: finalX, y: finalY };
}
