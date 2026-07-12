import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { AgentModel } from "./agents";
import { RIGGED_EMPLOYEE_URL, RIGGED_MAN_URL } from "./RiggedCharacter";
import {
  REST_SEATS,
  CEO_OFFICE,
  CEO_DOOR_Y,
  DIVIDER_X,
  DOOR_Y,
  type Workstation,
  type Seat,
} from "../layout";
import { WALK_SPEED } from "../core/constants";
import { toWorld, worldToCanvas } from "../core/geometry";
import {
  applyCrowdSeparation,
  buildOfficeColliders,
  collidersForPlace,
  removeCrowdBody,
  resolveStaticColliders,
  setCrowdBody,
} from "../core/collision";
import {
  TRIP_MAX_TRAVELLERS,
  TRIP_CHANCE_PER_SEC,
  TRIP_WANDER_MS,
  TRIP_DWELL_MS,
  TRIP_WALK_SPEED,
  pickTripRoute,
  classifyTripPlace,
  type TripRoute,
} from "../trips";
import type { AgentPlace, OfficeAgent, RenderAgent } from "../core/types";

// Walking speed (canvas units / second) and arrival threshold.
const WALK_UNITS_PER_SEC = 130;
const ARRIVE_DISTANCE = 8;
// Trip waypoints are scenery, not seats — a looser arrival radius so a
// waypoint blocked by another person (crowd separation) can't strand anyone.
const TRIP_ARRIVE_DISTANCE = 25;

type ControllerMode = "toSeat" | "seated" | "trip";

interface TripState {
  route: TripRoute;
  phase: "out" | "wander" | "back";
  /** Index into route.points ("out" walks up, "back" walks down). */
  idx: number;
  wanderIdx: number;
  /** Standing pause at the current wander stop until this timestamp. */
  dwellUntil: number;
  /** When to head home (set when the wander phase starts). */
  endAt: number;
}

