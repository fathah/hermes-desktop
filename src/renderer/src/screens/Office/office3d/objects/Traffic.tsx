import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import car1GlbUrl from "../assets/car1.glb?url";
import car2GlbUrl from "../assets/car2.glb?url";
import truck1GlbUrl from "../assets/truck1.glb?url";
import { seededRandom } from "../core/rng";
import { vehicleClone, normalizeFootprint } from "../core/glb";
import { ROADS, ROAD_WIDTH, ROAD_Y, TRAFFIC_LEN } from "../core/cityPlan";

export { car1GlbUrl, car2GlbUrl, truck1GlbUrl };

export const VEHICLE_TINTS = [
  "#b03a2e", // red
  "#1f618d", // blue
  "#239b56", // green
  "#d4ac0d", // yellow
  "#6c3483", // purple
  "#ca6f1e", // orange
  "#e8e8e8", // white
  "#39414f", // gunmetal
];

/**
 * Extra yaw so each model's nose points +Z after footprint normalisation.
 * Aligning the long axis to Z can't know which end is the front: car1's GLB
 * has its front wheels at -Z (nose points -Z), so without this correction
 * every car1 drives tail-first. car2 and truck1 already face +Z.
 */
const MODEL_NOSE_YAW: Record<string, number> = {
  [car1GlbUrl]: Math.PI,
};

// ── Traffic simulation tuning (world units, seconds) ──────────────────────
const ACCEL = 3.5; // pull-away acceleration
const BRAKE = 14; // braking deceleration
const MIN_GAP = 1.0; // hard-stop bumper-to-bumper gap behind the leader
const SLOW_GAP = 3.2; // start matching the leader's speed inside this gap
const STOP_ZONE = 3.4; // begin yielding this far before a junction box
const YIELD_DIST = 9; // N-S traffic waits while E-W traffic is this close
// Junction box half-extent along the direction of travel: half the crossing
// road's width plus clearance so cars stop visibly short of the junction.
const HALF_BOX = ROAD_WIDTH / 2 + 0.6;

interface TrafficVehicle {
  url: string;
  tint: string;
  /** Footprint length in world units after normalisation. */
  targetLen: number;
  /** Half the footprint length — used for bumper gaps and box occupancy. */
  halfLen: number;
  /** Axis the vehicle travels along ("x" = E-W roads, "z" = N-S roads). */
  axis: "x" | "z";
  /** Index of the vehicle's road within its axis group (junction lookup). */
  roadIdx: number;
  /** Fixed cross-axis coordinate — road centre plus its lane offset. */
  fixed: number;
  dir: 1 | -1;
  /** Cruising speed; the live `speed` eases toward or away from this. */
  cruise: number;
  /** Precomputed heading index into ROT_YAWS (constant per vehicle). */
  rotIdx: number;
  // Live simulation state
  /** Position along the road in [-TRAFFIC_LEN/2, TRAFFIC_LEN/2]. */
  s: number;
  speed: number;
  /** Junction box the vehicle currently occupies, or -1 (set per frame). */
  insideBox: number;
}

/** The four headings traffic uses; `rotIdx` indexes into this. */
const ROT_YAWS = [Math.PI / 2, -Math.PI / 2, 0, Math.PI];

function makeTraffic(): TrafficVehicle[] {
  const lane = ROAD_WIDTH / 4; // centre of each carriageway half
  const vehicles: TrafficVehicle[] = [];
  let seed = 0;
  let xRoadIdx = 0;
  let zRoadIdx = 0;
  for (const road of ROADS) {
    const roadIdx = road.axis === "x" ? xRoadIdx++ : zRoadIdx++;
    const perRoad = 7;
    for (let i = 0; i < perRoad; i++) {
      seed += 1;
      const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const roll = seededRandom(seed * 7 + 1);
      const isTruck = roll > 0.78;
      const url = isTruck
        ? truck1GlbUrl
        : roll > 0.39
          ? car2GlbUrl
          : car1GlbUrl;
      const targetLen = isTruck ? 3.4 : 2.3;
      const cruise = (isTruck ? 3.2 : 4.5) + seededRandom(seed * 13 + 3) * 2.2;
      vehicles.push({
        url,
        tint: VEHICLE_TINTS[
          Math.floor(seededRandom(seed * 11 + 2) * VEHICLE_TINTS.length)
        ],
        targetLen,
        halfLen: targetLen / 2,
        axis: road.axis,
        roadIdx,
        // Two-way traffic: each direction drives in its own lane.
        fixed: road.center + dir * lane,
        dir,
        cruise,
        rotIdx: road.axis === "x" ? (dir > 0 ? 0 : 1) : dir > 0 ? 2 : 3,
        s:
          -TRAFFIC_LEN / 2 +
          ((i + seededRandom(seed * 17 + 4) * 0.6) / perRoad) * TRAFFIC_LEN,
        speed: cruise,
        insideBox: -1,
      });
    }
  }
  return vehicles;
}

