import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
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
import type { OfficeAgent, RenderAgent } from "../core/types";

// Walking speed (canvas units / second) and arrival threshold.
const WALK_UNITS_PER_SEC = 130;
const ARRIVE_DISTANCE = 8;

type ControllerMode = "toSeat" | "seated";
interface ControllerState {
  mode: ControllerMode;
  /** Which seat the agent is currently heading to / sitting at. */
  goalKey: "desk" | "rest" | null;
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
  };
}

/**
 * Holds the live agent simulation. Each agent walks to its desk (gateway up)
 * or to a rest-room beanbag (gateway off) and sits. Positions are mutated
 * in-place on the refs each frame so avatars animate without React re-renders.
 */
export const AgentsLayer = memo(function AgentsLayer({
  agents,
  workstations,
  selectedId,
  onSelect,
}: {
  agents: OfficeAgent[];
  workstations: Workstation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const agentsRef = useRef<RenderAgent[]>([]) as React.MutableRefObject<
    RenderAgent[]
  >;
  const lookupRef = useRef<Map<string, RenderAgent>>(new Map());
  const controllerRef = useRef<Map<string, ControllerState>>(new Map());

  const deskSeatByAgent = useMemo(() => {
    const map = new Map<string, Seat>();
    for (const w of workstations) {
      map.set(w.agentId, { x: w.seatX, y: w.seatY, facing: w.seatFacing });
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
    // Drop controller state for removed agents.
    const controller = controllerRef.current;
    for (const id of [...controller.keys()]) {
      if (!lookup.has(id)) controller.delete(id);
    }
  }, [agents]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05); // clamp big frame gaps
    const liveAgents = (agentsRef as React.MutableRefObject<RenderAgent[]>)
      .current;
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

      if (!goal) {
        agent.state = "standing";
        continue;
      }

      // Gateway flipped (profile started/stopped) — head to the new seat.
      if (ctrl.goalKey !== goalKey) {
        ctrl.goalKey = goalKey;
        ctrl.mode = "toSeat";
      }

      const moveToward = (tx: number, ty: number): boolean => {
        const dx = tx - agent.x;
        const dy = ty - agent.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= ARRIVE_DISTANCE) {
          agent.x = tx;
          agent.y = ty;
          return true;
        }
        const move = Math.min(dist, WALK_UNITS_PER_SEC * step);
        agent.x += (dx / dist) * move;
        agent.y += (dy / dist) * move;
        agent.facing = Math.atan2(dx, dy);
        agent.state = "walking";
        return false;
      };

      if (ctrl.mode === "seated") {
        agent.x = goal.x;
        agent.y = goal.y;
        agent.facing = goal.facing;
        agent.state = "sitting";
        continue;
      }

      // Heading to the seat, routing through the doorway when changing rooms.
      const wp = routeTarget(agent.x, agent.y, goal.x, goal.y);
      const reachedFinal = wp.x === goal.x && wp.y === goal.y;
      if (moveToward(wp.x, wp.y) && reachedFinal) {
        agent.facing = goal.facing;
        agent.state = "sitting";
        ctrl.mode = "seated";
      }
    }
  });

  return (
    <>
      {agents.map((agent) => (
        <AgentModel
          key={agent.id}
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
          speechText={selectedId === agent.id ? `Hi, I'm ${agent.name}` : null}
          riggedModelUrl={
            agent.position === "ceo" ? RIGGED_EMPLOYEE_URL : RIGGED_MAN_URL
          }
          riggedModelTint={agent.position === "ceo" ? null : agent.color}
        />
      ))}
    </>
  );
});
