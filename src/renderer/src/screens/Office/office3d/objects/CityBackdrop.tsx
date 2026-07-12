import { Suspense, memo, useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import treeGlbUrl from "../assets/tree.glb?url";
import building1GlbUrl from "../assets/building1.glb?url";
import building2GlbUrl from "../assets/building2.glb?url";
import apartmentGlbUrl from "../assets/apartment.glb?url";
import apartment2GlbUrl from "../assets/apartment2.glb?url";
import streetLightGlbUrl from "../assets/street-light.glb?url";
import trafficLightGlbUrl from "../assets/traffic-light.glb?url";
import { WORLD_W, WORLD_H } from "../core/constants";
import { seededRandom } from "../core/rng";
import { glbClone, normalizeFootprint } from "../core/glb";
import {
  BANK_W,
  BANK_D,
  BANK_X,
  BANK_Z,
  BANK_STREET_GAP,
  ROADS,
  ROAD_SOUTH_Z,
  ROAD_NORTH_Z,
  ROAD_EAST_X,
  ROAD_WIDTH,
  ROAD_LEN,
  ROAD_Y,
  ROAD_MARKING_Y,
  SHOWROOM_W,
  SHOWROOM_D,
  SHOWROOM_X,
  SHOWROOM_Z,
  VIEW_BLOCKER_SPOTS,
} from "../core/cityPlan";

// ── Shared geometry / materials ────────────────────────────────────────────
// Road surfaces share one unit plane (scaled per mesh) + one material. The
// module-level singletons are used with dispose={null} so an unmount of the
// Office tab can't dispose a shared resource out from under a remount.
const unitPlaneGeo = new THREE.PlaneGeometry(1, 1);
const roadMat = new THREE.MeshStandardMaterial({
  color: "#4a4e57",
  roughness: 0.95,
});

// Detailed near-building models. A GLB (1 mesh, a few material primitives) is
// ~3-5 draw calls regardless of size — an order of magnitude cheaper than the
// old procedural boxes, which spawned one plane mesh per window (hundreds of
// draw calls). Far buildings stay as flat windowless boxes (1 draw call, and
// fog hides the missing detail anyway).
const BUILDING_URLS = [
  apartmentGlbUrl,
  apartment2GlbUrl,
  building1GlbUrl,
  building2GlbUrl,
];

// Manual position overrides for procedural backdrop buildings, keyed by their
// stable grid id (e.g. "gb:7,12" / "box:3,18"). Populated from the in-app
// "Move buildings" dev tool, which logs a ready-to-paste line per move. Value
// is the building's new [x, z]; everything else (size, rotation, model) is
// still derived from the grid seed, so only the position changes.
export const BACKDROP_OVERRIDES: Record<string, [number, number]> = {
  "gb:1,4": [-33.9, -16.35],
  "gb:2,5": [-56.69, -33.89],
  "gb:2,17": [-54.29, 32.85],
  "gb:7,2": [-13.58, -56.21],
  "gb:7,5": [62.15, -30.75],
  "gb:7,16": [-12.99, 28.38],
  "gb:8,4": [-31.75, -86.9],
  "gb:8,5": [-14.05, -27.15],
  "gb:8,16": [-6.15, 31.23],
  "gb:9,3": [-8.65, -49.79],
  "gb:9,4": [-1.67, -34.39],
  "gb:9,5": [10.94, -106.04],
  "gb:10,0": [-3.82, -50.23],
  "gb:10,3": [13.9, -72.32],
  "gb:10,5": [-1.58, -85.83],
  "gb:10,18": [-0.08, 38.6],
  "gb:11,3": [12.66, -52.18],
  "gb:11,16": [9.42, 30.38],
  "gb:11,17": [5.11, 40.42],
  "gb:12,4": [13.82, -25.09],
  "gb:15,6": [28.02, -14.12],
  "gb:15,16": [25.88, 33.47],
  "gb:16,11": [28.78, 7.25],
  "gb:16,16": [30.22, 36.4],
  "gb:17,5": [35.54, -59.8],
  "gb:17,6": [28.6, -79.52],
  "gb:17,8": [39.63, -1.71],
  "gb:18,4": [28.82, -52.79],
  "box:1,0": [-41.98, -50.6],
  "box:1,2": [-39.98, -34.49],
  "box:3,0": [-33.38, -51.31],
};

/**
 * Detailed backdrop building (apartment / building GLB), auto-normalised:
 * recentred, grounded at y=0 and uniformly scaled so its footprint fits the
 * city-grid cell, with a random quarter-turn for variety.
 */
function CityBuildingGlb({
  x,
  z,
  footprint,
  rotY,
  url,
  onClick,
}: {
  x: number;
  z: number;
  footprint: number;
  rotY: number;
  url: string;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}): React.JSX.Element {
  const { scene } = useGLTF(url, false, false);
  const object = useMemo(
    () => normalizeFootprint(glbClone(scene, null), footprint),
    [scene, footprint],
  );
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]} onClick={onClick}>
      <primitive object={object} />
    </group>
  );
}

