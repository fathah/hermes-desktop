import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as SkeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { PERSON_WORLD_HEIGHT } from "../core/constants";
import { seededRandom } from "../core/rng";
import { tintCharacterClone } from "../core/glb";
import {
  applyCrowdSeparation,
  collidersForPlace,
  removeCrowdBody,
  resolveStaticColliders,
  setCrowdBody,
} from "../core/collision";
import { pickCharacterModel, type CharacterModel } from "../core/characters";
import { BANK_X, BANK_Z, SHOWROOM_X, SHOWROOM_Z } from "../core/cityPlan";
import type { AgentPlace } from "../core/types";

/**
 * City pedestrians: ambient people who stroll the sidewalks and pop into the
 * bank and the car showroom — never the office, which belongs to the agents.
 * Each follows a seeded cyclic waypoint loop with dwell stops inside the
 * buildings, so at any moment some are out on the street and a few are
 * browsing an interior. They share the crowd/collision system with agents.
 */

interface PedWaypoint {
  x: number;
  z: number;
  /** Where walking TOWARD this point counts as being (interior filtering). */
  place: AgentPlace;
  /** Pause here for a few seconds on arrival. */
  dwell?: boolean;
}

// The sidewalk strip in front of the office (between its south wall and the
// south road) is the pedestrians' main drag — same corridor agent trips use.
const SIDEWALK_Z = 17.2;

/** East loop: along the sidewalk to the bank, browse inside, walk back. */
const BANK_LOOP: PedWaypoint[] = [
  { x: -12, z: SIDEWALK_Z, place: "outside" },
  { x: 20.7, z: SIDEWALK_Z, place: "outside" },
  { x: 46, z: SIDEWALK_Z, place: "outside" },
  { x: BANK_X, z: SIDEWALK_Z, place: "outside" },
  { x: BANK_X, z: 14.3, place: "outside" },
  { x: BANK_X, z: 10.6, place: "bank" },
  { x: BANK_X - 4.6, z: BANK_Z + 0.5, place: "bank", dwell: true },
  { x: BANK_X, z: BANK_Z - 4.4, place: "bank", dwell: true },
  { x: BANK_X + 4.9, z: BANK_Z + 0.5, place: "bank", dwell: true },
  { x: BANK_X, z: 10.6, place: "bank" },
  { x: BANK_X, z: 14.3, place: "outside" },
  { x: BANK_X, z: SIDEWALK_Z, place: "outside" },
  { x: 46, z: SIDEWALK_Z, place: "outside" },
  { x: 20.7, z: SIDEWALK_Z, place: "outside" },
];

/** West loop: sidewalk to the showroom, admire the cars, walk back. */
const SHOWROOM_LOOP: PedWaypoint[] = [
  { x: -2, z: SIDEWALK_Z, place: "outside" },
  { x: -20.7, z: SIDEWALK_Z, place: "outside" },
  { x: SHOWROOM_X + 10, z: SHOWROOM_Z + 6, place: "outside" },
  { x: SHOWROOM_X + 9.8, z: SHOWROOM_Z + 0.5, place: "outside" },
  { x: SHOWROOM_X + 4.2, z: SHOWROOM_Z, place: "showroom" },
  { x: SHOWROOM_X + 5.3, z: SHOWROOM_Z - 4.5, place: "showroom", dwell: true },
  { x: SHOWROOM_X + 4.2, z: SHOWROOM_Z + 0.3, place: "showroom" },
  { x: SHOWROOM_X + 5.3, z: SHOWROOM_Z + 4.5, place: "showroom", dwell: true },
  { x: SHOWROOM_X + 4.2, z: SHOWROOM_Z, place: "showroom" },
  { x: SHOWROOM_X + 9.8, z: SHOWROOM_Z + 0.5, place: "outside" },
  { x: SHOWROOM_X + 10, z: SHOWROOM_Z + 8, place: "outside" },
  { x: -14, z: SIDEWALK_Z, place: "outside" },
];

