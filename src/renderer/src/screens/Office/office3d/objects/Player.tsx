import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as SkeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { PERSON_WORLD_HEIGHT, WORLD_W, WORLD_H } from "../core/constants";
import {
  BANK_X,
  BANK_Z,
  BANK_W,
  BANK_D,
  SHOWROOM_X,
  SHOWROOM_Z,
  SHOWROOM_W,
  SHOWROOM_D,
  OFFICE_DOOR_X,
} from "../core/cityPlan";
import { CHAR_MAN } from "../core/characters";
import { tintCharacterClone } from "../core/glb";
import {
  applyCrowdSeparation,
  collidersForPlace,
  PERSON_RADIUS,
  removeCrowdBody,
  resolveStaticColliders,
  setCrowdBody,
  type StaticCollider,
} from "../core/collision";
import { TRAFFIC_OBSTACLES } from "./Traffic";
import type { AgentPlace } from "../core/types";
import {
  nearestInteraction,
  type PlayerInteraction,
} from "../interactions/proximity";

/**
 * The user's own avatar: a third-person, GTA-style walk controller. WASD /
 * arrow keys move (camera-relative), Shift runs, and the chase camera is the
 * scene's OrbitControls with its target glued to the avatar — so the mouse
 * still orbits/zooms for free while the camera travels with the player.
 *
 * The player is a first-class crowd citizen: it registers a crowd body, gets
 * pushed apart from agents/pedestrians, and resolves against the same static
 * colliders (walls with door gaps, furniture), so buildings are entered by
 * walking through their doorways — which is also how interiors load: the
 * avatar's place, derived from its position each frame, drives the screen's
 * location state.
 */

/** Where walk mode drops the avatar: just outside the HQ's south doorway. */
export const PLAYER_SPAWN: [number, number] = [
  OFFICE_DOOR_X,
  WORLD_H / 2 + 1.8,
];
/** The chase camera looks at the avatar's chest, not its feet. */
export const PLAYER_LOOK_Y = 1.15;

const PLAYER_ID = "player";
const WALK_SPEED = 2.1;
const RUN_SPEED = 4.6;
const TURN_RATE = 14;

/** Which building footprint (if any) contains this world position. */
function placeAt(x: number, z: number): AgentPlace {
  if (Math.abs(x) < WORLD_W / 2 && Math.abs(z) < WORLD_H / 2) return "office";
  if (Math.abs(x - BANK_X) < BANK_W / 2 && Math.abs(z - BANK_Z) < BANK_D / 2)
    return "bank";
  if (
    Math.abs(x - SHOWROOM_X) < SHOWROOM_W / 2 &&
    Math.abs(z - SHOWROOM_Z) < SHOWROOM_D / 2
  )
    return "showroom";
  return "outside";
}

function isEditableTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}

/** The subset of OrbitControls the follow-camera needs. */
interface FollowControls {
  target: THREE.Vector3;
  enabled: boolean;
}