function TreeGlb({
  x,
  z,
  h,
}: {
  x: number;
  z: number;
  h: number;
}): React.JSX.Element {
  const { scene } = useGLTF(treeGlbUrl, false, false);
  const object = useMemo(() => glbClone(scene, null), [scene]);
  const s = h * 0.28;
  return (
    <group position={[x, 0, z]} scale={[s, s, s]}>
      <primitive object={object} />
    </group>
  );
}

function StreetLightGlb({
  x,
  z,
  rotY = 0,
}: {
  x: number;
  z: number;
  rotY?: number;
}): React.JSX.Element {
  const { scene } = useGLTF(streetLightGlbUrl, false, false);
  const object = useMemo(() => glbClone(scene, null), [scene]);
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]} scale={[0.8, 0.8, 0.8]}>
      <primitive object={object} />
    </group>
  );
}

function TrafficLightGlb({
  x,
  z,
  rotY = 0,
}: {
  x: number;
  z: number;
  rotY?: number;
}): React.JSX.Element {
  const { scene } = useGLTF(trafficLightGlbUrl, false, false);
  const object = useMemo(() => glbClone(scene, null), [scene]);
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]} scale={[1.6, 1.6, 1.6]}>
      <primitive object={object} />
    </group>
  );
}

/**
 * Distant low-poly skyline ring — silhouette towers scattered in a wide band
 * outside the detailed backdrop lot, so the horizon reads as a city that
 * keeps going (GTA-style layering: crisp lot → hazy mid-distance towers →
 * sky). One instanced draw call; fog does the atmospheric blending.
 */
const SKYLINE_COUNT = 110;
const SKYLINE_UP = new THREE.Vector3(0, 1, 0);

// Road corridors the skyline must keep clear: the roads run the full
// ROAD_LEN (±300) out into the skyline band and traffic loops over ±160, so
// a tower straddling a carriageway would have cars driving through it.
const SKYLINE_X_ROAD_ZS = ROADS.filter((r) => r.axis === "x").map(
  (r) => r.center,
);
const SKYLINE_Z_ROAD_XS = ROADS.filter((r) => r.axis === "z").map(
  (r) => r.center,
);

/** True when a tower (conservative half-diagonal `rad`) clears every road. */
function skylineClearOfRoads(px: number, pz: number, rad: number): boolean {
  const need = rad + ROAD_WIDTH / 2 + 1.2;
  return (
    !SKYLINE_X_ROAD_ZS.some((c) => Math.abs(pz - c) < need) &&
    !SKYLINE_Z_ROAD_XS.some((c) => Math.abs(px - c) < need)
  );
}