interface ControllerState {
  mode: ControllerMode;
  /** Which seat the agent is currently heading to / sitting at. */
  goalKey: "desk" | "rest" | null;
  trip?: TripState;
  /**
   * Committed obstacle slide: while active, the agent walks in this fixed
   * direction instead of steering at its goal. A per-frame perpendicular
   * nudge is not enough — the goal pull re-pins the agent against the
   * obstacle face every frame, oscillating in place forever.
   */
  slide?: { dx: number; dy: number; until: number };
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Doorway waypoints just inside each room, so agents pass through the gap in
// the partition instead of clipping the wall (we have no full pathfinder).
function routeTarget(
  ax: number,
  ay: number,
  finalX: number,
  finalY: number,
): { x: number; y: number } {
  const onEast = ax > DIVIDER_X;
  const targetEast = finalX > DIVIDER_X;
  if (onEast !== targetEast) {
    return { x: targetEast ? DIVIDER_X + 60 : DIVIDER_X - 60, y: DOOR_Y };
  }
  // CEO glass corner office: route through the doorway gap in its east glass
  // wall when crossing the boundary in either direction.
  const inCeoOffice = ax < CEO_OFFICE.maxX && ay > CEO_OFFICE.minY;
  const targetInCeoOffice =
    finalX < CEO_OFFICE.maxX && finalY > CEO_OFFICE.minY;
  if (inCeoOffice !== targetInCeoOffice) {
    return {
      x: targetInCeoOffice ? CEO_OFFICE.maxX - 60 : CEO_OFFICE.maxX + 60,
      y: CEO_DOOR_Y,
    };
  }
  return { x: finalX, y: finalY };
}

function makeRenderAgent(agent: OfficeAgent): RenderAgent {
  // Spawn near the entrance (south edge); the controller routes the agent to
  // its assigned desk from there.
  const x = randomBetween(820, 1000);
  const y = 1650;
  return {
    ...agent,
    x,
    y,
    targetX: x,
    targetY: y,
    path: [],
    facing: Math.PI,
    frame: Math.floor(randomBetween(0, 240)),
    walkSpeed: WALK_SPEED,
    phaseOffset: randomBetween(0, Math.PI * 2),
    state: "standing",
    place: "office",
  };
}

/**
 * Holds the live agent simulation. Each agent walks to its desk (gateway up)
 * or to a rest-room beanbag (gateway off) and sits; idle agents occasionally
 * take a walking trip to the bank or car showroom and back (see trips.ts).
 * Positions are mutated in-place on the refs each frame so avatars animate
 * without React re-renders. The simulation always runs for every agent;
 * `visiblePlace` only filters which avatars are shown, so interior views
 * display exactly the agents that are actually in that building.
 */
export const AgentsLayer = memo(function AgentsLayer({
  agents,
  workstations,
  selectedId,
  onSelect,
  visiblePlace = null,
}: {
  agents: OfficeAgent[];
  workstations: Workstation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** null = show everyone (city view); otherwise only agents in that place. */
  visiblePlace?: AgentPlace | null;
}): React.JSX.Element {
  const agentsRef = useRef<RenderAgent[]>([]) as React.MutableRefObject<
    RenderAgent[]
  >;
  const lookupRef = useRef<Map<string, RenderAgent>>(new Map());
  const controllerRef = useRef<Map<string, ControllerState>>(new Map());
  // Per-agent wrapper groups: visibility is toggled imperatively each frame
  // because `place` lives in mutated sim state, not React state.
  const wrapperRefs = useRef<Map<string, THREE.Group>>(new Map());
  const visiblePlaceRef = useRef<AgentPlace | null>(visiblePlace);
  visiblePlaceRef.current = visiblePlace;

  const deskSeatByAgent = useMemo(() => {
    const map = new Map<string, Seat>();
    for (const w of workstations) {
      map.set(w.agentId, { x: w.seatX, y: w.seatY, facing: w.seatFacing });
    }
    return map;
  }, [workstations]);

  // Static colliders for the office (walls with door gaps + blocking
  // furniture + desk bodies). Bank/showroom colliders are module constants.
  const officeColliders = useMemo(
    () =>
      buildOfficeColliders(
        workstations,
        workstations.some((w) => w.isExecutive),
      ),
    [workstations],
  );

  // Seat-approach waypoint per (non-executive) desk: the aisle beside the
  // desk at seat height. Walking straight at the seat from the south runs
  // head-on into the desk collider; coming up the aisle and crossing to the
  // chair from the open side never touches it. deskX+145 is the centre of
  // the gap between this desk column and the next (columns repeat every 210
  // canvas units, desks are 100 wide), which is desk-free in every row.
  const deskApproachByAgent = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const w of workstations) {
      if (w.isExecutive) continue;
      map.set(w.agentId, { x: w.deskX + 145, y: w.seatY });
    }
    return map;
  }, [workstations]);

  // Assign each agent a rest-room beanbag (round-robin) for when its gateway
  // is off.
  const restSeatByAgent = useMemo(() => {
    const map = new Map<string, Seat>();
    if (REST_SEATS.length > 0) {
      agents.forEach((agent, index) => {
        map.set(agent.id, REST_SEATS[index % REST_SEATS.length]);
      });
    }
    return map;
  }, [agents]);

  // Reconcile the simulation list whenever the set of agents changes, keeping
  // existing agents' positions so they don't teleport on a profile refresh.
  // This mutates simulation refs, so it must run as an effect (not in useMemo,
  // which React may re-run arbitrarily and would reset live walk/controller
  // state). useLayoutEffect runs synchronously before paint so the next
  // useFrame always sees a consistent ref.
  useLayoutEffect(() => {
    const prev = lookupRef.current;
    // Guard: if every agent already exists with the same status and position,
    // nothing meaningful changed — keep the current simulation objects so
    // agents don't teleport or reset their pose on a parent re-render.
    let unchanged = agents.length === prev.size;
    if (unchanged) {
      for (const agent of agents) {
        const existing = prev.get(agent.id);
        const existingPos =
          existing && "position" in existing
            ? (existing as unknown as OfficeAgent).position
            : undefined;
        if (
          !existing ||
          existing.status !== agent.status ||
          existingPos !== agent.position
        ) {
          unchanged = false;
          break;
        }
      }
    }
    if (unchanged) return;

    const next: RenderAgent[] = agents.map((agent) => {
      const existing = prev.get(agent.id);
      if (existing) {
        return { ...existing, ...agent };
      }
      return makeRenderAgent(agent);
    });
    (agentsRef as React.MutableRefObject<RenderAgent[]>).current = next;
    const lookup = new Map<string, RenderAgent>();
    for (const a of next) lookup.set(a.id, a);
    lookupRef.current = lookup;
    // Drop controller + crowd state for removed agents.
    const controller = controllerRef.current;
    for (const id of [...controller.keys()]) {
      if (!lookup.has(id)) {
        controller.delete(id);
        removeCrowdBody(id);
      }
    }
  }, [agents]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05); // clamp big frame gaps
    const now = performance.now();
    const liveAgents = (agentsRef as React.MutableRefObject<RenderAgent[]>)
      .current;

    let travellers = 0;
    for (const c of controllerRef.current.values()) {
      if (c.mode === "trip") travellers += 1;
    }

    for (const agent of liveAgents) {
      // eslint-disable-next-line -- simulation state is intentionally mutated in-place each frame
      agent.frame += step * 60;

      // Working agents (gateway up) sit at their desk; everyone else rests in
      // the rest room.
      const working = agent.status === "working";
      const goalKey: "desk" | "rest" = working ? "desk" : "rest";
      const goal = working
        ? deskSeatByAgent.get(agent.id)
        : restSeatByAgent.get(agent.id);

      let ctrl = controllerRef.current.get(agent.id);
      if (!ctrl) {
        ctrl = { mode: "toSeat", goalKey: null };
        controllerRef.current.set(agent.id, ctrl);
      }

      const moveToward = (
        tx: number,
        ty: number,
        speed = WALK_UNITS_PER_SEC,
        arrive = ARRIVE_DISTANCE,
      ): boolean => {
        const dx = tx - agent.x;
        const dy = ty - agent.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= arrive) {
          agent.x = tx;
          agent.y = ty;
          return true;
        }
        const move = Math.min(dist, speed * step);
        agent.x += (dx / dist) * move;
        agent.y += (dy / dist) * move;
        agent.facing = Math.atan2(dx, dy);
        agent.state = "walking";
        return false;
      };

      // Crowd separation + wall/furniture push-out, in world space (the
      // sim's canvas coordinates convert linearly). `pushOut` receives the
      // static resolver's displacement — the blocking obstacle's normal.
      const resolvePhysics = (
        separate: boolean,
        pushOut?: { x: number; z: number },
      ): void => {
        const place = agent.place ?? "office";
        const colliders = collidersForPlace(place, officeColliders);
        const [wx, , wz] = toWorld(agent.x, agent.y);
        const p = { x: wx, z: wz };
        if (separate) applyCrowdSeparation(agent.id, place, p);
        resolveStaticColliders(colliders, p, undefined, pushOut);
        const [cx, cy] = worldToCanvas(p.x, p.z);
        agent.x = cx;
        agent.y = cy;
        setCrowdBody(agent.id, place, p.x, p.z);
      };

      // Start a committed slide along the blocking obstacle's face, on the
      // side that makes progress toward (tx, ty). Canvas and world axes are
      // parallel, so the world-space push normal is usable directly as a
      // canvas direction. Falls back to a per-agent fixed side when the
      // block came from the crowd rather than a static obstacle (no normal).
      const startSlide = (
        tx: number,
        ty: number,
        push: { x: number; z: number },
      ): void => {
        const gdx = tx - agent.x;
        const gdy = ty - agent.y;
        const gl = Math.hypot(gdx, gdy) || 1;
        const fallbackSide = agent.id.charCodeAt(0) % 2 === 0 ? 1 : -1;
        let dx: number;
        let dy: number;
        const pl = Math.hypot(push.x, push.z);
        if (pl > 1e-6) {
          // Tangent of the obstacle face, signed toward the goal.
          const tanX = -push.z / pl;
          const tanY = push.x / pl;
          const dot = (tanX * gdx + tanY * gdy) / gl;
          const sign = Math.abs(dot) < 0.08 ? fallbackSide : Math.sign(dot);
          dx = tanX * sign;
          dy = tanY * sign;
        } else {
          dx = (-gdy / gl) * fallbackSide;
          dy = (gdx / gl) * fallbackSide;
        }
        ctrl.slide = { dx, dy, until: now + 450 };
      };

      // One walking step with collision. While a committed slide is active,
      // the agent walks in the slide's fixed direction (goal steering is
      // suspended — it's the goal pull that pins walkers against obstacle
      // faces). Cornered mid-slide, it re-derives the slide from the new
      // face, i.e. wall-follows around corners toward the target.
      const walkStep = (
        tx: number,
        ty: number,
        speed = WALK_UNITS_PER_SEC,
        arrive = ARRIVE_DISTANCE,
      ): boolean => {
        const prevX = agent.x;
        const prevY = agent.y;
        const push = { x: 0, z: 0 };
        if (ctrl.slide && now <= ctrl.slide.until) {
          agent.x += ctrl.slide.dx * speed * 0.85 * step;
          agent.y += ctrl.slide.dy * speed * 0.85 * step;
          agent.facing = Math.atan2(ctrl.slide.dx, ctrl.slide.dy);
          agent.state = "walking";
          resolvePhysics(true, push);
          if (
            Math.hypot(agent.x - prevX, agent.y - prevY) <
            0.25 * speed * step
          ) {
            startSlide(tx, ty, push);
          }
          return false;
        }
        const arrived = moveToward(tx, ty, speed, arrive);
        resolvePhysics(true, push);
        if (!arrived) {
          const progress = Math.hypot(agent.x - prevX, agent.y - prevY);
          if (progress < 0.25 * speed * step) startSlide(tx, ty, push);
        }
        return arrived;
      };

      // Stationary agents still occupy space so walkers flow around them.
      const registerBody = (): void => {
        const [wx, , wz] = toWorld(agent.x, agent.y);
        setCrowdBody(agent.id, agent.place ?? "office", wx, wz);
      };

      // ── Trip to another building ────────────────────────────────────────
      if (ctrl.mode === "trip" && ctrl.trip) {
        const trip = ctrl.trip;
        const { route } = trip;
        // Gateway came up mid-trip: turn around and walk the route home
        // (never teleport or clip through walls).
        if (working && trip.phase !== "back") {
          trip.idx =
            trip.phase === "wander" ? route.points.length - 1 : trip.idx - 1;
          trip.phase = "back";
        }

        if (trip.phase === "out") {
          agent.place = classifyTripPlace(route, trip.idx);
          const [tx, ty] = route.points[trip.idx];
          if (walkStep(tx, ty, TRIP_WALK_SPEED, TRIP_ARRIVE_DISTANCE)) {
            trip.idx += 1;
            if (trip.idx >= route.points.length) {
              trip.phase = "wander";
              trip.wanderIdx = 0;
              trip.dwellUntil = 0;
              trip.endAt = now + randomBetween(...TRIP_WANDER_MS);
            }
          }
          continue;
        }

        if (trip.phase === "wander") {
          agent.place = route.dest;
          if (now >= trip.endAt) {
            trip.phase = "back";
            trip.idx = route.points.length - 1;
            continue;
          }
          if (now < trip.dwellUntil) {
            agent.state = "standing";
            resolvePhysics(false);
            continue;
          }
          const [tx, ty] = route.wander[trip.wanderIdx % route.wander.length];
          if (walkStep(tx, ty, WALK_UNITS_PER_SEC, TRIP_ARRIVE_DISTANCE)) {
            trip.wanderIdx += 1;
            trip.dwellUntil = now + randomBetween(...TRIP_DWELL_MS);
          }
          continue;
        }

        // phase === "back": walk the outbound points in reverse.
        if (trip.idx < 0) {
          ctrl.mode = "toSeat";
          ctrl.trip = undefined;
          agent.place = "office";
          continue;
        }
        agent.place = classifyTripPlace(route, trip.idx);
        const [tx, ty] = route.points[trip.idx];
        if (walkStep(tx, ty, TRIP_WALK_SPEED, TRIP_ARRIVE_DISTANCE)) {
          trip.idx -= 1;
        }
        continue;
      }

      agent.place = "office";

      if (!goal) {
        agent.state = "standing";
        registerBody();
        continue;
      }

      // Gateway flipped (profile started/stopped) — head to the new seat.
      if (ctrl.goalKey !== goalKey) {
        ctrl.goalKey = goalKey;
        ctrl.mode = "toSeat";
      }

      if (ctrl.mode === "seated") {
        // Idle agents sitting in the rest room occasionally head out on a
        // walking trip to the bank or the car showroom.
        if (
          !working &&
          travellers < TRIP_MAX_TRAVELLERS &&
          Math.random() < TRIP_CHANCE_PER_SEC * step
        ) {
          ctrl.mode = "trip";
          ctrl.trip = {
            route: pickTripRoute(Math.random()),
            phase: "out",
            idx: 0,
            wanderIdx: 0,
            dwellUntil: 0,
            endAt: 0,
          };
          travellers += 1;
          continue;
        }
        agent.x = goal.x;
        agent.y = goal.y;
        agent.facing = goal.facing;
        agent.state = "sitting";
        registerBody();
        continue;
      }

      // Heading to the seat, routing through the doorway when changing rooms.
      const wp = routeTarget(agent.x, agent.y, goal.x, goal.y);
      let reachedFinal = wp.x === goal.x && wp.y === goal.y;
      let target = wp;
      if (reachedFinal && goalKey === "desk") {
        // Desk seats are approached from the open side: up the aisle beside
        // the desk first, then across to the chair (see deskApproachByAgent).
        const approach = deskApproachByAgent.get(agent.id);
        if (approach && agent.y > goal.y + 25) {
          target = approach;
          reachedFinal = false;
        }
      }
      if (walkStep(target.x, target.y) && reachedFinal) {
        agent.facing = goal.facing;
        agent.state = "sitting";
        ctrl.mode = "seated";
        // Re-pin on the exact seat — walkStep's push-out may have shifted
        // the arrival snap by a hair.
        agent.x = goal.x;
        agent.y = goal.y;
        registerBody();
      }
    }

    // Interior views only show the agents that are actually in that building.
    const vp = visiblePlaceRef.current;
    for (const agent of liveAgents) {
      const wrapper = wrapperRefs.current.get(agent.id);
      if (wrapper) {
        wrapper.visible = vp === null || (agent.place ?? "office") === vp;
      }
    }
  });

  return (
    <>
      {agents.map((agent) => (
        <group
          key={agent.id}
          ref={(g): void => {
            if (g) wrapperRefs.current.set(agent.id, g);
            else wrapperRefs.current.delete(agent.id);
          }}
        >
          <AgentModel
            agentId={agent.id}
            name={agent.name}
            // Nameplate shows the name only; the model/provider stays in the
            // selection panel rather than cluttering the 3D head label.
            subtitle={null}
            status={agent.status}
            color={agent.color}
            appearance={agent.avatarProfile}
            agentsRef={agentsRef}
            agentLookupRef={lookupRef}
            onClick={onSelect}
            showSpeech={selectedId === agent.id}
            speechText={
              selectedId === agent.id ? `Hi, I'm ${agent.name}` : null
            }
            riggedModelUrl={
              agent.position === "ceo" ? RIGGED_EMPLOYEE_URL : RIGGED_MAN_URL
            }
            riggedModelTint={agent.position === "ceo" ? null : agent.color}
          />
        </group>
      ))}
    </>
  );
});