export function PlayerLayer({
  controlsRef,
  officeColliders,
  interactions,
  label,
  onPlaceChange,
  onNearbyChange,
}: {
  controlsRef: React.RefObject<FollowControls | null>;
  /** Office static colliders (walls + desks), built by Office3D. */
  officeColliders: StaticCollider[];
  /** Press-E points; the nearest in-range one is reported to the shell. */
  interactions: PlayerInteraction[];
  /** Pre-translated nameplate text ("You"). */
  label: string;
  onPlaceChange?: (place: AgentPlace) => void;
  onNearbyChange?: (p: PlayerInteraction | null) => void;
}): React.JSX.Element {
  const { scene, animations } = useGLTF(CHAR_MAN.url);
  const camera = useThree((s) => s.camera);
  const groupRef = useRef<THREE.Group>(null);

  // Latest-callback refs so the frame loop never closes over stale props.
  const onPlaceRef = useRef(onPlaceChange);
  onPlaceRef.current = onPlaceChange;
  const onNearbyRef = useRef(onNearbyChange);
  onNearbyRef.current = onNearbyChange;
  const interactionsRef = useRef(interactions);
  interactionsRef.current = interactions;
  const officeCollidersRef = useRef(officeColliders);
  officeCollidersRef.current = officeColliders;

  const stateRef = useRef({
    x: PLAYER_SPAWN[0],
    z: PLAYER_SPAWN[1],
    facing: Math.PI, // face south, toward the camera's spawn framing
    place: "outside" as AgentPlace,
    nearbyId: null as string | null,
  });

  // Pressed movement keys (by KeyboardEvent.code). Window-level listeners:
  // the canvas never holds focus, and typing into inputs/modals is excluded.
  const keysRef = useRef(new Set<string>());
  useEffect(() => {
    const keys = keysRef.current;
    const down = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey) return;
      keys.add(e.code);
      // Arrows would otherwise scroll ancestor containers.
      if (e.code.startsWith("Arrow")) e.preventDefault();
    };
    const up = (e: KeyboardEvent): void => {
      keys.delete(e.code);
    };
    const clear = (): void => {
      keys.clear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      keys.clear();
    };
  }, []);

  const { cloned, mixer, walkIdx, idleIdx, runIdx, autoScale } = useMemo(() => {
    const c = SkeletonClone(scene);
    c.updateMatrixWorld(true);
    tintCharacterClone(c, "#f4b41f", 0.6, CHAR_MAN.shirtMaterials);
    const bbox = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const names = animations.map((a) => a.name.toLowerCase());
    return {
      cloned: c,
      mixer: new THREE.AnimationMixer(c),
      walkIdx: names.findIndex((n) => n.includes("walk")),
      idleIdx: names.findIndex((n) => n.includes("idle")),
      runIdx: names.findIndex((n) => n.includes("run") || n.includes("sprint")),
      autoScale: size.y > 0 ? PERSON_WORLD_HEIGHT / size.y : 1,
    };
  }, [scene, animations]);

  // Actions are (re)created in the effect, never the memo — see
  // PedestrianInstance for the uncacheRoot/StrictMode rationale.
  const actionsRef = useRef<{
    walk: THREE.AnimationAction | null;
    idle: THREE.AnimationAction | null;
    run: THREE.AnimationAction | null;
  }>({ walk: null, idle: null, run: null });

  useEffect(() => {
    const action = (idx: number): THREE.AnimationAction | null =>
      idx >= 0 ? mixer.clipAction(animations[idx], cloned) : null;
    const walk = action(walkIdx);
    const idle = action(idleIdx);
    const run = action(runIdx);
    if (walk) walk.reset().setEffectiveWeight(0).play();
    if (idle) idle.reset().setEffectiveWeight(1).play();
    if (run) run.reset().setEffectiveWeight(0).play();
    actionsRef.current = { walk, idle, run };
    return () => {
      actionsRef.current = { walk: null, idle: null, run: null };
      mixer.stopAllAction();
      mixer.uncacheRoot(cloned);
      removeCrowdBody(PLAYER_ID);
      onNearbyRef.current?.(null);
    };
  }, [mixer, cloned, animations, walkIdx, idleIdx, runIdx]);

  useFrame((_, delta) => {
    mixer.update(Math.min(delta, 1 / 30));
    const g = groupRef.current;
    if (!g) return;
    const s = stateRef.current;
    const step = Math.min(delta, 0.05);
    const keys = keysRef.current;
    const controls = controlsRef.current;

    // ── Input → camera-relative move vector ─────────────────────────────
    const iz =
      (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
      (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const ix =
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const running = keys.has("ShiftLeft") || keys.has("ShiftRight");
    let moving = false;
    if (ix !== 0 || iz !== 0) {
      // Ground-projected camera forward; right = forward × up.
      const lookX = controls ? controls.target.x : s.x;
      const lookZ = controls ? controls.target.z : s.z;
      let fx = lookX - camera.position.x;
      let fz = lookZ - camera.position.z;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
      let mx = fx * iz + -fz * ix;
      let mz = fz * iz + fx * ix;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      const speed = running ? RUN_SPEED : WALK_SPEED;
      s.x += mx * speed * step;
      s.z += mz * speed * step;
      // Turn toward the move direction along the shortest arc.
      const target = Math.atan2(mx, mz);
      let diff = target - s.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      s.facing += diff * Math.min(1, TURN_RATE * step);
      moving = true;
    }

    // ── Collision (crowd + walls/furniture, same rules as everyone) ─────
    const p = { x: s.x, z: s.z };
    applyCrowdSeparation(PLAYER_ID, s.place, p);
    resolveStaticColliders(
      collidersForPlace(s.place, officeCollidersRef.current),
      p,
    );
    // Outdoors, cars are solid too: push out of the live vehicle circles.
    // Traffic already brakes for the player, so this only fires when the
    // player walks into a car — a moving one shoves them aside, never
    // through. (Empty while indoors: the traffic layer clears it.)
    if (s.place === "outside") {
      for (const o of TRAFFIC_OBSTACLES) {
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const rsum = o.r + PERSON_RADIUS;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rsum * rsum || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = rsum - d;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
    }
    s.x = p.x;
    s.z = p.z;
    setCrowdBody(PLAYER_ID, s.place, s.x, s.z);

    // ── Place: walking through a doorway swaps the mounted location ─────
    const place = placeAt(s.x, s.z);
    if (place !== s.place) {
      s.place = place;
      onPlaceRef.current?.(place);
    }

    // ── Nearest Press-E point (report only on change) ───────────────────
    const nearby = nearestInteraction(
      interactionsRef.current,
      s.place,
      s.x,
      s.z,
    );
    if ((nearby?.id ?? null) !== s.nearbyId) {
      s.nearbyId = nearby?.id ?? null;
      onNearbyRef.current?.(nearby);
    }

    // ── Chase camera: translate the rig with the avatar ─────────────────
    // Skipped while CameraRig owns the camera (controls disabled mid-flight).
    if (controls && controls.enabled) {
      const t = controls.target;
      const dx = s.x - t.x;
      const dy = PLAYER_LOOK_Y - t.y;
      const dz = s.z - t.z;
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
      t.set(s.x, PLAYER_LOOK_Y, s.z);
    }

    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.facing;

    // ── Animation blend: idle ↔ walk ↔ run ──────────────────────────────
    const { walk, idle, run } = actionsRef.current;
    if (walk && idle) {
      const wTarget = moving && (!running || !run) ? 1 : 0;
      const rTarget = moving && running && run ? 1 : 0;
      const w = THREE.MathUtils.damp(
        walk.getEffectiveWeight(),
        wTarget,
        12,
        step,
      );
      const r = run
        ? THREE.MathUtils.damp(run.getEffectiveWeight(), rTarget, 12, step)
        : 0;
      walk.setEffectiveWeight(w);
      // Without a dedicated run clip the walk cycle just plays faster.
      walk.setEffectiveTimeScale(!run && running && moving ? 1.7 : 1);
      if (run) run.setEffectiveWeight(r);
      idle.setEffectiveWeight(Math.max(0, 1 - w - r));
    }
  });

  const labelWidth = Math.max(1.0, label.length * 0.13 + 0.5);
  return (
    <group ref={groupRef} position={[PLAYER_SPAWN[0], 0, PLAYER_SPAWN[1]]}>
      <primitive object={cloned} scale={autoScale} />
      <Billboard position={[0, PERSON_WORLD_HEIGHT + 0.45, 0]}>
        <mesh position={[0, 0, -0.001]}>
          <planeGeometry args={[labelWidth, 0.36]} />
          <meshBasicMaterial color="#080c14" transparent opacity={0.85} />
        </mesh>
        <Text
          position={[0, 0, 0.001]}
          fontSize={0.2}
          color="#f4b41f"
          anchorX="center"
          anchorY="middle"
          font={undefined}
        >
          {label}
        </Text>
      </Billboard>
    </group>
  );
}