export const DistantSkyline = memo(
  function DistantSkyline(): React.JSX.Element {
    const meshRef = useRef<THREE.InstancedMesh>(null);

    useLayoutEffect(() => {
      const mesh = meshRef.current;
      if (!mesh) return;
      const matrix = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      const color = new THREE.Color();
      for (let i = 0; i < SKYLINE_COUNT; i++) {
        const w = 5 + seededRandom(i * 3 + 3) * 12;
        const d = 5 + seededRandom(i * 5 + 4) * 12;
        // Rotation is an arbitrary yaw, so use the half-diagonal as the
        // footprint radius when testing road clearance.
        const rad = Math.hypot(w, d) / 2;
        // Deterministic rejection sampling: re-roll the polar position until
        // the tower clears every road corridor. Corridors cover a small
        // fraction of the band so a few attempts always land; the rare
        // stubborn tower is dropped (scale 0) rather than left on a road.
        let radius = 75;
        let px = 0;
        let pz = 0;
        let placed = false;
        for (let attempt = 0; attempt < 14 && !placed; attempt++) {
          const s = i * 3 + attempt * 7919;
          const angle = seededRandom(s + 1) * Math.PI * 2;
          // Bias towards the outer edge so towers stack into a skyline wall.
          radius = 75 + Math.pow(seededRandom(s + 2), 0.7) * 190;
          px = Math.cos(angle) * radius;
          pz = Math.sin(angle) * radius;
          placed = skylineClearOfRoads(px, pz, rad);
        }
        // Further rings grow taller so they stay visible over nearer ones.
        const h = 8 + seededRandom(i * 7 + 5) * 28 + (radius - 75) * 0.12;
        quat.setFromAxisAngle(SKYLINE_UP, seededRandom(i * 11 + 6) * Math.PI);
        pos.set(px, h / 2 - 0.1, pz);
        if (placed) scl.set(w, h, d);
        else scl.setScalar(0);
        matrix.compose(pos, quat, scl);
        mesh.setMatrixAt(i, matrix);
        color.setHSL(215 / 360, 0.1, 0.36 + seededRandom(i * 13 + 7) * 0.22);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, []);

    return (
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, SKYLINE_COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.95} metalness={0.05} />
      </instancedMesh>
    );
  },
);

interface BoxBuilding {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
}

interface GlbBuilding {
  id: string;
  x: number;
  z: number;
  footprint: number;
  rotY: number;
  url: string;
}

interface BackdropTree {
  x: number;
  z: number;
  h: number;
}

/** Deterministic city-block generation around the office / bank / showroom. */
function generateBackdrop(): {
  buildings: BoxBuilding[];
  glbBuildings: GlbBuilding[];
  trees: BackdropTree[];
} {
  const buildings: BoxBuilding[] = [];
  const glbBuildings: GlbBuilding[] = [];
  const trees: BackdropTree[] = [];

  const cell = 5.0;
  const rows = 20;
  const cols = 20;
  const margin = 2.5;
  const officeW = WORLD_W + margin;
  const officeH = WORLD_H + margin;
  // Also clear the bank lot
  const bankMinZ = BANK_Z - BANK_D / 2 - margin;
  const bankMaxZ = BANK_Z + BANK_D / 2 + margin;
  const bankMinX = BANK_X - BANK_W / 2 - margin;
  const bankMaxX = BANK_X + BANK_W / 2 + margin;
  const rW = ROAD_WIDTH / 2 + 1.5; // half-width + building clearance

  // Plant a jittered tree near a cell centre, capped per street block so no
  // single block turns into a thicket. Used for the random scatter, the open
  // gap cells, and backfilling cells whose building was relocated.
  const treeBox = cell * 5; // ~25u block — the granularity of the per-box cap
  const MAX_TREES_PER_BOX = 5;
  const treesPerBox = new Map<string, number>();
  const plantTree = (cx: number, cz: number, s: number): void => {
    const box = `${Math.floor(cx / treeBox)},${Math.floor(cz / treeBox)}`;
    const n = treesPerBox.get(box) ?? 0;
    if (n >= MAX_TREES_PER_BOX) return;
    treesPerBox.set(box, n + 1);
    trees.push({
      x: cx + (seededRandom(s + 11) - 0.5) * cell * 0.5,
      z: cz + (seededRandom(s + 12) - 0.5) * cell * 0.5,
      h: 1.2 + seededRandom(s + 13) * 1.6,
    });
  };

  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const x = (ix - cols / 2 + 0.5) * cell;
      const z = (iz - rows / 2 + 0.5) * cell;

      // Leave the office lot empty
      if (
        x > -officeW / 2 &&
        x < officeW / 2 &&
        z > -officeH / 2 &&
        z < officeH / 2
      ) {
        continue;
      }

      // Leave the bank lot empty
      if (x > bankMinX && x < bankMaxX && z > bankMinZ && z < bankMaxZ) {
        continue;
      }

      // Leave the showroom lot empty. Margin is wider than the lots above:
      // exclusion tests cell CENTRES, and a building footprint can reach
      // cell * 1.4 / 2 = 3.5 units beyond its centre — with the default
      // 2.5 margin the ±12.5 rows clipped the showroom corners.
      const showroomClear = 6;
      if (
        x > SHOWROOM_X - SHOWROOM_W / 2 - showroomClear &&
        x < SHOWROOM_X + SHOWROOM_W / 2 + showroomClear &&
        z > SHOWROOM_Z - SHOWROOM_D / 2 - showroomClear &&
        z < SHOWROOM_Z + SHOWROOM_D / 2 + showroomClear
      ) {
        continue;
      }

      // Curated view-corridor cells (see VIEW_BLOCKER_SPOTS)
      if (
        VIEW_BLOCKER_SPOTS.some(
          ([bx, bz]) =>
            Math.abs(x - bx) < cell / 2 && Math.abs(z - bz) < cell / 2,
        )
      ) {
        continue;
      }

      // Keep every road clear, plus the office↔bank connecting street
      const rConnZ = -(WORLD_H / 2 + BANK_STREET_GAP / 2);
      if (
        ROADS.some((r) =>
          r.axis === "x"
            ? Math.abs(z - r.center) < rW
            : Math.abs(x - r.center) < rW,
        )
      )
        continue;
      if (
        z > rConnZ - BANK_STREET_GAP / 2 - 1 &&
        z < rConnZ + BANK_STREET_GAP / 2 + 1 &&
        x > -BANK_W / 2 - 1 &&
        x < BANK_W / 2 + 1
      )
        continue;

      const seed = ix * 100 + iz;
      const roll = seededRandom(seed);

      if (roll < 0.15) {
        // Random tree in any open cell
        plantTree(x, z, seed);
      } else if (roll < 0.6) {
        // Building. Near the office, use a detailed GLB (apartment / building
        // model — cheap and good-looking). Further out, fog hazes the detail,
        // so a flat windowless box at 1 draw call is the efficient choice.
        if (Math.hypot(x, z) < 55) {
          const id = `gb:${ix},${iz}`;
          const ov = BACKDROP_OVERRIDES[id];
          // Only sometimes backfill a vacated cell — the relocated buildings
          // mostly came from one northern strip, so filling every one lined
          // the trees up along that street.
          if (ov && seededRandom(seed + 14) < 0.4) plantTree(x, z, seed);
          glbBuildings.push({
            id,
            x: ov ? ov[0] : x,
            z: ov ? ov[1] : z,
            footprint: cell * (0.95 + seededRandom(seed + 6) * 0.45),
            rotY: Math.floor(seededRandom(seed + 7) * 4) * (Math.PI / 2),
            url: BUILDING_URLS[
              Math.floor(seededRandom(seed + 8) * BUILDING_URLS.length)
            ],
          });
        } else {
          const id = `box:${ix},${iz}`;
          const ov = BACKDROP_OVERRIDES[id];
          if (ov && seededRandom(seed + 14) < 0.4) plantTree(x, z, seed);
          const w = cell * (0.7 + seededRandom(seed + 1) * 0.5);
          const d = cell * (0.7 + seededRandom(seed + 2) * 0.5);
          const h = 5 + seededRandom(seed + 3) * 14;
          const lightness = 55 + seededRandom(seed + 4) * 25;
          buildings.push({
            id,
            x: ov ? ov[0] : x,
            z: ov ? ov[1] : z,
            w,
            d,
            h,
            color: `hsl(210, 8%, ${lightness}%)`,
          });
        }
      } else {
        // Former gap cell — sprinkle some greenery so open space across the
        // whole grid gets trees, without packing every empty cell.
        if (seededRandom(seed + 9) < 0.3) plantTree(x, z, seed);
      }
    }
  }
  return { buildings, glbBuildings, trees };
}

