import { memo, useMemo, useRef } from "react";
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

interface TrafficVehicle {
  url: string;
  tint: string;
  /** Footprint length in world units after normalisation. */
  targetLen: number;
  /** Axis the vehicle travels along ("x" = E-W roads, "z" = N-S roads). */
  axis: "x" | "z";
  /** Fixed cross-axis coordinate — road centre plus its lane offset. */
  fixed: number;
  dir: 1 | -1;
  speed: number;
  /** Start position along the road in [-TRAFFIC_LEN/2, TRAFFIC_LEN/2]. */
  startS: number;
}

function makeTraffic(): TrafficVehicle[] {
  const lane = ROAD_WIDTH / 4; // centre of each carriageway half
  const vehicles: TrafficVehicle[] = [];
  let seed = 0;
  for (const road of ROADS) {
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
      vehicles.push({
        url,
        tint: VEHICLE_TINTS[
          Math.floor(seededRandom(seed * 11 + 2) * VEHICLE_TINTS.length)
        ],
        targetLen: isTruck ? 3.4 : 2.3,
        axis: road.axis,
        // Two-way traffic: each direction drives in its own lane.
        fixed: road.center + dir * lane,
        dir,
        speed: (isTruck ? 3.2 : 4.5) + seededRandom(seed * 13 + 3) * 2.2,
        startS:
          -TRAFFIC_LEN / 2 +
          ((i + seededRandom(seed * 17 + 4) * 0.6) / perRoad) * TRAFFIC_LEN,
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
    () => normalizeFootprint(vehicleClone(scene, tint), targetLen, true),
    [scene, tint, targetLen],
  );
  return <primitive object={object} />;
}

function TrafficVehicleInstance({
  vehicle,
}: {
  vehicle: TrafficVehicle;
}): React.JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  // Live position along the road; kept in a ref so the per-frame update
  // doesn't mutate the (config-only) vehicle prop.
  const sRef = useRef(vehicle.startS);
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const step = Math.min(delta, 0.05);
    let s = sRef.current + vehicle.dir * vehicle.speed * step;
    const half = TRAFFIC_LEN / 2;
    if (s > half) s -= TRAFFIC_LEN;
    else if (s < -half) s += TRAFFIC_LEN;
    sRef.current = s;
    if (vehicle.axis === "x") {
      g.position.set(s, ROAD_Y, vehicle.fixed);
      g.rotation.y = vehicle.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      g.position.set(vehicle.fixed, ROAD_Y, s);
      g.rotation.y = vehicle.dir > 0 ? 0 : Math.PI;
    }
  });
  return (
    <group ref={groupRef}>
      <VehicleModel
        url={vehicle.url}
        tint={vehicle.tint}
        targetLen={vehicle.targetLen}
      />
    </group>
  );
}

/** Cars / trucks looping on all backdrop roads, three per road. */
export const TrafficLayer = memo(function TrafficLayer(): React.JSX.Element {
  const vehicles = useRef<TrafficVehicle[]>(makeTraffic());
  return (
    <>
      {vehicles.current.map((v, i) => (
        <TrafficVehicleInstance key={`veh-${i}`} vehicle={v} />
      ))}
    </>
  );
});

useGLTF.preload(car1GlbUrl, false, false);
useGLTF.preload(car2GlbUrl, false, false);
useGLTF.preload(truck1GlbUrl, false, false);