/**
 * A tinted, footprint-normalised vehicle. Also used by the car showroom for
 * its display cars, so the whole world shares one vehicle pipeline.
 */
export function VehicleModel({
  url,
  tint,
  targetLen,
}: {
  url: string;
  tint: string;
  targetLen: number;
}): React.JSX.Element {
  const { scene } = useGLTF(url, false, false);
  const object = useMemo(
    () =>
      normalizeFootprint(
        vehicleClone(scene, tint),
        targetLen,
        true,
        MODEL_NOSE_YAW[url] ?? 0,
      ),
    [scene, tint, targetLen, url],
  );
  return <primitive object={object} />;
}

// ── Instanced fleet rendering ──────────────────────────────────────────────
// Instead of one GLB clone per vehicle (~10 meshes × unique materials × 56
// vehicles ≈ hundreds of draw calls plus 56 useFrame subscriptions), each
// model's sub-meshes become InstancedMeshes shared by every vehicle of that
// model — the whole fleet renders in ~a dozen draw calls, animated by a
// single useFrame loop. Per-vehicle paint uses instanceColor.

interface FleetPart {
  mesh: THREE.InstancedMesh;
  /** ROT_YAWS[i] * partLocalMatrix, so per-frame work is copy + translate. */
  rotVariants: THREE.Matrix4[];
}

interface Fleet {
  parts: FleetPart[];
  /** Global vehicle index for each instance slot. */
  vehicleIdx: number[];
}

interface TrafficWorld {
  vehicles: TrafficVehicle[];
  /** Vehicle indices grouped by lane (same road, same direction). */
  lanes: number[][];
  fleets: Fleet[];
  materials: THREE.Material[];
  /** Centres (z) of E-W roads and (x) of N-S roads — junction coordinates. */
  xRoadZs: number[];
  zRoadXs: number[];
  /** Per-junction flags, reset each frame. Index = xRoad * nZRoads + zRoad. */
  occX: Uint8Array;
  occZ: Uint8Array;
  nearX: Uint8Array;
  desired: Float32Array;
  tmpMat: THREE.Matrix4;
}

interface PartTemplate {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  tintable: boolean;
  srcColor: THREE.Color;
  local: THREE.Matrix4;
}

/**
 * Convert a source GLB material the same way [[vehicleClone]] does, but with
 * the tint left to per-instance colour: tintable (light) materials get a
 * white base so instanceColor becomes the final paint; dark trim (tyres,
 * glass, grilles) keeps its colour and gets no instanceColor.
 */
function convertPartMaterial(src: THREE.Material): {
  material: THREE.MeshStandardMaterial;
  tintable: boolean;
  srcColor: THREE.Color;
} {
  const withColor = src as THREE.Material & {
    color?: THREE.Color;
    map?: THREE.Texture | null;
  };
  const srcColor = withColor.color
    ? withColor.color.clone()
    : new THREE.Color("#ffffff");
  const hsl = { h: 0, s: 0, l: 0 };
  srcColor.getHSL(hsl);
  const tintable = hsl.l > 0.22;
  const material = new THREE.MeshStandardMaterial({
    color: tintable ? new THREE.Color("#ffffff") : srcColor.clone(),
    map: withColor.map ?? null,
    roughness: 0.45,
    metalness: 0.15,
    envMapIntensity: 0.9,
  });
  return { material, tintable, srcColor };
}

/**
 * Flatten a vehicle GLB into instanceable parts. Reproduces the transform
 * maths of [[normalizeFootprint]] (recentre, ground, scale, align long axis
 * to +Z, nose flip) as a baked matrix per sub-mesh, so instances place
 * exactly like the old per-vehicle clones did.
 */
function buildPartTemplates(
  scene: THREE.Object3D,
  targetLen: number,
  noseYaw: number,
): PartTemplate[] {
  scene.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);
  const base = Math.max(size.x, size.z);
  const scale = base > 0 ? targetLen / base : 1;
  const yaw = (size.x > size.z ? Math.PI / 2 : 0) + noseYaw;
  // Recentre/ground shift, expressed relative to the scene root's own
  // position (normalizeFootprint overrides that position on the clone).
  const shift = new THREE.Matrix4().makeTranslation(
    -center.x - scene.position.x,
    -bbox.min.y - scene.position.y,
    -center.z - scene.position.z,
  );
  const norm = new THREE.Matrix4()
    .makeRotationY(yaw)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(shift);

  const parts: PartTemplate[] = [];
  const matCache = new Map<string, ReturnType<typeof convertPartMaterial>>();
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    // GLTFLoader splits multi-primitive meshes into single-material meshes,
    // so material arrays don't occur for these assets.
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    let converted = matCache.get(src.uuid);
    if (!converted) {
      converted = convertPartMaterial(src);
      matCache.set(src.uuid, converted);
    }
    parts.push({
      geometry: mesh.geometry,
      material: converted.material,
      tintable: converted.tintable,
      srcColor: converted.srcColor,
      local: norm.clone().multiply(mesh.matrixWorld),
    });
  });
  return parts;
}

