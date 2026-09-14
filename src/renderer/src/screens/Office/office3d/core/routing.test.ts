// @vitest-environment node
import { describe, expect, it } from "vitest";
import { routeTarget } from "./routing";
import { GLASS_WALLS, INTERIOR_WALLS, REST_SEATS } from "../layout";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Liang–Barsky segment vs axis-aligned rect intersection.
function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: Rect,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clips: Array<[number, number]> = [
    [-dx, x1 - r.x],
    [dx, r.x + r.w - x1],
    [-dy, y1 - r.y],
    [dy, r.y + r.h - y1],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

const WALLS: Rect[] = [...INTERIOR_WALLS, ...GLASS_WALLS];

/**
 * Follow routeTarget hop by hop (as the frame loop does: recompute after
 * every arrival) and assert no straight hop crosses an interior wall — a
 * crossing means the walker would pin against the wall face and, in a
 * concave pocket, deadlock (the CEO-office stuck-agent bug).
 */
function walkAsserted(start: [number, number], target: [number, number]): void {
  let [x, y] = start;
  for (let hop = 0; hop < 12; hop++) {
    const wp = routeTarget(x, y, target[0], target[1]);
    for (const wall of WALLS) {
      expect(
        segmentHitsRect(x, y, wp.x, wp.y, wall),
        `hop (${x},${y})→(${wp.x},${wp.y}) crosses wall at (${wall.x},${wall.y})`,
      ).toBe(false);
    }
    [x, y] = [wp.x, wp.y];
    if (wp.x === target[0] && wp.y === target[1]) return;
  }
  throw new Error("route did not converge in 12 hops");
}

const CEO_SEAT: [number, number] = [300, 1360];
const OFFICE_DOOR: [number, number] = [1233, 1756];

describe("office door-gate routing", () => {
  it("leaving the CEO office routes through the glass door, never the wall", () => {
    // The original bug: divider crossing was checked first, so a CEO→east
    // walk aimed at the partition door and pinned against the north glass.
    walkAsserted(CEO_SEAT, [REST_SEATS[0].x, REST_SEATS[0].y]);
  });

  it("southern starts reach the exterior door without clipping the partition", () => {
    // From south of the door band, a straight line at the far-side gate
    // crosses partition-bottom below the gap — the near gate hop prevents it.
    walkAsserted([900, 1650], OFFICE_DOOR);
    walkAsserted(CEO_SEAT, OFFICE_DOOR);
  });

  it("desk-to-rest and rest-to-CEO walks stay wall-clean", () => {
    walkAsserted([355, 540], [1560, 820]);
    walkAsserted([REST_SEATS[0].x, REST_SEATS[0].y], CEO_SEAT);
  });

  it("same-room walks go straight at the target", () => {
    expect(routeTarget(200, 300, 800, 600)).toEqual({ x: 800, y: 600 });
    expect(routeTarget(1300, 400, 1560, 820)).toEqual({ x: 1560, y: 820 });
  });
});
