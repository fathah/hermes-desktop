/**
 * Walk-mode proximity interactions: the world points where the player's
 * avatar can press E — ATMs, bank tellers, showroom cars and agent desks.
 * Each point fires the same action its click-Interactable fires in orbit
 * mode; the walk controller finds the nearest point in the player's current
 * place each frame and surfaces it as a "Press E" prompt.
 */
import {
  BANK_X,
  BANK_Z,
  BANK_W,
  BANK_D,
  SHOWROOM_X,
  SHOWROOM_Z,
} from "../core/cityPlan";
import { toWorld } from "../core/geometry";
import type { AgentPlace } from "../core/types";
import type { Workstation } from "../layout";
import { DISPLAY_CARS, HERO_CAR, HERO_CAR_POS } from "../objects/CarShowroom";

export type PlayerInteraction =
  | {
      kind: "atm";
      id: string;
      place: AgentPlace;
      x: number;
      z: number;
      r: number;
      label: string;
    }
  | {
      kind: "teller";
      id: string;
      place: AgentPlace;
      x: number;
      z: number;
      r: number;
      label: string;
    }
  | {
      kind: "car";
      id: string;
      place: AgentPlace;
      x: number;
      z: number;
      r: number;
      label: string;
      carName: string;
      carTint: string;
    }
  | {
      kind: "desk";
      id: string;
      place: AgentPlace;
      x: number;
      z: number;
      r: number;
      label: string;
      agentId: string;
    };

const BHW = BANK_W / 2;
const BHD = BANK_D / 2;

// ATM positions mirror the collider circles in collision.ts (two by the south
// entrance, two on the north-east wall). The radius exceeds the ATM collider
// (0.5) + player radius so the point is reachable while standing beside it.
const ATM_SPOTS: Array<[number, number]> = [
  [BANK_X - BHW + 1.2, BANK_Z + BHD - 2],
  [BANK_X - BHW + 3.0, BANK_Z + BHD - 2],
  [BANK_X + BHW - 1.2, BANK_Z - BHD + 4],
  [BANK_X + BHW - 3.0, BANK_Z - BHD + 4],
];

// One point per teller, placed on the customer side of the counter (the
// counter's south face is at BANK_Z - 5.9; the tellers stand behind it).
const TELLER_XS = [BANK_X - 10 / 3, BANK_X, BANK_X + 10 / 3];
const TELLER_Z = BANK_Z - 5.5;

/**
 * Build the full interaction-point list for the current agent roster.
 * Labels must be pre-translated (i18n can't cross the Canvas boundary).
 */
export function buildPlayerInteractions({
  workstations,
  agentNameById,
  tellerLabel,
}: {
  workstations: Workstation[];
  agentNameById: Map<string, string>;
  tellerLabel: string;
}): PlayerInteraction[] {
  const points: PlayerInteraction[] = [];

  ATM_SPOTS.forEach(([x, z], i) => {
    points.push({
      kind: "atm",
      id: `atm-${i}`,
      place: "bank",
      x,
      z,
      r: 1.5,
      label: "ATM",
    });
  });
  TELLER_XS.forEach((x, i) => {
    points.push({
      kind: "teller",
      id: `teller-${i}`,
      place: "bank",
      x,
      z: TELLER_Z,
      r: 1.4,
      label: tellerLabel,
    });
  });

  // Hero car sits on a wide pedestal (collider r 2.4), so its trigger radius
  // must reach past the pedestal edge.
  points.push({
    kind: "car",
    id: "car-hero",
    place: "showroom",
    x: SHOWROOM_X + HERO_CAR_POS[0],
    z: SHOWROOM_Z + HERO_CAR_POS[1],
    r: 3.2,
    label: HERO_CAR.name,
    carName: HERO_CAR.name,
    carTint: HERO_CAR.tint,
  });
  DISPLAY_CARS.forEach((c, i) => {
    points.push({
      kind: "car",
      id: `car-${i}`,
      place: "showroom",
      x: SHOWROOM_X + c.pos[0],
      z: SHOWROOM_Z + c.pos[2],
      r: 2.6,
      label: c.name,
      carName: c.name,
      carTint: c.tint,
    });
  });

  // One point per desk, centred on the desk body (the same footprint as its
  // collider box: canvas x..x+100, y-14..y+1). Desk columns repeat every 210
  // canvas units (3.78 world), so the radius must cover a player standing
  // anywhere along the desk front — nearest-point wins where circles overlap.
  for (const w of workstations) {
    const [x, , z] = toWorld(w.deskX + 50, w.deskY - 6);
    points.push({
      kind: "desk",
      id: `desk-${w.agentId}`,
      place: "office",
      x,
      z,
      r: 2.3,
      label: agentNameById.get(w.agentId) ?? w.agentId,
      agentId: w.agentId,
    });
  }

  return points;
}

/** Nearest interaction point in `place` within its trigger radius, or null. */
export function nearestInteraction(
  points: PlayerInteraction[],
  place: AgentPlace,
  x: number,
  z: number,
): PlayerInteraction | null {
  let best: PlayerInteraction | null = null;
  let bestD2 = Infinity;
  for (const p of points) {
    if (p.place !== place) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < p.r * p.r && d2 < bestD2) {
      best = p;
      bestD2 = d2;
    }
  }
  return best;
}