function buildTrafficWorld(
  scenes: Record<string, THREE.Object3D>,
): TrafficWorld {
  const vehicles = makeTraffic();

  const laneMap = new Map<string, number[]>();
  vehicles.forEach((v, i) => {
    const key = `${v.axis}|${v.fixed}`;
    const lane = laneMap.get(key);
    if (lane) lane.push(i);
    else laneMap.set(key, [i]);
  });

  const xRoadZs = ROADS.filter((r) => r.axis === "x").map((r) => r.center);
  const zRoadXs = ROADS.filter((r) => r.axis === "z").map((r) => r.center);
  const boxCount = xRoadZs.length * zRoadXs.length;

  const fleets: Fleet[] = [];
  const materials: THREE.Material[] = [];
  const tintColor = new THREE.Color();
  const instColor = new THREE.Color();
  for (const url of [car1GlbUrl, car2GlbUrl, truck1GlbUrl]) {
    const vehicleIdx: number[] = [];
    vehicles.forEach((v, i) => {
      if (v.url === url) vehicleIdx.push(i);
    });
    if (vehicleIdx.length === 0) continue;
    const templates = buildPartTemplates(
      scenes[url],
      vehicles[vehicleIdx[0]].targetLen,
      MODEL_NOSE_YAW[url] ?? 0,
    );
    const parts: FleetPart[] = templates.map((t) => {
      const mesh = new THREE.InstancedMesh(
        t.geometry,
        t.material,
        vehicleIdx.length,
      );
      mesh.castShadow = true;
      // Instances span the whole road network; per-geometry culling would
      // use the wrong bounds.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (t.tintable) {
        vehicleIdx.forEach((vi, k) => {
          tintColor.set(vehicles[vi].tint);
          instColor.copy(t.srcColor).lerp(tintColor, 0.8);
          mesh.setColorAt(k, instColor);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (!materials.includes(t.material)) materials.push(t.material);
      return {
        mesh,
        rotVariants: ROT_YAWS.map((y) =>
          new THREE.Matrix4().makeRotationY(y).multiply(t.local),
        ),
      };
    });
    fleets.push({ parts, vehicleIdx });
  }

  const world: TrafficWorld = {
    vehicles,
    lanes: [...laneMap.values()],
    fleets,
    materials,
    xRoadZs,
    zRoadXs,
    occX: new Uint8Array(boxCount),
    occZ: new Uint8Array(boxCount),
    nearX: new Uint8Array(boxCount),
    desired: new Float32Array(vehicles.length),
    tmpMat: new THREE.Matrix4(),
  };
  // Place instances before the first painted frame.
  writeInstanceMatrices(world);
  return world;
}

function disposeTrafficWorld(world: TrafficWorld): void {
  for (const fleet of world.fleets)
    for (const part of fleet.parts) part.mesh.dispose();
  for (const material of world.materials) material.dispose();
}

/** Wrapped distance from `v` forward to another position along the loop. */
function gapAhead(v: TrafficVehicle, otherS: number): number {
  const raw = (otherS - v.s) * v.dir;
  return ((raw % TRAFFIC_LEN) + TRAFFIC_LEN) % TRAFFIC_LEN;
}

/**
 * One simulation step: car-following within each lane (never drive through
 * the vehicle ahead — brake, queue, and pull away once it moves on) and
 * junction yielding (stop before an occupied crossing; N-S traffic also
 * yields to approaching E-W traffic so the two never deadlock).
 */
function stepTraffic(world: TrafficWorld, dt: number): void {
  const { vehicles, lanes, xRoadZs, zRoadXs, occX, occZ, nearX, desired } =
    world;
  const nZ = zRoadXs.length;
  occX.fill(0);
  occZ.fill(0);
  nearX.fill(0);

  // Pass 1: junction occupancy. A vehicle inside a box marks it for its
  // axis; E-W vehicles closing in on a box also flag it so N-S traffic
  // (the low-priority axis) waits instead of darting across.
  for (const v of vehicles) {
    v.insideBox = -1;
    const crossings = v.axis === "x" ? zRoadXs : xRoadZs;
    for (let j = 0; j < crossings.length; j++) {
      const box = v.axis === "x" ? v.roadIdx * nZ + j : j * nZ + v.roadIdx;
      const d = crossings[j] - v.s;
      if (Math.abs(d) < HALF_BOX + v.halfLen) {
        (v.axis === "x" ? occX : occZ)[box] = 1;
        v.insideBox = box;
      } else if (v.axis === "x") {
        const entry = d * v.dir - HALF_BOX - v.halfLen;
        if (entry > 0 && entry < YIELD_DIST) nearX[box] = 1;
      }
    }
  }

  // Pass 2: pick each vehicle's target speed from current world state.
  for (const lane of lanes) {
    for (let a = 0; a < lane.length; a++) {
      const vi = lane[a];
      const v = vehicles[vi];
      let target = v.cruise;

      // Car-following: find the nearest vehicle ahead in this lane.
      let bestGap = Infinity;
      let leaderSpeed = 0;
      for (let b = 0; b < lane.length; b++) {
        if (b === a) continue;
        const o = vehicles[lane[b]];
        const gap = gapAhead(v, o.s) - o.halfLen - v.halfLen;
        if (gap < bestGap) {
          bestGap = gap;
          leaderSpeed = o.speed;
        }
      }
      if (bestGap < MIN_GAP) target = 0;
      else if (bestGap < SLOW_GAP) target = Math.min(target, leaderSpeed);

      // Junction yielding — only when not already committed to a crossing.
      if (target > 0 && v.insideBox < 0) {
        const crossings = v.axis === "x" ? zRoadXs : xRoadZs;
        for (let j = 0; j < crossings.length; j++) {
          const entry = (crossings[j] - v.s) * v.dir - HALF_BOX - v.halfLen;
          if (entry <= 0 || entry >= STOP_ZONE) continue;
          const box = v.axis === "x" ? v.roadIdx * nZ + j : j * nZ + v.roadIdx;
          const crossOccupied = v.axis === "x" ? occZ[box] : occX[box];
          if (crossOccupied || (v.axis === "z" && nearX[box])) {
            target = 0;
            break;
          }
        }
      }
      desired[vi] = target;
    }
  }

  // Pass 3: integrate. Ease toward the target speed so cars visibly brake
  // and pull away instead of snapping.
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const target = desired[i];
    if (target > v.speed) v.speed = Math.min(target, v.speed + ACCEL * dt);
    else v.speed = Math.max(target, v.speed - BRAKE * dt);
    let s = v.s + v.dir * v.speed * dt;
    const half = TRAFFIC_LEN / 2;
    if (s > half) s -= TRAFFIC_LEN;
    else if (s < -half) s += TRAFFIC_LEN;
    v.s = s;
  }
}

function writeInstanceMatrices(world: TrafficWorld): void {
  const m = world.tmpMat;
  for (const fleet of world.fleets) {
    for (let k = 0; k < fleet.vehicleIdx.length; k++) {
      const v = world.vehicles[fleet.vehicleIdx[k]];
      const px = v.axis === "x" ? v.s : v.fixed;
      const pz = v.axis === "x" ? v.fixed : v.s;
      for (const part of fleet.parts) {
        m.copy(part.rotVariants[v.rotIdx]);
        m.elements[12] += px;
        m.elements[13] += ROAD_Y;
        m.elements[14] += pz;
        part.mesh.setMatrixAt(k, m);
      }
    }
    for (const part of fleet.parts) part.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Cars / trucks looping on all backdrop roads. Vehicles follow the car
 * ahead in their lane and yield at junctions; the whole fleet is rendered
 * with instancing and driven by a single per-frame update.
 */
export const TrafficLayer = memo(function TrafficLayer(): React.JSX.Element {
  const car1 = useGLTF(car1GlbUrl, false, false);
  const car2 = useGLTF(car2GlbUrl, false, false);
  const truck1 = useGLTF(truck1GlbUrl, false, false);
  const world = useMemo(
    () =>
      buildTrafficWorld({
        [car1GlbUrl]: car1.scene,
        [car2GlbUrl]: car2.scene,
        [truck1GlbUrl]: truck1.scene,
      }),
    [car1.scene, car2.scene, truck1.scene],
  );
  const worldRef = useRef(world);
  worldRef.current = world;
  useEffect(() => {
    const built = world;
    return () => disposeTrafficWorld(built);
  }, [world]);
  useFrame((_, delta) => {
    const w = worldRef.current;
    stepTraffic(w, Math.min(delta, 0.05));
    writeInstanceMatrices(w);
  });
  return (
    <>
      {world.fleets.flatMap((fleet) =>
        fleet.parts.map((part) => (
          <primitive key={part.mesh.uuid} object={part.mesh} />
        )),
      )}
    </>
  );
});

useGLTF.preload(car1GlbUrl, false, false);
useGLTF.preload(car2GlbUrl, false, false);
useGLTF.preload(truck1GlbUrl, false, false);