const PED_TINTS = ["#c44", "#44c", "#4a4", "#a4a", "#c84", "#488"];
const PED_COUNT = 9;
// Pedestrians are never in the office, so the office collider slot is unused.
const NO_OFFICE_COLLIDERS: never[] = [];

interface PedConfig {
  personId: string;
  route: PedWaypoint[];
  startIdx: number;
  speed: number;
  tint: string;
  model: CharacterModel;
  /** Which way this pedestrian sidesteps when an obstacle blocks it. */
  slideSide: 1 | -1;
}

function makePedestrians(): PedConfig[] {
  return Array.from({ length: PED_COUNT }, (_, i) => {
    const route = i % 2 === 0 ? BANK_LOOP : SHOWROOM_LOOP;
    return {
      personId: `ped-${i}`,
      route,
      startIdx: Math.floor(seededRandom(i * 31 + 7) * route.length),
      speed: 1.0 + seededRandom(i * 37 + 11) * 0.6,
      tint: PED_TINTS[i % PED_TINTS.length],
      model: pickCharacterModel(seededRandom(i * 41 + 13)),
      slideSide: i % 2 === 0 ? 1 : -1,
    };
  });
}

function PedestrianInstance({
  config,
  visiblePlace,
}: {
  config: PedConfig;
  visiblePlace: AgentPlace | null;
}): React.JSX.Element {
  const { personId, route, startIdx, speed, tint, model, slideSide } = config;
  const { scene, animations } = useGLTF(model.url);
  const groupRef = useRef<THREE.Group>(null);
  const stateRef = useRef({
    x: route[startIdx].x,
    z: route[startIdx].z,
    idx: (startIdx + 1) % route.length,
    facing: 0,
    dwellUntil: 0,
    place: route[startIdx].place,
    // Committed obstacle slide (see the agents' walkStep for the rationale:
    // a per-frame nudge loses to the goal pull and pins the walker in place).
    slideDx: 0,
    slideDz: 0,
    slideUntil: 0,
  });

  const { cloned, mixer, walkIdx, idleIdx, autoScale } = useMemo(() => {
    const c = SkeletonClone(scene);
    c.updateMatrixWorld(true);
    tintCharacterClone(c, tint, 0.6, model.shirtMaterials);
    const bbox = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const aScale = size.y > 0 ? PERSON_WORLD_HEIGHT / size.y : 1;
    const m = new THREE.AnimationMixer(c);
    const names = animations.map((a) => a.name.toLowerCase());
    return {
      cloned: c,
      mixer: m,
      walkIdx: names.findIndex((n) => n.includes("walk")),
      idleIdx: names.findIndex((n) => n.includes("idle")),
      autoScale: aScale,
    };
  }, [scene, animations, tint, model]);

  // The actions live in a ref and are (re)created inside the effect — never
  // in the memo. Effect cleanup calls uncacheRoot, which invalidates every
  // existing action for that root; replaying a stale action afterwards (the
  // effect re-runs under StrictMode/HMR) throws three's
  // "Cannot set properties of undefined (setting '_cacheIndex')".
  const actionsRef = useRef<{
    walk: THREE.AnimationAction | null;
    idle: THREE.AnimationAction | null;
  }>({ walk: null, idle: null });

  useEffect(() => {
    // Both clips stay active; per-frame weights blend walk ↔ idle at dwells.
    const walk =
      walkIdx >= 0 ? mixer.clipAction(animations[walkIdx], cloned) : null;
    const idle =
      idleIdx >= 0 ? mixer.clipAction(animations[idleIdx], cloned) : null;
    if (walk) walk.reset().setEffectiveWeight(1).play();
    if (idle) idle.reset().setEffectiveWeight(0).play();
    actionsRef.current = { walk, idle };
    return () => {
      actionsRef.current = { walk: null, idle: null };
      mixer.stopAllAction();
      mixer.uncacheRoot(cloned);
      removeCrowdBody(personId);
    };
  }, [mixer, cloned, animations, walkIdx, idleIdx, personId]);

  useFrame((_, delta) => {
    mixer.update(Math.min(delta, 1 / 30));
    const g = groupRef.current;
    if (!g) return;
    const s = stateRef.current;
    const step = Math.min(delta, 0.05);
    const now = performance.now();

    let walking = false;
    const prevX = s.x;
    const prevZ = s.z;
    const target = route[s.idx];
    if (now >= s.dwellUntil) {
      s.place = target.place;
      if (now <= s.slideUntil) {
        // Mid-slide: walk the committed direction, ignore the waypoint.
        s.x += s.slideDx * speed * 0.85 * step;
        s.z += s.slideDz * speed * 0.85 * step;
        s.facing = Math.atan2(s.slideDx, s.slideDz);
        walking = true;
      } else {
        const dx = target.x - s.x;
        const dz = target.z - s.z;
        const dist = Math.hypot(dx, dz);
        // Loose arrival radius: a crowded stop (dwellers push each other
        // around) must still count as reached.
        if (dist < 0.8) {
          s.idx = (s.idx + 1) % route.length;
          if (target.dwell) s.dwellUntil = now + 2000 + Math.random() * 4500;
        } else {
          const move = Math.min(dist, speed * step);
          s.x += (dx / dist) * move;
          s.z += (dz / dist) * move;
          s.facing = Math.atan2(dx, dz);
          walking = true;
        }
      }
    }

    // Crowd separation + walls/furniture push-out (shared with agents).
    const p = { x: s.x, z: s.z };
    const push = { x: 0, z: 0 };
    applyCrowdSeparation(personId, s.place, p);
    resolveStaticColliders(
      collidersForPlace(s.place, NO_OFFICE_COLLIDERS),
      p,
      undefined,
      push,
    );
    s.x = p.x;
    s.z = p.z;
    setCrowdBody(personId, s.place, p.x, p.z);

    // Blocked (collision cancelled the step): commit to a slide along the
    // blocking face toward the waypoint, wall-following like the agents do —
    // shoving at the obstacle forever is what pinned people at the ATMs.
    // Applies both when steering at the waypoint and when cornered mid-slide
    // (the re-derived tangent wall-follows around the corner).
    if (walking && Math.hypot(s.x - prevX, s.z - prevZ) < 0.25 * speed * step) {
      const dx = target.x - s.x;
      const dz = target.z - s.z;
      const d = Math.hypot(dx, dz) || 1;
      const pl = Math.hypot(push.x, push.z);
      if (pl > 1e-6) {
        const tanX = -push.z / pl;
        const tanZ = push.x / pl;
        const dot = (tanX * dx + tanZ * dz) / d;
        const sign = Math.abs(dot) < 0.08 ? slideSide : Math.sign(dot);
        s.slideDx = tanX * sign;
        s.slideDz = tanZ * sign;
      } else {
        s.slideDx = (-dz / d) * slideSide;
        s.slideDz = (dx / d) * slideSide;
      }
      s.slideUntil = now + 400;
    }

    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.facing;
    // Interior views only show pedestrians actually in that building.
    g.visible = visiblePlace === null || s.place === visiblePlace;

    // Blend between the walk and idle clips over ~0.25 s.
    const { walk, idle } = actionsRef.current;
    if (walk && idle) {
      const current = walk.getEffectiveWeight();
      const next = THREE.MathUtils.damp(current, walking ? 1 : 0, 12, step);
      walk.setEffectiveWeight(next);
      idle.setEffectiveWeight(1 - next);
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={cloned} scale={autoScale} />
    </group>
  );
}

/** All city pedestrians. Mounted in every location; sim always runs. */
export const PedestriansLayer = memo(function PedestriansLayer({
  visiblePlace = null,
}: {
  /** null = show everyone (city view); otherwise only peds in that place. */
  visiblePlace?: AgentPlace | null;
}): React.JSX.Element {
  const peds = useRef<PedConfig[]>(makePedestrians());
  return (
    <>
      {peds.current.map((config) => (
        <PedestrianInstance
          key={config.personId}
          config={config}
          visiblePlace={visiblePlace}
        />
      ))}
    </>
  );
});