// Centre-line dashes for every road, baked into one InstancedMesh — a single
// draw call regardless of road length, so the carriageways can run all the way
// out to the fog without paying for hundreds of separate dash meshes.
const DASH_LEN = 2.0;
const DASH_GAP = 1.8;
const DASH_FLAT = new THREE.Euler(-Math.PI / 2, 0, 0);
const DASH_PER_ROAD = Math.floor(ROAD_LEN / (DASH_LEN + DASH_GAP));

const RoadDashes = memo(function RoadDashes(): React.JSX.Element {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = ROADS.length * DASH_PER_ROAD;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromEuler(DASH_FLAT);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let idx = 0;
    for (const road of ROADS) {
      for (let j = 0; j < DASH_PER_ROAD; j++) {
        const o = -ROAD_LEN / 2 + j * (DASH_LEN + DASH_GAP) + DASH_LEN / 2;
        if (road.axis === "x") {
          pos.set(o, ROAD_MARKING_Y, road.center);
          scl.set(DASH_LEN, 0.18, 1);
        } else {
          pos.set(road.center, ROAD_MARKING_Y, o);
          scl.set(0.18, DASH_LEN, 1);
        }
        matrix.compose(pos, quat, scl);
        mesh.setMatrixAt(idx++, matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial color="#f5e642" roughness={0.9} />
    </instancedMesh>
  );
});

/** Sparse city backdrop — buildings, trees, roads and street furniture. */
export const CityBackdrop = memo(function CityBackdrop({
  devMode = false,
  moved,
  onPick,
}: {
  devMode?: boolean;
  /** Session-only position overrides keyed by building id ([x, y, z]). */
  moved?: Record<string, [number, number, number]>;
  /** Dev: called when a building is clicked while devMode is on. */
  onPick?: (b: { id: string; label: string; x: number; z: number }) => void;
} = {}): React.JSX.Element {
  const { buildings, glbBuildings, trees } = useMemo(
    () => generateBackdrop(),
    [],
  );

  const roadSouthZ = ROAD_SOUTH_Z;
  const roadNorthZ = ROAD_NORTH_Z;
  const roadEastX = ROAD_EAST_X;
  const roadWidth = ROAD_WIDTH;

  // Lamp spots along the inner roads, skipping any that land on a crossing.
  const { lampXs, lampZs } = useMemo(() => {
    const lampSpots = [-44, -33, -22, -11, 0, 11, 22, 33, 44];
    const clearOfRoads = (o: number, crossAxis: "x" | "z"): boolean =>
      ROADS.every(
        (r) =>
          r.axis !== crossAxis || Math.abs(o - r.center) > roadWidth / 2 + 1.2,
      );
    return {
      lampXs: lampSpots.filter((o) => clearOfRoads(o, "z")),
      lampZs: lampSpots.filter((o) => clearOfRoads(o, "x")),
    };
  }, [roadWidth]);

  return (
    <group>
      {/* Ground disc out to the horizon. Fog fades it into the sky long
          before the rim is visible. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        receiveShadow
      >
        <circleGeometry args={[380, 64]} />
        <meshStandardMaterial color="#b0b5bd" roughness={0.92} metalness={0} />
      </mesh>
      {/* Road surfaces — shared unit plane scaled per road */}
      {ROADS.map((road, i) => (
        <mesh
          key={`road-${i}`}
          geometry={unitPlaneGeo}
          material={roadMat}
          dispose={null}
          rotation={[-Math.PI / 2, 0, 0]}
          position={
            road.axis === "x"
              ? [0, ROAD_Y, road.center]
              : [road.center, ROAD_Y, 0]
          }
          scale={
            road.axis === "x"
              ? [ROAD_LEN, roadWidth, 1]
              : [roadWidth, ROAD_LEN, 1]
          }
        />
      ))}
      {/* Centre dashes — one instanced draw call for all roads */}
      <RoadDashes />
      {/* Far buildings — flat windowless boxes (1 draw call each); fog hides
          the missing detail. Near buildings use detailed GLBs below. */}
      {buildings.map((b, i) => {
        const mv = moved?.[b.id];
        const bx = mv ? mv[0] : b.x;
        const bz = mv ? mv[2] : b.z;
        return (
          <mesh
            key={`b-${i}`}
            position={[bx, b.h / 2, bz]}
            castShadow
            receiveShadow
            onClick={
              devMode && onPick
                ? (e) => {
                    e.stopPropagation();
                    onPick({ id: b.id, label: "Building", x: bx, z: bz });
                  }
                : undefined
            }
          >
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial
              color={b.color}
              roughness={0.88}
              metalness={0.04}
            />
          </mesh>
        );
      })}
      <Suspense fallback={null}>
        {glbBuildings.map((g, i) => {
          const mv = moved?.[g.id];
          const gx = mv ? mv[0] : g.x;
          const gz = mv ? mv[2] : g.z;
          return (
            <CityBuildingGlb
              key={`gb-${i}`}
              x={gx}
              z={gz}
              footprint={g.footprint}
              rotY={g.rotY}
              url={g.url}
              onClick={
                devMode && onPick
                  ? (e) => {
                      e.stopPropagation();
                      onPick({ id: g.id, label: "Building", x: gx, z: gz });
                    }
                  : undefined
              }
            />
          );
        })}
        {trees.map((t, i) => (
          <TreeGlb key={`t-${i}`} x={t.x} z={t.z} h={t.h} />
        ))}
        {/* Traffic lights at the 4 inner road intersections */}
        <TrafficLightGlb
          x={roadEastX - roadWidth / 2 - 0.6}
          z={roadSouthZ - roadWidth / 2 - 0.6}
          rotY={Math.PI}
        />
        <TrafficLightGlb
          x={-roadEastX + roadWidth / 2 + 0.6}
          z={roadSouthZ - roadWidth / 2 - 0.6}
          rotY={0}
        />
        <TrafficLightGlb
          x={roadEastX - roadWidth / 2 - 0.6}
          z={roadNorthZ + roadWidth / 2 + 0.6}
          rotY={Math.PI}
        />
        <TrafficLightGlb
          x={-roadEastX + roadWidth / 2 + 0.6}
          z={roadNorthZ + roadWidth / 2 + 0.6}
          rotY={0}
        />
        {/* Street lights along E-W south road — both sides */}
        {lampXs.map((ox) => (
          <StreetLightGlb
            key={`sl-ews-n-${ox}`}
            x={ox}
            z={roadSouthZ - roadWidth / 2 - 1.0}
            rotY={0}
          />
        ))}
        {lampXs.map((ox) => (
          <StreetLightGlb
            key={`sl-ews-s-${ox}`}
            x={ox}
            z={roadSouthZ + roadWidth / 2 + 1.0}
            rotY={Math.PI}
          />
        ))}
        {/* Street lights along N-S east road */}
        {lampZs.map((oz) => (
          <StreetLightGlb
            key={`sl-nse-w-${oz}`}
            x={roadEastX - roadWidth / 2 - 1.0}
            z={oz}
            rotY={Math.PI / 2}
          />
        ))}
        {/* Street lights along N-S west road */}
        {lampZs.map((oz) => (
          <StreetLightGlb
            key={`sl-nsw-e-${oz}`}
            x={-roadEastX + roadWidth / 2 + 1.0}
            z={oz}
            rotY={-Math.PI / 2}
          />
        ))}
      </Suspense>
    </group>
  );
});

useGLTF.preload(treeGlbUrl, false, false);
useGLTF.preload(building1GlbUrl, false, false);
useGLTF.preload(building2GlbUrl, false, false);
useGLTF.preload(apartmentGlbUrl, false, false);
useGLTF.preload(apartment2GlbUrl, false, false);
useGLTF.preload(streetLightGlbUrl, false, false);
useGLTF.preload(trafficLightGlbUrl, false, false);
